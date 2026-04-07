import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { dim, reset, green, label } from '../ui';
import { openTypesenseDashboard } from '../installer/dashboard';

const SERVER_STATE_FILE = 'typesense-server.json';
interface ServerState { pid: number; apiPort: number; }

function readState(kirographDir: string): ServerState | null {
  try { return JSON.parse(fs.readFileSync(path.join(kirographDir, SERVER_STATE_FILE), 'utf8')); }
  catch { return null; }
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function register(program: Command): void {
  const ts = program
    .command('typesense [projectPath]')
    .description('Manage the Typesense engine and dashboard');

  // ── start ──────────────────────────────────────────────────────────────────
  ts.command('start [projectPath]')
    .description('Start the Typesense server (if not running) and open the local dashboard')
    .action(async (projectPath: string | undefined) => {
      const target       = path.resolve(projectPath ?? process.cwd());
      const kirographDir = path.join(target, '.kirograph');

      // Check if already running
      const saved = readState(kirographDir);
      if (saved && isAlive(saved.pid)) {
        console.log(`\n  ${green}✓${reset} Typesense already running  ${dim}(pid ${saved.pid}, port ${saved.apiPort})${reset}`);
      } else {
        // Start via TypesenseIndex.initialize() — it handles binary download,
        // spawn, health check, and writes the state file.
        console.log();
        const { TypesenseIndex } = await import('../../vectors/typesense-index');
        const index = new TypesenseIndex(kirographDir);
        await index.initialize();
        if (!index.isAvailable()) {
          console.log(`  Typesense failed to start.\n`);
          return;
        }
        index.close(); // detach client; server keeps running as daemon
      }

      // Open dashboard (reads fresh state file for the actual port)
      await openTypesenseDashboard(target);
      console.log(`  ${dim}Press Ctrl+C to close the dashboard (Typesense keeps running — use ${reset}kg typesense stop${dim} to shut it down).${reset}\n`);
      process.on('SIGINT', () => process.exit(0));
    });

  // ── stop ───────────────────────────────────────────────────────────────────
  ts.command('stop [projectPath]')
    .description('Stop the Typesense server')
    .action((projectPath: string | undefined) => {
      const target       = path.resolve(projectPath ?? process.cwd());
      const kirographDir = path.join(target, '.kirograph');
      const stateFile    = path.join(kirographDir, SERVER_STATE_FILE);

      console.log();
      const saved = readState(kirographDir);

      if (!saved) {
        console.log(`  ${dim}No running Typesense server found.${reset}\n`);
        return;
      }

      let killed = false;
      if (isAlive(saved.pid)) {
        try { process.kill(saved.pid, 'SIGTERM'); killed = true; } catch { /* ignore */ }
      }

      try { fs.unlinkSync(stateFile); } catch { /* ignore */ }

      if (killed) {
        console.log(`  ${green}✓${reset} ${label('Stopped')} Typesense server  ${dim}(pid ${saved.pid}, port ${saved.apiPort})${reset}`);
      } else {
        console.log(`  ${dim}Typesense server (pid ${saved.pid}) was not running — state file cleaned up.${reset}`);
      }
      console.log();
    });
}
