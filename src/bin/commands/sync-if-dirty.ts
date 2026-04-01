import { Command } from 'commander';
import * as path from 'path';
import { dim, reset } from '../ui';
import { warnFallback, formatSyncCounts } from './utils';

export function register(program: Command): void {
  program
    .command('sync-if-dirty [projectPath]')
    .description('Sync only if a dirty marker is present')
    .option('-q, --quiet', 'Suppress output')
    .action(async (projectPath: string | undefined, opts: { quiet?: boolean }) => {
      const KiroGraph = (await import('../../index')).default;
      const target = path.resolve(projectPath ?? process.cwd());
      if (!KiroGraph.isInitialized(target)) { process.exit(0); }
      const cg = await KiroGraph.open(target);
      const result = await cg.syncIfDirty();
      if (!opts.quiet) {
        if (result) {
          const changed = result.added.length + result.modified.length + result.removed.length;
          if (changed === 0) {
            console.log(`  ${dim}Index up to date.${reset}`);
          } else {
            console.log(formatSyncCounts(result));
          }
          if (result.errors.length) console.warn(`  \x1b[33m⚠ ${result.errors.length} warning(s)\x1b[0m`);
          warnFallback(cg.getEngineFallback());
        } else {
          console.log(`  ${dim}Not dirty, skipped.${reset}`);
        }
      }
      cg.close();
    });
}
