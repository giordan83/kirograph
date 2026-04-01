import { Command } from 'commander';
import * as path from 'path';
import { dim, reset } from '../ui';
import { warnFallback, formatSyncCounts } from './utils';

export function register(program: Command): void {
  program
    .command('sync [projectPath]')
    .description('Incremental sync of changed files')
    .option('--files <files...>', 'Specific files to sync')
    .action(async (projectPath: string | undefined, opts: { files?: string[] }) => {
      const KiroGraph = (await import('../../index')).default;
      const target = path.resolve(projectPath ?? process.cwd());
      const cg = await KiroGraph.open(target);
      const result = await cg.sync(opts.files);
      const changed = result.added.length + result.modified.length + result.removed.length;
      if (changed === 0) {
        console.log(`  ${dim}Nothing to sync.${reset}`);
      } else {
        console.log(formatSyncCounts(result));
      }
      if (result.errors.length) console.warn(`  \x1b[33m⚠ ${result.errors.length} warning(s)\x1b[0m`);
      warnFallback(cg.getEngineFallback());
      cg.close();
    });
}
