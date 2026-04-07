import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { dim, reset, green, label } from '../ui';
import { ensureQdrantUI, openQdrantDashboard } from '../installer/qdrant-dashboard';

const SERVER_STATE_FILE = 'qdrant-server.json';
interface ServerState { pid: number; port: number; }

function readState(kirographDir: string): ServerState | null {
  try { return JSON.parse(fs.readFileSync(path.join(kirographDir, SERVER_STATE_FILE), 'utf8')); }
  catch { return null; }
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Check if the Qdrant dashboard endpoint returns something other than 404. */
function dashboardReachable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}/dashboard`, res => {
      resolve(res.statusCode !== 404);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

export function register(program: Command): void {
  const cmd = program
    .command('qdrant [projectPath]')
    .description('Manage the Qdrant engine and dashboard');

  // ── start ──────────────────────────────────────────────────────────────────
  cmd.command('start [projectPath]')
    .description('Start the Qdrant server (if not running) and open the dashboard')
    .action(async (projectPath: string | undefined) => {
      const target       = path.resolve(projectPath ?? process.cwd());
      const kirographDir = path.join(target, '.kirograph');

      // 1. Ensure UI files are downloaded BEFORE starting Qdrant so
      //    QdrantIndex.initialize() finds them and sets STATIC_CONTENT_DIR.
      const uiReady = await ensureQdrantUI(target);
      if (!uiReady) {
        console.log(`  Could not download Qdrant Web UI.\n`);
        return;
      }

      // 2. If already running, check whether the dashboard is actually served.
      //    If not (started without static dir), restart so it picks up the files.
      const saved = readState(kirographDir);
      if (saved && isAlive(saved.pid)) {
        const hasDashboard = await dashboardReachable(saved.port);
        if (!hasDashboard) {
          // Restart with static content dir now that UI files are present
          try { process.kill(saved.pid, 'SIGTERM'); } catch { /* ignore */ }
          await new Promise(r => setTimeout(r, 400));
          try { fs.unlinkSync(path.join(kirographDir, SERVER_STATE_FILE)); } catch { /* ignore */ }
        } else {
          console.log(`\n  ${green}✓${reset} Qdrant already running with dashboard  ${dim}(pid ${saved.pid}, port ${saved.port})${reset}`);
          await openQdrantDashboard(target);
          console.log(`  ${dim}Qdrant keeps running in the background — use ${reset}kg qdrant stop${dim} to shut it down.${reset}\n`);
          return;
        }
      }

      // 3. Spawn (or re-spawn) Qdrant — files are in place so STATIC_CONTENT_DIR is set
      console.log();
      const { QdrantIndex } = await import('../../vectors/qdrant-index');
      const index = new QdrantIndex(kirographDir);
      await index.initialize();
      if (!index.isAvailable()) {
        console.log(`  Qdrant failed to start.\n`);
        return;
      }
      index.close();

      await openQdrantDashboard(target);
      console.log(`  ${dim}Qdrant keeps running in the background — use ${reset}kg qdrant stop${dim} to shut it down.${reset}\n`);
    });

  // ── stop ───────────────────────────────────────────────────────────────────
  cmd.command('stop [projectPath]')
    .description('Stop the Qdrant server')
    .action((projectPath: string | undefined) => {
      const target       = path.resolve(projectPath ?? process.cwd());
      const kirographDir = path.join(target, '.kirograph');
      const stateFile    = path.join(kirographDir, SERVER_STATE_FILE);

      console.log();
      const saved = readState(kirographDir);

      if (!saved) {
        console.log(`  ${dim}No running Qdrant server found.${reset}\n`);
        return;
      }

      let killed = false;
      if (isAlive(saved.pid)) {
        try { process.kill(saved.pid, 'SIGTERM'); killed = true; } catch { /* ignore */ }
      }
      try { fs.unlinkSync(stateFile); } catch { /* ignore */ }

      if (killed) {
        console.log(`  ${green}✓${reset} ${label('Stopped')} Qdrant server  ${dim}(pid ${saved.pid}, port ${saved.port})${reset}`);
      } else {
        console.log(`  ${dim}Qdrant server (pid ${saved.pid}) was not running — state file cleaned up.${reset}`);
      }
      console.log();
    });
}
