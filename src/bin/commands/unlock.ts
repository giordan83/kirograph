import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { dim, reset, green } from '../ui';

export function register(program: Command): void {
  program
    .command('unlock [projectPath]')
    .description('Force-release a stale KiroGraph lock file')
    .action(async (projectPath: string | undefined) => {
      const lockPath = path.join(path.resolve(projectPath ?? process.cwd()), '.kirograph', 'kirograph.lock');
      if (!fs.existsSync(lockPath)) {
        console.log(`  ${dim}No lock file found.${reset}`);
        return;
      }
      const content = fs.readFileSync(lockPath, 'utf8').trim();
      fs.unlinkSync(lockPath);
      console.log(`  ${green}✓${reset} Lock released ${dim}(was held by: ${content})${reset}`);
    });
}
