import { Command } from 'commander';
import * as path from 'path';
import { loadConfig } from '../../config';
import { dim, reset, violet, bold, green } from '../ui';

const red    = '\x1b[31m';
const yellow = '\x1b[33m';

function slaColor(status: string): string {
  switch (status) {
    case 'ok':      return green;
    case 'warning': return yellow;
    case 'overdue': return red;
    case 'no_fix':  return dim;
    default:        return dim;
  }
}

function formatDate(epochMs: number | null): string {
  if (epochMs === null) return 'n/a';
  return new Date(epochMs).toISOString().slice(0, 10);
}

export function register(program: Command): void {
  program
    .command('remediation [projectPath]')
    .description('Track remediation SLA: how long vulnerabilities have been open and whether fixes are overdue')
    .option('--overdue-only', 'Show only overdue items')
    .option('--format <fmt>', 'Output format: table | json (default: table)', 'table')
    .action(async (projectPath: string | undefined, opts: {
      overdueOnly?: boolean;
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

      const KiroGraph = (await import('../../index')).default;
      if (!KiroGraph.isInitialized(target)) {
        console.error('  ✖ KiroGraph not initialized. Run: kirograph init');
        process.exit(1);
      }

      const cg = await KiroGraph.open(target);
      const db = cg.getDatabase();
      db.applySecuritySchema();

      const { RemediationTracker } = await import('../../security/remediation');
      const tracker = new RemediationTracker(db);

      let statuses = tracker.getStatus();

      // Sort: overdue first, then warning, then by daysOpen desc
      const ORDER: Record<string, number> = { overdue: 3, warning: 2, no_fix: 1, ok: 0 };
      statuses.sort((a, b) => {
        const diff = (ORDER[b.slaStatus] ?? 0) - (ORDER[a.slaStatus] ?? 0);
        if (diff !== 0) return diff;
        return (b.daysOpen ?? 0) - (a.daysOpen ?? 0);
      });

      if (opts.overdueOnly) {
        statuses = statuses.filter(s => s.isOverdue);
      }

      if (opts.format === 'json') {
        console.log(JSON.stringify(statuses, null, 2));
        cg.close();
        return;
      }

      if (statuses.length === 0) {
        const msg = opts.overdueOnly
          ? 'No overdue vulnerabilities found.'
          : 'No tracked vulnerabilities with detection timestamps found.';
        console.log(`\n  ${dim}${msg}${reset}`);
        console.log(`  ${dim}Detection timestamps are recorded when vulnerabilities are first inserted via${reset} ${violet}${bold}kirograph vulns --refresh${reset}\n`);
        cg.close();
        return;
      }

      console.log(`\n  ${violet}${bold}Remediation SLA Tracking${reset}\n`);

      for (const s of statuses) {
        const sevStr   = s.severity !== null ? s.severity.toFixed(1) : 'n/a';
        const daysOpen = s.daysOpen !== null ? `${s.daysOpen}d` : 'n/a';
        const fixSince = s.fixAvailableSince !== null ? `${s.daysWithFixAvailable}d ago (${formatDate(s.fixAvailableSince)})` : 'no fix';
        const deadline = s.slaDeadline !== null ? formatDate(s.slaDeadline) : 'n/a';
        const color    = slaColor(s.slaStatus);

        console.log(`  ${violet}${bold}${s.cveId}${reset}  ${dim}${s.packageName}${reset}`);
        console.log(`    CVSS: ${dim}${sevStr}${reset}   Open: ${dim}${daysOpen}${reset}   Fix available: ${dim}${fixSince}${reset}`);
        console.log(`    SLA status: ${color}${bold}${s.slaStatus.toUpperCase()}${reset}   Deadline: ${dim}${deadline}${reset}`);
        console.log();
      }

      const overdueCount = statuses.filter(s => s.slaStatus === 'overdue').length;
      const warningCount = statuses.filter(s => s.slaStatus === 'warning').length;
      const noFixCount   = statuses.filter(s => s.slaStatus === 'no_fix').length;

      const parts: string[] = [];
      if (overdueCount > 0) parts.push(`${red}${bold}${overdueCount} overdue${reset}`);
      if (warningCount > 0) parts.push(`${yellow}${bold}${warningCount} warning${reset}`);
      if (noFixCount > 0)   parts.push(`${dim}${noFixCount} no fix available${reset}`);

      console.log(`  ${bold}${statuses.length}${reset} open vulnerabilit${statuses.length === 1 ? 'y' : 'ies'}${parts.length > 0 ? `: ${parts.join(', ')}` : ''}\n`);

      cg.close();
    });
}
