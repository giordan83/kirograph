import { Command } from 'commander';
import * as path from 'path';
import { dim, reset } from '../ui';
import { renderSyncProgress, renderSyncSummary } from '../progress';
import { warnFallback } from './utils';

export function register(program: Command): void {
  program
    .command('sync [projectPath]')
    .description('Incremental sync of changed files')
    .option('--files <files...>', 'Specific files to sync')
    .option('-q, --quiet', 'Suppress progress output')
    .action(async (projectPath: string | undefined, opts: { files?: string[]; quiet?: boolean }) => {
      const KiroGraph = (await import('../../index')).default;
      const target = path.resolve(projectPath ?? process.cwd());
      const cg = await KiroGraph.open(target);
      const result = await cg.sync({
        files: opts.files,
        onProgress: opts.quiet ? undefined : renderSyncProgress,
      });
      const changed = result.added.length + result.modified.length + result.removed.length;
      if (changed === 0) {
        if (!opts.quiet) process.stdout.write('\n');
        console.log(`  ${dim}Nothing to sync — index is up to date.${reset}`);
      } else {
        renderSyncSummary(result);
      }
      if (result.errors.length) console.warn(`  \x1b[33m⚠ ${result.errors.length} warning(s)\x1b[0m`);
      warnFallback(cg.getEngineFallback());
      cg.close();
    });
}
