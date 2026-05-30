import { Command } from 'commander';
import * as path from 'path';
import { loadConfig } from '../../config';
import { dim, reset, violet, bold, green } from '../ui';

const red    = '\x1b[31m';
const yellow = '\x1b[33m';

type Threshold = 'critical' | 'high' | 'medium' | 'low';

const RISK_ORDER: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
};

function riskColor(level: string): string {
  switch (level) {
    case 'critical': return red;
    case 'high':     return yellow;
    case 'medium':   return '\x1b[33m';
    case 'low':      return green;
    default:         return dim;
  }
}

export function register(program: Command): void {
  program
    .command('supply-chain [projectPath]')
    .description('Assess supply-chain health: OpenSSF Scorecard, maintainer count, package age, and risk level')
    .option('--threshold <level>', 'Show only at or above risk level: critical|high|medium|low (default: low)', 'low')
    .option('--refresh', 'Re-fetch data from registries and Scorecard API')
    .option('--format <fmt>', 'Output format: table | json (default: table)', 'table')
    .action(async (projectPath: string | undefined, opts: {
      threshold: string;
      refresh?: boolean;
      format: string;
    }) => {
      const target = path.resolve(projectPath ?? process.cwd());
      const config = await loadConfig(target);

      if (!config.enableSecurity) {
        console.error(`\n  ${yellow}⚠ Security analysis is disabled.${reset}`);
        console.error(`  ${dim}Enable it in .kirograph/config.json:${reset} ${violet}${bold}"enableSecurity": true${reset}`);
        console.error(`  ${dim}Then re-run:${reset} ${violet}${bold}kirograph index${reset}\n`);
        process.exit(1);
      }

      const thresholdLevel = opts.threshold as Threshold;
      if (!['critical', 'high', 'medium', 'low'].includes(thresholdLevel)) {
        console.error(`  ✖ --threshold must be one of: critical | high | medium | low`);
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

      const { SupplyChainChecker } = await import('../../security/supply-chain');
      const checker = new SupplyChainChecker(db);

      if (opts.refresh || opts.format !== 'json') {
        console.error(`  ${dim}Fetching supply-chain data from registries...${reset}`);
      }

      const { results, errors } = await checker.checkAll();

      if (errors.length > 0) {
        console.error(`  ${yellow}⚠${reset} ${errors.length} error(s) during fetch`);
      }

      // Filter by threshold
      const thresholdOrder = RISK_ORDER[thresholdLevel] ?? 0;
      const filtered = results.filter(r => (RISK_ORDER[r.riskLevel] ?? 0) >= thresholdOrder);

      // Sort by risk descending
      filtered.sort((a, b) => (RISK_ORDER[b.riskLevel] ?? 0) - (RISK_ORDER[a.riskLevel] ?? 0));

      if (opts.format === 'json') {
        console.log(JSON.stringify(filtered, null, 2));
        cg.close();
        return;
      }

      if (filtered.length === 0) {
        console.log(`\n  ${dim}No supply-chain risks found at or above threshold: ${thresholdLevel}.${reset}`);
        console.log(`  ${dim}Run with${reset} ${violet}${bold}--refresh${reset} ${dim}to re-fetch from registries.${reset}\n`);
        cg.close();
        return;
      }

      console.log(`\n  ${violet}${bold}Supply-Chain Health${reset}\n`);

      for (const r of filtered) {
        const scoreStr = r.scorecardScore !== null ? r.scorecardScore.toFixed(1) : 'n/a';
        const maintStr = r.maintainerCount !== null ? String(r.maintainerCount) : 'n/a';
        const daysStr  = r.daysSinceLastCommit !== null ? `${r.daysSinceLastCommit}d` : 'n/a';
        const color    = riskColor(r.riskLevel);

        console.log(`  ${violet}${bold}${r.packageName}${reset} ${dim}(${r.ecosystem})${reset}`);
        console.log(`    Scorecard: ${dim}${scoreStr}/10${reset}   Maintainers: ${dim}${maintStr}${reset}   Last activity: ${dim}${daysStr}${reset}`);
        console.log(`    Risk: ${color}${bold}${r.riskLevel.toUpperCase()}${reset}`);

        if (r.riskReasons.length > 0) {
          for (const reason of r.riskReasons) {
            console.log(`      ${dim}•${reset} ${reason}`);
          }
        }
        console.log();
      }

      const total = results.length;
      console.log(`  ${bold}${filtered.length}${reset} of ${bold}${total}${reset} ${dim}packages flagged (threshold: ${thresholdLevel})${reset}\n`);

      cg.close();
    });
}
