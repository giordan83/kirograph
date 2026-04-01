import { Command } from 'commander';
import { dim, reset, violet, bold, section } from '../ui';

export function register(program: Command): void {
  program
    .command('context <task>')
    .description('Build relevant code context for a task')
    .option('--max-nodes <n>', 'Max symbols to include', '20')
    .option('--no-code', 'Exclude code snippets')
    .option('--format <fmt>', 'Output format: markdown, json', 'markdown')
    .action(async (task: string, opts: { maxNodes: string; code: boolean; format: string }) => {
      const KiroGraph = (await import('../../index')).default;
      const cg = await KiroGraph.open(process.cwd());
      const ctx = await cg.buildContext(task, {
        maxNodes: parseInt(opts.maxNodes),
        includeCode: opts.code,
      });

      if (opts.format === 'json') {
        console.log(JSON.stringify({
          task: ctx.task,
          summary: ctx.summary,
          entryPoints: ctx.entryPoints.map((n: any) => ({ kind: n.kind, name: n.name, file: n.filePath, line: n.startLine })),
          relatedNodes: ctx.relatedNodes.map((n: any) => ({ kind: n.kind, name: n.name, file: n.filePath, line: n.startLine })),
          codeSnippets: Object.fromEntries(ctx.codeSnippets),
        }, null, 2));
        cg.close(); return;
      }

      // Markdown output
      console.log(`\n  ${section('Context:')} ${violet}${bold}${ctx.task}${reset}\n`);
      console.log(`  ${dim}${ctx.summary}${reset}`);
      if (ctx.entryPoints.length > 0) {
        console.log(`\n  ${section('Entry Points')}\n`);
        for (const n of ctx.entryPoints) {
          console.log(`  ${violet}${bold}${n.name}${reset}  ${dim}${n.kind}  ${n.filePath}:${n.startLine}${reset}`);
          if (ctx.codeSnippets.has(n.id)) {
            console.log(`\n  ${dim}\`\`\`${reset}`);
            for (const line of (ctx.codeSnippets.get(n.id) ?? '').split('\n')) {
              console.log(`  ${line}`);
            }
            console.log(`  ${dim}\`\`\`${reset}\n`);
          }
        }
      }
      if (ctx.relatedNodes.length > 0) {
        console.log(`\n  ${section('Related Symbols')}\n`);
        for (const n of ctx.relatedNodes) {
          console.log(`  ${dim}·${reset} ${violet}${n.name}${reset}  ${dim}${n.kind}  ${n.filePath}:${n.startLine}${reset}`);
        }
        console.log();
      }
      cg.close();
    });
}
