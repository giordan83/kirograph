import * as path from 'path';
import { Command } from 'commander';
import { bold, dim, reset, violet } from '../ui';

export function register(program: Command): void {
  program
    .command('circular-deps [projectPath]')
    .description('Find circular dependency cycles in the codebase')
    .option('-j, --json', 'Output as JSON')
    .action(async (projectPath: string | undefined, opts: { json?: boolean }) => {
      const KiroGraph = (await import('../../index')).default;
      const target = path.resolve(projectPath ?? process.cwd());
      const cg = await KiroGraph.open(target);

      const cycles = cg.findCircularDependencies();

      if (opts.json) {
        console.log(JSON.stringify({ cycles }));
        cg.close(); return;
      }

      if (cycles.length === 0) {
        console.log(`\n  ${dim}No circular dependencies found.${reset}\n`);
        cg.close(); return;
      }

      console.log(`\n  ${violet}${bold}Circular Dependencies${reset}  ${dim}(${cycles.length} cycle(s))${reset}\n`);
      for (let i = 0; i < cycles.length; i++) {
        console.log(`  ${dim}Cycle ${i + 1}:${reset} ${cycles[i].map(s => `${violet}${s}${reset}`).join(` ${dim}→${reset} `)}`);
      }
      console.log();
      cg.close();
    });
}
