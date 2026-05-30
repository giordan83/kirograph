import { Command } from 'commander';
import * as path from 'path';
import { loadConfig } from '../../config';
import { dim, reset, violet, bold, section } from '../ui';

const TYPE_VALUES = ['sql', 'xss', 'eval', 'deserialize', 'path', 'all'] as const;
type FlowType = (typeof TYPE_VALUES)[number];

function mapTypeToFindingType(t: FlowType): string[] {
  switch (t) {
    case 'sql':         return ['sql-injection'];
    case 'xss':         return ['xss'];
    case 'eval':        return ['dangerous-eval'];
    case 'deserialize': return ['unsafe-deserialize'];
    case 'path':        return ['path-traversal'];
    case 'all':
    default:            return ['sql-injection', 'xss', 'dangerous-eval', 'unsafe-deserialize', 'path-traversal', 'hardcoded-crypto'];
  }
}

function severityColor(severity: string): string {
  if (severity === 'critical') return '\x1b[31m';
  if (severity === 'high')     return '\x1b[31m';
  if (severity === 'medium')   return '\x1b[33m';
  return dim;
}

export function register(program: Command): void {
  program
    .command('flows [projectPath]')
    .description('SAST-lite: detect dangerous data flows in source code (eval, SQL injection, path traversal, etc.)')
    .option('--type <type>', `Filter by type: ${TYPE_VALUES.join('|')} (default: all)`, 'all')
    .option('--format <fmt>', 'Output format: text|json (default: text)', 'text')
    .action(async (projectPath: string | undefined, opts: { type: string; format: string }) => {
      const target = path.resolve(projectPath ?? process.cwd());
      const config = await loadConfig(target);

      // Validate --type
      if (!TYPE_VALUES.includes(opts.type as FlowType)) {
        console.error(`  ✖ Invalid --type value: ${opts.type}. Use: ${TYPE_VALUES.join(', ')}`);
        process.exit(1);
      }

      // Validate --format
      if (opts.format !== 'text' && opts.format !== 'json') {
        console.error(`  ✖ Invalid --format value: ${opts.format}. Use: text, json`);
        process.exit(1);
      }

      if (!config.enableArchitecture) {
        console.error(`\n  ${'\x1b[33m'}⚠ security-flows requires Architecture analysis to be enabled.${reset}`);
        console.error(`  ${dim}Enable it in .kirograph/config.json:${reset} ${violet}${bold}"enableArchitecture": true${reset}`);
        console.error(`  ${dim}Then re-run:${reset} ${violet}${bold}kirograph index${reset}\n`);
        process.exit(1);
      }

      const KiroGraph = (await import('../../index')).default;
      if (!KiroGraph.isInitialized(target)) {
        console.error('  ✖ KiroGraph not initialized. Run: kirograph init');
        process.exit(1);
      }

      const cg = await KiroGraph.open(target);
      const db = cg.getDatabase();

      const { DataFlowAnalyzer } = await import('../../security/data-flows');
      const analyzer = new DataFlowAnalyzer(db);
      let findings = await analyzer.analyze();

      // Apply type filter
      const allowedTypes = mapTypeToFindingType(opts.type as FlowType);
      findings = findings.filter((f) => allowedTypes.includes(f.type));

      if (opts.format === 'json') {
        process.stdout.write(JSON.stringify(findings, null, 2) + '\n');
        cg.close();
        return;
      }

      // ── Text output ──────────────────────────────────────────────────────────

      if (findings.length === 0) {
        console.log(`\n  ${dim}No dangerous data flow findings.${reset}\n`);
        cg.close();
        return;
      }

      console.log(`\n  ${section('Data Flow Findings')} (${findings.length})\n`);

      for (const f of findings) {
        const sc = severityColor(f.severity);
        const severityLabel = f.severity.toUpperCase().padEnd(8);
        const typeLabel = f.type.padEnd(20);
        const loc = `${path.relative(target, f.filePath) || f.filePath}:${f.line}`;

        console.log(`  ${sc}${severityLabel}${reset}  ${violet}${bold}[${f.owaspCategory}]${reset}  ${dim}${typeLabel}${reset}  ${loc}`);
        console.log(`  ${dim}Symbol:${reset} ${bold}${f.symbol}${reset}`);
        console.log(`  ${dim}${f.description}${reset}`);
        console.log(`  ${'\x1b[33m'}Recommendation:${reset} ${f.recommendation}`);
        console.log();
      }

      cg.close();
    });
}
