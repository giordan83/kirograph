import { Command } from 'commander';
import * as path from 'path';
import { loadConfig } from '../../config';
import { dim, reset, violet, bold, green, section } from '../ui';

export function register(program: Command): void {
  program
    .command('security [projectPath]')
    .description('Show security overview: vulnerabilities, reachability verdicts, stale data warnings')
    .action(async (projectPath: string | undefined) => {
      const target = path.resolve(projectPath ?? process.cwd());
      const config = await loadConfig(target);

      if (!config.enableSecurity) {
        console.error(`\n  ${'\x1b[33m'}⚠ Security analysis is disabled.${reset}`);
        console.error(`  ${dim}Enable it in .kirograph/config.json:${reset} ${violet}${bold}"enableSecurity": true${reset}`);
        console.error(`  ${dim}Then re-run:${reset} ${violet}${bold}kirograph index${reset}\n`);
        process.exit(1);
      }

      if (!config.enableArchitecture) {
        console.error(`\n  ${'\x1b[33m'}⚠ Security requires Architecture analysis to be enabled.${reset}`);
        console.error(`  ${dim}Enable both in .kirograph/config.json:${reset}`);
        console.error(`    ${violet}${bold}"enableArchitecture": true${reset}`);
        console.error(`    ${violet}${bold}"enableSecurity": true${reset}`);
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
      const rawDb = db.getRawDb();

      // Query dependency counts
      const depCount: { count: number } = rawDb.get(
        `SELECT COUNT(*) as count FROM sec_dependencies`,
      ) ?? { count: 0 };

      // Query vulnerability counts
      const vulnCount: { count: number } = rawDb.get(
        `SELECT COUNT(*) as count FROM sec_vulnerabilities`,
      ) ?? { count: 0 };

      // Query reachability verdict counts
      const verdictRows: Array<{ verdict: string; count: number }> = rawDb.all(
        `SELECT verdict, COUNT(*) as count FROM sec_reachability GROUP BY verdict`,
      );
      const verdicts: Record<string, number> = {};
      for (const row of verdictRows) {
        verdicts[row.verdict] = row.count;
      }

      // Check for stale data
      const staleCount: { count: number } = rawDb.get(
        `SELECT COUNT(*) as count FROM sec_dependencies WHERE vuln_data_stale = 1`,
      ) ?? { count: 0 };

      // Display overview
      console.log(`\n  ${section('Security Overview')}\n`);
      console.log(`  ${dim}Dependencies:${reset}          ${violet}${bold}${depCount.count}${reset}`);
      console.log(`  ${dim}Vulnerabilities:${reset}       ${violet}${bold}${vulnCount.count}${reset}`);
      console.log();

      if (vulnCount.count > 0) {
        console.log(`  ${section('Reachability Verdicts')}\n`);
        const affected = verdicts['affected'] ?? 0;
        const notAffected = verdicts['not_affected'] ?? 0;
        const underInvestigation = verdicts['under_investigation'] ?? 0;
        const noAnalysis = vulnCount.count - affected - notAffected - underInvestigation;

        if (affected > 0) {
          console.log(`  ${'\x1b[31m'}●${reset} Affected:              ${bold}${affected}${reset}`);
        }
        if (notAffected > 0) {
          console.log(`  ${green}●${reset} Not affected:          ${bold}${notAffected}${reset}`);
        }
        if (underInvestigation > 0) {
          console.log(`  ${'\x1b[33m'}●${reset} Under investigation:   ${bold}${underInvestigation}${reset}`);
        }
        if (noAnalysis > 0) {
          console.log(`  ${dim}●${reset} Pending analysis:      ${bold}${noAnalysis}${reset}`);
        }
        console.log();
      }

      if (staleCount.count > 0) {
        console.log(`  ${'\x1b[33m'}⚠${reset} ${bold}${staleCount.count}${reset} ${dim}dependenc${staleCount.count === 1 ? 'y has' : 'ies have'} stale vulnerability data.${reset}`);
        console.log(`  ${dim}Run${reset} ${violet}${bold}kirograph vulns --refresh${reset} ${dim}to update.${reset}\n`);
      }

      cg.close();
    });
}
