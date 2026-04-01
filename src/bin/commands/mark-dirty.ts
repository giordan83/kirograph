import { Command } from 'commander';
import * as path from 'path';

export function register(program: Command): void {
  program
    .command('mark-dirty [projectPath]')
    .description('Write a dirty marker to trigger deferred sync')
    .action(async (projectPath: string | undefined) => {
      const KiroGraph = (await import('../../index')).default;
      const target = path.resolve(projectPath ?? process.cwd());
      if (!KiroGraph.isInitialized(target)) { process.exit(0); }
      const cg = await KiroGraph.open(target);
      cg.markDirty();
      cg.close();
    });
}
