import { Command } from 'commander';
import * as path from 'path';
import { printBanner } from '../banner';
import { renderIndexProgress } from '../progress';
import { dim, reset, violet, bold, green, value } from '../ui';
import { warnFallback } from './utils';
import {
  getGlobalHooksDir,
  listHooks,
  copyHooks,
  getWorkspaceHooksDir,
  ensureDir,
} from '../../hooks/manager';
import { singleChoice, multiSelect, isInteractive } from '../../hooks/prompt';

export function register(program: Command): void {
  program
    .command('init [projectPath]')
    .description('Initialize KiroGraph in a project')
    .option('-i, --index', 'Index immediately after init')
    .action(async (projectPath: string | undefined, opts: { index?: boolean }) => {
      const KiroGraph = (await import('../../index')).default;
      const target = path.resolve(projectPath ?? process.cwd());
      if (KiroGraph.isInitialized(target)) {
        console.log(`  ${dim}KiroGraph already initialized at ${target}${reset}`);
      } else {
        await KiroGraph.init(target);
        console.log(`  ${green}✓${reset} Initialized ${violet}${bold}.kirograph/${reset} in ${dim}${target}${reset}`);
      }
      // Hook import prompt — after init, before indexing (Req 7.7, 7.8)
      if (isInteractive()) {
        let globalDir: string | undefined;
        try {
          globalDir = getGlobalHooksDir();
        } catch {
          // Cannot determine home directory — skip hook import silently
        }

        if (globalDir) {
          const globalHooks = listHooks(globalDir);

          if (globalHooks.length > 0) {
            const choice = await singleChoice('Import global hooks?', [
              { label: 'None', value: 'none' },
              { label: 'All', value: 'all' },
              { label: 'Select specific hooks', value: 'select' },
            ]);

            if (choice === 'all') {
              const workspaceHooksDir = getWorkspaceHooksDir(target);
              ensureDir(workspaceHooksDir);
              const copied = copyHooks(
                globalDir,
                workspaceHooksDir,
                globalHooks.map((h) => h.filename)
              );
              console.log(`  ${green}✓${reset} Imported ${copied.length} hook${copied.length === 1 ? '' : 's'}:`);
              for (const f of copied) {
                const hook = globalHooks.find((h) => h.filename === f);
                console.log(`    ${hook?.description ?? hook?.displayName ?? f}`);
              }
            } else if (choice === 'select') {
              const options = globalHooks.map((h) => ({
                label: h.displayName,
                value: h.filename,
                description: h.description,
              }));
              const selected = await multiSelect('Select hooks to import:', options);
              if (selected.length > 0) {
                const workspaceHooksDir = getWorkspaceHooksDir(target);
                ensureDir(workspaceHooksDir);
                const copied = copyHooks(globalDir, workspaceHooksDir, selected);
                console.log(`  ${green}✓${reset} Imported ${copied.length} hook${copied.length === 1 ? '' : 's'}:`);
                for (const f of copied) {
                  const hook = globalHooks.find((h) => h.filename === f);
                  console.log(`    ${hook?.description ?? hook?.displayName ?? f}`);
                }
              }
            }
            // "none" — skip hook import (Req 7.5)
          }
        }
      }

      if (opts.index) {
        const cg = await KiroGraph.open(target);
        console.log(`\n  ${dim}Indexing...${reset}`);
        const result = await cg.indexAll({
          force: true,
          onProgress: renderIndexProgress,
        });
        process.stdout.write('\n');
        console.log(`  ${green}✓${reset} ${value(String(result.filesIndexed))} ${dim}files,${reset} ${value(String(result.nodesCreated))} ${dim}symbols,${reset} ${value(String(result.edgesCreated))} ${dim}edges${reset} ${dim}(${result.duration}ms)${reset}`);
        if (result.errors.length) console.warn(`  \x1b[33m⚠ ${result.errors.length} warning(s)\x1b[0m`);
        warnFallback(cg.getEngineFallback());
        cg.close();
      }
    });
}
