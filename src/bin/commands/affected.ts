import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { dim, reset, violet, bold, section } from '../ui';

export function register(program: Command): void {
  program
    .command('affected [files...]')
    .description('Find test files affected by changed source files')
    .option('--stdin', 'Read file list from stdin (one per line)')
    .option('-d, --depth <n>', 'Max dependency traversal depth', '5')
    .option('-f, --filter <glob>', 'Custom glob to identify test files')
    .option('-j, --json', 'Output as JSON')
    .option('-q, --quiet', 'Output file paths only')
    .option('-p, --path <path>', 'Project path')
    .action(async (files: string[], opts: {
      stdin?: boolean; depth: string; filter?: string;
      json?: boolean; quiet?: boolean; path?: string;
    }) => {
      const KiroGraph = (await import('../../index')).default;
      const target = path.resolve(opts.path ?? process.cwd());
      const cg = await KiroGraph.open(target);

      let changedFiles = [...files];

      if (opts.stdin) {
        const lines = fs.readFileSync('/dev/stdin', 'utf8').split('\n').map((l: string) => l.trim()).filter(Boolean);
        changedFiles.push(...lines);
      }

      if (changedFiles.length === 0) {
        console.error('No files provided. Pass files as arguments or use --stdin.');
        cg.close(); process.exit(1);
      }

      const affected = cg.getAffectedTests(changedFiles, {
        depth: parseInt(opts.depth),
        testPattern: opts.filter,
      });

      if (opts.json) {
        console.log(JSON.stringify({ changedFiles, affectedTests: affected }, null, 2));
      } else if (opts.quiet) {
        for (const f of affected) console.log(f);
      } else {
        if (affected.length === 0) {
          console.log(`  ${dim}No affected test files found.${reset}`);
        } else {
          console.log(`\n  ${section('Affected test files')}  ${dim}(${affected.length})${reset}\n`);
          for (const f of affected) console.log(`  ${violet}${bold}${f}${reset}`);
          console.log();
        }
      }
      cg.close();
    });
}
