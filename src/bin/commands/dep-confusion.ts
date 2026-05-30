import { Command } from 'commander';
import * as path from 'path';
import { loadConfig } from '../../config';
import { dim, reset, violet, bold, green } from '../ui';

const red    = '\x1b[31m';
const yellow = '\x1b[33m';

function riskColor(level: string): string {
  switch (level) {
    case 'critical': return red;
    case 'high':     return yellow;
    case 'medium':   return '\x1b[33m';
    default:         return dim;
  }
}

export function register(program: Command): void {
  program
    .command('dep-confusion [projectPath]')
    .description('Detect dependency confusion: internal packages exposed in public registries, and typosquatting candidates')
    .option('--format <fmt>', 'Output format: table | json (default: table)', 'table')
    .action(async (projectPath: string | undefined, opts: { format: string }) => {
      const target = path.resolve(projectPath ?? process.cwd());
      const config = await loadConfig(target);

      if (!config.enableSecurity) {
        console.error(`\n  ${yellow}⚠ Security analysis is disabled.${reset}`);
        console.error(`  ${dim}Enable it in .kirograph/config.json:${reset} ${violet}${bold}"enableSecurity": true${reset}`);
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
      db.applySecuritySchema();

      if (opts.format !== 'json') {
        console.error(`  ${dim}Checking for dependency confusion risks...${reset}`);
      }

      const { DepConfusionChecker } = await import('../../security/dep-confusion');
      const checker = new DepConfusionChecker(db);
      const findings = await checker.check();

      if (opts.format === 'json') {
        console.log(JSON.stringify(findings, null, 2));
        cg.close();
        return;
      }

      if (findings.length === 0) {
        console.log(`\n  ${green}✓${reset} No dependency confusion risks detected.\n`);
        cg.close();
        return;
      }

      console.log(`\n  ${violet}${bold}Dependency Confusion Findings${reset}\n`);

      for (const f of findings) {
        const color = riskColor(f.riskLevel);
        console.log(`  ${violet}${bold}${f.packageName}${reset} ${dim}(${f.ecosystem})${reset}`);
        console.log(`    Risk: ${color}${bold}${f.riskLevel.toUpperCase()}${reset}   Source: ${dim}${f.internalSource}${reset}`);
        if (f.publicExists) {
          const ver = f.publicVersion ? ` v${f.publicVersion}` : '';
          console.log(`    Public package exists:${ver}`);
        }
        console.log(`    ${dim}${f.explanation}${reset}`);
        console.log();
      }

      const critical = findings.filter(f => f.riskLevel === 'critical').length;
      const high     = findings.filter(f => f.riskLevel === 'high').length;
      const medium   = findings.filter(f => f.riskLevel === 'medium').length;

      const parts: string[] = [];
      if (critical > 0) parts.push(`${red}${bold}${critical} critical${reset}`);
      if (high > 0)     parts.push(`${yellow}${bold}${high} high${reset}`);
      if (medium > 0)   parts.push(`${dim}${medium} medium${reset}`);
      console.log(`  ${bold}${findings.length}${reset} finding(s): ${parts.join(', ')}\n`);

      cg.close();
    });
}
