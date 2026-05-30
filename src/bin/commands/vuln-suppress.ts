import { Command } from 'commander';
import * as path from 'path';
import { dim, reset, violet, bold, green } from '../ui';
import { SuppressionManager } from '../../security/suppressions';

export function register(program: Command): void {
  const vulnCmd = program
    .command('vuln')
    .description('CVE suppression management');

  vulnCmd
    .command('suppress <cveId> [projectPath]')
    .description('Mark a CVE as suppressed (false positive or accepted risk)')
    .option('--reason <text>', 'Reason for suppression')
    .option('--expires <date>', 'Expiry date in ISO format (e.g. 2026-12-31)')
    .action(async (cveId: string, projectPath: string | undefined, opts: {
      reason?: string;
      expires?: string;
    }) => {
      const target = path.resolve(projectPath ?? process.cwd());
      const manager = new SuppressionManager(target);
      manager.add(cveId, opts.reason, opts.expires);
      const reasonNote = opts.reason ? ` ${dim}(${opts.reason})${reset}` : '';
      console.log(`  ${green}✓${reset} ${violet}${bold}${cveId}${reset} suppressed${reasonNote}`);
    });

  vulnCmd
    .command('unsuppress <cveId> [projectPath]')
    .description('Remove a CVE suppression')
    .action(async (cveId: string, projectPath: string | undefined) => {
      const target = path.resolve(projectPath ?? process.cwd());
      const manager = new SuppressionManager(target);
      const removed = manager.remove(cveId);
      if (!removed) {
        console.error(`  ✖ No suppression found for ${violet}${bold}${cveId}${reset}`);
        process.exit(1);
      }
      console.log(`  ${green}✓${reset} ${violet}${bold}${cveId}${reset} unsuppressed`);
    });

  vulnCmd
    .command('suppressions [projectPath]')
    .description('List all active CVE suppressions')
    .option('--format <fmt>', 'Output format: table | json', 'table')
    .action(async (projectPath: string | undefined, opts: { format?: string }) => {
      const target = path.resolve(projectPath ?? process.cwd());
      const manager = new SuppressionManager(target);
      const suppressions = manager.getActive();

      if (opts.format === 'json') {
        console.log(JSON.stringify(suppressions, null, 2));
        return;
      }

      if (suppressions.length === 0) {
        console.log(`\n  ${dim}No active suppressions.${reset}\n`);
        return;
      }

      const CVE_W = Math.max(6, ...suppressions.map(s => s.cveId.length));
      const DATE_W = 12;
      const EXP_W = 12;

      const header =
        `  ${bold}${'CVE ID'.padEnd(CVE_W)}${reset}  ` +
        `${bold}${'Suppressed At'.padEnd(DATE_W)}${reset}  ` +
        `${bold}${'Expires'.padEnd(EXP_W)}${reset}  ` +
        `${bold}Reason${reset}`;

      const separator = `  ${'─'.repeat(CVE_W)}  ${'─'.repeat(DATE_W)}  ${'─'.repeat(EXP_W)}  ${'─'.repeat(20)}`;

      console.log(`\n  ${bold}Active Suppressions${reset} (${suppressions.length})\n`);
      console.log(header);
      console.log(separator);

      for (const s of suppressions) {
        const suppressedDate = s.suppressedAt.slice(0, 10);
        const expiresStr = s.expiresAt ? s.expiresAt.slice(0, 10) : dim + '—' + reset;
        const reasonStr = s.reason ? `${dim}${s.reason}${reset}` : `${dim}—${reset}`;
        console.log(
          `  ${violet}${s.cveId.padEnd(CVE_W)}${reset}  ` +
          `${suppressedDate.padEnd(DATE_W)}  ` +
          `${expiresStr.padEnd(EXP_W + (s.expiresAt ? 0 : (dim + reset).length))}  ` +
          `${reasonStr}`,
        );
      }

      console.log();
    });
}
