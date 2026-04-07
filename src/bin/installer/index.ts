/**
 * KiroGraph Installer for Kiro
 *
 * Wires up:
 *  1. .kiro/settings/mcp.json  — registers the MCP server
 *  2. .kiro/hooks/*.json       — auto-sync on file save/create/delete (via mark-dirty + sync-if-dirty)
 *  3. .kiro/steering/kirograph.md — teaches Kiro to use the graph tools
 */

import * as path from 'path';
import * as readline from 'readline';
import { spawnSync } from 'child_process';
import { updateConfig } from '../../config';
import { printBanner } from '../banner';
import { renderIndexProgress } from '../progress';
import { dim, reset } from '../ui';
import { ask } from './prompts';
import { promptConfigOptions } from './config-prompt';
import { writeMcpConfig } from './mcp';
import { writeHooks } from './hooks';
import { writeSteering } from './steering';
import { openTypesenseDashboard } from './dashboard';

export async function runInstaller(): Promise<void> {
  printBanner();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const cwd = process.cwd();
    const kiroDir = path.join(cwd, '.kiro');

    console.log(`  Workspace: ${cwd}\n`);

    const proceed = await ask(rl, '  Install KiroGraph for this Kiro workspace? (Y/n) ');
    if (proceed.toLowerCase() === 'n') { console.log('  Cancelled.'); rl.close(); return; }
    console.log();

    // 1. MCP config
    writeMcpConfig(kiroDir);

    // 2. Hooks
    writeHooks(kiroDir);

    // 3. Steering
    writeSteering(kiroDir);

    // 4. Prompt for config options and persist
    const patch = await promptConfigOptions(rl);
    try {
      await updateConfig(cwd, patch);
      console.log(`\n  Configuration saved to ${cwd}/.kirograph/config.json`);
      console.log(`  • enableEmbeddings: ${patch.enableEmbeddings}`);
      if ('embeddingModel' in patch) {
        console.log(`  • embeddingModel: ${patch.embeddingModel}`);
      }
      if (patch.enableEmbeddings) {
        console.log(`  • semanticEngine: ${patch.semanticEngine}`);
        if (patch.semanticEngine === 'sqlite-vec') {
          console.log(`\n  Installing sqlite-vec dependencies...`);
          const result = spawnSync('npm', ['install', 'better-sqlite3', 'sqlite-vec'], { stdio: 'inherit', shell: true });
          if (result.status === 0) {
            console.log(`  ✓ better-sqlite3 and sqlite-vec installed`);
          } else {
            console.warn(`  ✗ npm install failed (exit ${result.status}). Run manually:`);
            console.warn(`    npm install better-sqlite3 sqlite-vec`);
          }
        } else if (patch.semanticEngine === 'orama') {
          console.log(`\n  Installing Orama dependencies...`);
          const result = spawnSync('npm', ['install', '@orama/orama', '@orama/plugin-data-persistence'], { stdio: 'inherit', shell: true });
          if (result.status === 0) {
            console.log(`  ✓ @orama/orama and @orama/plugin-data-persistence installed`);
          } else {
            console.warn(`  ✗ npm install failed (exit ${result.status}). Run manually:`);
            console.warn(`    npm install @orama/orama @orama/plugin-data-persistence`);
          }
        } else if (patch.semanticEngine === 'pglite') {
          console.log(`\n  Installing PGlite dependencies...`);
          const result = spawnSync('npm', ['install', '@electric-sql/pglite'], { stdio: 'inherit', shell: true });
          if (result.status === 0) {
            console.log(`  ✓ @electric-sql/pglite installed`);
          } else {
            console.warn(`  ✗ npm install failed (exit ${result.status}). Run manually:`);
            console.warn(`    npm install @electric-sql/pglite`);
          }
        } else if (patch.semanticEngine === 'lancedb') {
          console.log(`\n  Installing LanceDB dependencies...`);
          const result = spawnSync('npm', ['install', '@lancedb/lancedb'], { stdio: 'inherit', shell: true });
          if (result.status === 0) {
            console.log(`  ✓ @lancedb/lancedb installed`);
          } else {
            console.warn(`  ✗ npm install failed (exit ${result.status}). Run manually:`);
            console.warn(`    npm install @lancedb/lancedb`);
          }
        } else if (patch.semanticEngine === 'qdrant') {
          console.log(`\n  Installing Qdrant dependencies...`);
          const result = spawnSync('npm', ['install', 'qdrant-local'], { stdio: 'inherit', shell: true });
          if (result.status === 0) {
            console.log(`  ✓ qdrant-local installed`);
          } else {
            console.warn(`  ✗ npm install failed (exit ${result.status}). Run manually:`);
            console.warn(`    npm install qdrant-local`);
          }
        } else if (patch.semanticEngine === 'typesense') {
          console.log(`\n  Installing Typesense dependencies...`);
          const result = spawnSync('npm', ['install', 'typesense'], { stdio: 'inherit', shell: true });
          if (result.status === 0) {
            console.log(`  ✓ typesense installed`);
            console.log(`  ℹ  The Typesense binary (~37MB) will be auto-downloaded on first index run.`);
          } else {
            console.warn(`  ✗ npm install failed (exit ${result.status}). Run manually:`);
            console.warn(`    npm install typesense`);
          }
        }
      }
      console.log(`  • extractDocstrings: ${patch.extractDocstrings}`);
      console.log(`  • trackCallSites: ${patch.trackCallSites}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`\n  ✗ Failed to write configuration: ${reason}`);
      process.exit(1);
    }

    // 5. Optionally init + index
    const doIndex = await ask(rl, '\n  Initialize and index this project now? (Y/n) ');
    if (doIndex.toLowerCase() !== 'n') {
      const KiroGraph = (await import('../../index')).default;
      if (!KiroGraph.isInitialized(cwd)) {
        await KiroGraph.init(cwd);
        console.log('  ✓ Created .kirograph/');
      }
      const cg = await KiroGraph.open(cwd);
      console.log('  Indexing...');
      const result = await cg.indexAll({ onProgress: renderIndexProgress });
      process.stdout.write('\n');
      console.log(`  ✓ Indexed ${result.filesIndexed} files, ${result.nodesCreated} symbols, ${result.edgesCreated} edges`);
      cg.close();

      if (patch.typesenseDashboard) {
        await openTypesenseDashboard(cwd);
        console.log(`  ${dim}Press Ctrl+C to stop the dashboard server when done.${reset}`);
        process.on('SIGINT', () => { rl.close(); process.exit(0); });
        return; // rl.close() handled via SIGINT
      }
    }

    console.log('\n  Done! Restart Kiro for the MCP server to load.\n');
  } finally {
    rl.close();
  }
}
