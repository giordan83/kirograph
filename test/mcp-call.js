#!/usr/bin/env node
'use strict';
/**
 * Minimal MCP stdio client for shell test scripts.
 *
 * Usage:
 *   node test/mcp-call.js <project-path> <tool-name> [json-args]
 *
 * Exits:
 *   0  success  (result.isError === false)
 *   1  tool error  (result.isError === true)
 *   2  JSON-RPC error, timeout, or bad usage
 *
 * Prints the joined text content of the response to stdout.
 */
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const [,, projectPath, toolName, argsStr] = process.argv;
if (!projectPath || !toolName) {
  process.stderr.write('Usage: mcp-call.js <project-path> <tool-name> [json-args]\n');
  process.exit(2);
}

let args;
try {
  args = argsStr ? JSON.parse(argsStr) : {};
} catch (e) {
  process.stderr.write(`Invalid JSON args: ${e.message}\n`);
  process.exit(2);
}

const kirograph = path.resolve(__dirname, '../dist/bin/kirograph.js');
const server = spawn('node', [kirograph, 'serve', '--mcp', '--path', path.resolve(projectPath)], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

const pending = new Map();
let nextId = 1;
let exited = false;

const rl = readline.createInterface({ input: server.stdout, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const msg = JSON.parse(trimmed);
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }
  } catch {}
});

function cleanup() {
  if (exited) return;
  exited = true;
  try { server.stdin.end(); } catch {}
  try { server.kill('SIGTERM'); } catch {}
}

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout (15s) waiting for response to "${method}"`));
    }, 15000);
    pending.set(id, {
      resolve: (msg) => { clearTimeout(timer); resolve(msg); },
    });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

async function main() {
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(2); });

  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {} });

  const res = await rpc('tools/call', { name: toolName, arguments: args });
  cleanup();

  if (res.error) {
    process.stderr.write(`JSON-RPC error: ${res.error.message}\n`);
    process.exit(2);
  }

  const result = res.result ?? {};
  const text = (result.content ?? []).map(c => c.text ?? '').join('');
  if (text) process.stdout.write(text + '\n');

  process.exit(result.isError ? 1 : 0);
}

main().catch((err) => {
  cleanup();
  process.stderr.write(err.message + '\n');
  process.exit(2);
});
