import { Command } from 'commander';
import * as path from 'path';
import { dim, reset } from '../ui';
import { openTypesenseDashboard } from '../installer/dashboard';

export function register(program: Command): void {
  program
    .command('dashboard [projectPath]')
    .description('Open the Typesense dashboard for this project (local server)')
    .action(async (projectPath: string | undefined) => {
      const target = path.resolve(projectPath ?? process.cwd());
      await openTypesenseDashboard(target);
      console.log(`  ${dim}Press Ctrl+C to stop the dashboard server.${reset}\n`);
      process.on('SIGINT', () => process.exit(0));
    });
}
