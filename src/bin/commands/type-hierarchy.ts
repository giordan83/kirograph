import * as path from 'path';
import { Command } from 'commander';
import { bold, dim, reset, violet } from '../ui';

export function register(program: Command): void {
  program
    .command('type-hierarchy <symbol>')
    .description('Traverse the type hierarchy of a class or interface (base types and derived types)')
    .option('--direction <dir>', 'Direction: up (base types), down (derived types), both (default)', 'both')
    .option('-j, --json', 'Output as JSON')
    .option('-p, --path <path>', 'Project path')
    .action(async (symbol: string, opts: { direction: string; json?: boolean; path?: string }) => {
      const KiroGraph = (await import('../../index')).default;
      const target = path.resolve(opts.path ?? process.cwd());
      const cg = await KiroGraph.open(target);

      const results = cg.searchNodes(symbol, undefined, 5);
      if (results.length === 0) {
        console.error(`  ✖ Symbol "${symbol}" not found in index.`);
        cg.close(); process.exit(1);
      }

      const node = results[0].node;
      const direction = (['up', 'down', 'both'].includes(opts.direction) ? opts.direction : 'both') as 'up' | 'down' | 'both';
      const hierarchy = cg.getTypeHierarchy(node.id, direction);

      if (opts.json) {
        console.log(JSON.stringify({ symbol: node.name, direction, hierarchy }));
        cg.close(); return;
      }

      if (hierarchy.length === 0) {
        console.log(`\n  ${dim}No type hierarchy found for \`${node.name}\`.${reset}\n`);
        cg.close(); return;
      }

      console.log(`\n  ${violet}${bold}Type hierarchy of \`${node.name}\`${reset}  ${dim}(direction: ${direction})${reset}\n`);
      for (const n of hierarchy) {
        console.log(`  ${violet}${n.name}${reset}  ${dim}${n.kind}  ${n.filePath}:${n.startLine}${reset}`);
      }
      console.log();
      cg.close();
    });
}
