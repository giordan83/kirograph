import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { dim, reset, green, label, value } from '../ui';

const SERVER_STATE_FILE = 'typesense-server.json';

interface ServerState { pid: number; apiPort: number; peeringPort: number; }

export function register(program: Command): void {
  program
    .command('stop [projectPath]')
    .description('Stop background engine processes (e.g. Typesense)')
    .action(async (projectPath: string | undefined) => {
      const target = path.resolve(projectPath ?? process.cwd());
      const stateFile = path.join(target, '.kirograph', SERVER_STATE_FILE);

      if (!fs.existsSync(stateFile)) {
        console.log(`\n  ${dim}No background engine processes found.${reset}\n`);
        return;
      }

      let state: ServerState;
      try {
        state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      } catch {
        fs.unlinkSync(stateFile);
        console.log(`\n  ${dim}State file was corrupt — cleaned up.${reset}\n`);
        return;
      }

      console.log();
      let killed = false;
      try {
        process.kill(state.pid, 0); // throws if not alive
        process.kill(state.pid, 'SIGTERM');
        killed = true;
      } catch {
        // Process already gone
      }

      fs.unlinkSync(stateFile);

      if (killed) {
        console.log(`  ${green}✓${reset} Stopped Typesense server  ${dim}(pid ${state.pid}, port ${state.apiPort})${reset}`);
      } else {
        console.log(`  ${dim}Typesense server (pid ${state.pid}) was not running — state file cleaned up.${reset}`);
      }
      console.log();
    });
}
