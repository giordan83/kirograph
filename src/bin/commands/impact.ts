import * as path from 'path';
import { Command } from 'commander';
import { bold, dim, reset, violet } from '../ui';

export function register(program: Command): void {
  program
    .command('impact <symbol>')
    .description('Show symbols that would be affected by changing a given symbol')
    .option('-d, --depth <n>', 'Max traversal depth (default: 2)', '2')
    .option('-j, --json', 'Output as JSON')
    .option('-p, --path <path>', 'Project path')
    .action(async (symbol: string, opts: { depth: string; json?: boolean; path?: string }) => {
      const KiroGraph = (await import('../../index')).default;
      const target = path.resolve(opts.path ?? process.cwd());
      const cg = await KiroGraph.open(target);

      const results = cg.searchNodes(symbol, undefined, 5);
      if (results.length === 0) {
        console.error(`  ✖ Symbol "${symbol}" not found in index.`);
        cg.close(); process.exit(1);
      }

      const node = results[0].node;
      const depth = Math.max(1, Math.min(10, parseInt(opts.depth) || 2));
      const affected = await cg.getImpactRadius(node.id, depth);

      if (opts.json) {
        console.log(JSON.stringify({ symbol: node.name, depth, affected }));
        cg.close(); return;
      }

      if (affected.length === 0) {
        console.log(`\n  ${dim}No dependents found for \`${node.name}\`.${reset}\n`);
        cg.close(); return;
      }

      console.log(`\n  ${violet}${bold}Impact of \`${node.name}\`${reset}  ${dim}(${affected.length} symbol(s) affected, depth: ${depth})${reset}\n`);
      for (const n of affected) {
        console.log(`  ${violet}${n.name}${reset}  ${dim}${n.kind}  ${n.filePath}:${n.startLine}${reset}`);
      }
      console.log();
      cg.close();
    });
}
