import { Command } from 'commander';
import * as path from 'path';
import { violet, bold, dim, reset } from '../ui';

function printTree(nodes: import('../../index').FileTreeNode[], prefix: string, metadata: boolean): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = prefix + (isLast ? '    ' : '│   ');
    const meta = metadata && node.type === 'file' && node.language
      ? `  \x1b[90m[${node.language}${node.symbolCount ? ` · ${node.symbolCount} symbols` : ''}]\x1b[0m`
      : '';
    console.log(`${prefix}${connector}${node.name}${meta}`);
    if (node.children?.length) printTree(node.children, childPrefix, metadata);
  }
}

function printFlat(nodes: import('../../index').FileTreeNode[], metadata: boolean, _prefix = ''): void {
  for (const node of nodes) {
    if (node.type === 'file') {
      const meta = metadata && node.language ? `  \x1b[90m[${node.language}]\x1b[0m` : '';
      console.log(`${node.path}${meta}`);
    }
    if (node.children) printFlat(node.children, metadata);
  }
}

function printGrouped(nodes: import('../../index').FileTreeNode[], metadata: boolean): void {
  const byLang = new Map<string, string[]>();
  function collect(ns: import('../../index').FileTreeNode[]): void {
    for (const n of ns) {
      if (n.type === 'file' && n.language) {
        const arr = byLang.get(n.language) ?? [];
        arr.push(n.path);
        byLang.set(n.language, arr);
      }
      if (n.children) collect(n.children);
    }
  }
  collect(nodes);
  for (const [lang, files] of byLang) {
    console.log(`\n  ${violet}${bold}${lang}${reset}  ${dim}(${files.length})${reset}`);
    for (const f of files) console.log(`  ${dim}${f}${reset}`);
  }
}

export function register(program: Command): void {
  program
    .command('files [projectPath]')
    .description('Show project file structure from the index')
    .option('--format <fmt>', 'Output format: tree, flat, grouped', 'tree')
    .option('--filter <path>', 'Filter by directory prefix')
    .option('--pattern <glob>', 'Filter by glob pattern')
    .option('--max-depth <n>', 'Limit tree depth')
    .option('--no-metadata', 'Hide language/symbol counts')
    .option('--json', 'Output as JSON')
    .action(async (projectPath: string | undefined, opts: {
      format: string; filter?: string; pattern?: string;
      maxDepth?: string; metadata: boolean; json?: boolean;
    }) => {
      const KiroGraph = (await import('../../index')).default;
      const target = path.resolve(projectPath ?? process.cwd());
      const cg = await KiroGraph.open(target);
      const tree = cg.getFiles({
        filterPath: opts.filter,
        pattern: opts.pattern,
        maxDepth: opts.maxDepth ? parseInt(opts.maxDepth) : undefined,
      });

      if (opts.json) { console.log(JSON.stringify(tree, null, 2)); cg.close(); return; }

      if (opts.format === 'flat') {
        printFlat(tree, opts.metadata);
      } else if (opts.format === 'grouped') {
        printGrouped(tree, opts.metadata);
      } else {
        printTree(tree, '', opts.metadata);
      }
      cg.close();
    });
}
