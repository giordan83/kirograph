import * as path from 'path';
import { Command } from 'commander';
import { bold, dim, reset, violet } from '../ui';

export function register(program: Command): void {
  program
    .command('callees <symbol>')
    .description('List symbols called by a given function or method')
    .option('--limit <n>', 'Max results (default: 20)', '20')
    .option('-j, --json', 'Output as JSON')
    .option('-p, --path <path>', 'Project path')
    .action(async (symbol: string, opts: { limit: string; json?: boolean; path?: string }) => {
      const KiroGraph = (await import('../../index')).default;
      const target = path.resolve(opts.path ?? process.cwd());
      const cg = await KiroGraph.open(target);

      const results = cg.searchNodes(symbol, undefined, 5);
      if (results.length === 0) {
        console.error(`  ✖ Symbol "${symbol}" not found in index.`);
        cg.close(); process.exit(1);
      }

      const node = results[0].node;
      const limit = Math.max(1, Math.min(100, parseInt(opts.limit) || 20));
      const callees = await cg.getCallees(node.id, limit);

      if (opts.json) {
        console.log(JSON.stringify({ symbol: node.name, callees }));
        cg.close(); return;
      }

      if (callees.length === 0) {
        console.log(`\n  ${dim}\`${node.name}\` doesn't call any indexed symbols.${reset}\n`);
        cg.close(); return;
      }

      console.log(`\n  ${violet}${bold}\`${node.name}\` calls${reset}  ${dim}(${callees.length})${reset}\n`);
      for (const n of callees) {
        console.log(`  ${violet}${n.name}${reset}  ${dim}${n.kind}  ${n.filePath}:${n.startLine}${reset}`);
      }
      console.log();
      cg.close();
    });
}
