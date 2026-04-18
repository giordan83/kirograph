import * as path from 'path';
import { Command } from 'commander';
import { bold, dim, reset, violet } from '../ui';

export function register(program: Command): void {
  program
    .command('path <from> <to>')
    .description('Find the shortest path between two symbols in the graph')
    .option('--format <fmt>', 'Output format: table | json', 'table')
    .action(async (from: string, to: string, opts: { format: string }, cmd: Command) => {
      const projectPath = cmd.parent?.args.find((_, i, arr) => arr[i - 1] === '--path');
      const KiroGraph = (await import('../../index')).default;
      const target = path.resolve(process.cwd());
      const cg = await KiroGraph.open(target);

      const fromResults = cg.searchNodes(from, undefined, 3);
      const toResults   = cg.searchNodes(to,   undefined, 3);

      if (fromResults.length === 0) {
        console.error(`\n  Symbol "${from}" not found in index.\n`);
        cg.close();
        return;
      }
      if (toResults.length === 0) {
        console.error(`\n  Symbol "${to}" not found in index.\n`);
        cg.close();
        return;
      }

      const SYMBOL_KINDS = new Set(['function', 'method', 'class', 'interface', 'type_alias', 'variable', 'component', 'route', 'constant']);
      const preferSymbol = (results: typeof fromResults) =>
        results.find(r => SYMBOL_KINDS.has(r.node.kind)) ?? results[0];

      const fromNode = preferSymbol(fromResults).node;
      const toNode   = preferSymbol(toResults).node;
      const pathNodes = await cg.findPath(fromNode.id, toNode.id);
      cg.close();

      if (opts.format === 'json') {
        console.log(JSON.stringify(pathNodes, null, 2));
        return;
      }

      console.log();
      console.log(`  ${dim}from  ${reset}${violet}${bold}${fromNode.name}${reset}  ${dim}${fromNode.kind}  ${fromNode.filePath}:${fromNode.startLine}${reset}`);
      console.log(`  ${dim}to    ${reset}${violet}${bold}${toNode.name}${reset}  ${dim}${toNode.kind}  ${toNode.filePath}:${toNode.startLine}${reset}\n`);

      if (pathNodes.length === 0) {
        console.log(`  ${dim}No path found.${reset}\n`);
        return;
      }

      console.log(`  ${violet}${bold}Path${reset}  ${dim}${pathNodes.length} hop${pathNodes.length === 1 ? '' : 's'}${reset}\n`);

      for (let i = 0; i < pathNodes.length; i++) {
        const n = pathNodes[i];
        const connector = i < pathNodes.length - 1 ? `\n  ${dim}│${reset}` : '';
        console.log(`  ${dim}${String(i + 1).padStart(2)}.${reset} ${violet}${bold}${n.name}${reset}  ${dim}${n.kind}${reset}`);
        console.log(`      ${dim}${n.filePath}:${n.startLine}${reset}${connector}`);
      }

      console.log();
    });
}
