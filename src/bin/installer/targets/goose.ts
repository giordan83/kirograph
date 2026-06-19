import * as fs from 'fs';
import * as path from 'path';
import {
  ensureDir,
  printMcpCommand,
  upsertGeneratedBlock,
  removeGeneratedBlock,
  buildInstructionOpts,
  LateInstallOptions,
} from '../common';
import { buildAgentInstructions } from '../instructions';

const GOOSE_BLOCK_ID = 'goose';

export function installGooseEarly(_projectRoot: string): void {
  // Block Goose MCP is configured via `goose mcp add` command.
  // We print the command in next steps.
}

export function installGooseLate(projectRoot: string, opts: LateInstallOptions): void {
  const instructionsPath = path.join(projectRoot, '.kirograph', 'goose.md');
  ensureDir(path.dirname(instructionsPath));
  fs.writeFileSync(instructionsPath, buildAgentInstructions(buildInstructionOpts(opts, false)));
  console.log(`  ✓ Goose instructions written to ${instructionsPath}`);

  const agentsPath = path.join(projectRoot, 'AGENTS.md');
  const changed = upsertGeneratedBlock(agentsPath, GOOSE_BLOCK_ID, '## KiroGraph', buildAgentInstructions(buildInstructionOpts(opts, false)));
  console.log(changed
    ? `  ✓ AGENTS.md updated with KiroGraph instructions (Goose)`
    : `  ✓ AGENTS.md already up to date`);
}

export function uninitGoose(projectRoot: string): void {
  const agentsPath = path.join(projectRoot, 'AGENTS.md');
  if (removeGeneratedBlock(agentsPath, GOOSE_BLOCK_ID)) {
    console.log(`  ✓ Removed KiroGraph block from AGENTS.md (Goose)`);
  }
}

export function printGooseNextSteps(projectRoot: string): void {
  const escapedPath = projectRoot.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  console.log('\n  Done! KiroGraph instructions are in AGENTS.md.');
  printMcpCommand(`goose mcp add kirograph -- kirograph serve --mcp --path "${escapedPath}"`);
}
