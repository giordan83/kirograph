import { Command } from 'commander';
import * as path from 'path';
import { loadConfig } from '../../config';
import { dim, reset, violet, bold, green } from '../ui';

// ── Staleness bar (10-char proportional) ─────────────────────────────────────

function stalenessBar(score: number): string {
  const filled = Math.round(score * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// ── JSON output type ──────────────────────────────────────────────────────────

interface StalenessRow {
  node_id: string;
  package_name: string;
  ecosystem: string;
  resolved_version: string | null;
  declared_constraint: string;
  latest_version: string | null;
  latest_published: number | null;
  staleness_score: number | null;
}

export function register(program: Command): void {
  program
    .command('staleness [projectPath]')
    .description('Check dependency freshness — identifies packages significantly behind their latest published version')
    .option('--threshold <n>', 'Show only packages with staleness_score >= n (default: 0.3)', '0.3')
    .option('--format <fmt>', 'Output format: table | json (default: table)', 'table')
    .option('--refresh', 'Fetch latest version info from registries before listing')
    .action(async (projectPath: string | undefined, opts: {
      threshold: string;
      format: string;
      refresh?: boolean;
    }) => {
      const target = path.resolve(projectPath ?? process.cwd());
      const config = await loadConfig(target);

      if (!config.enableSecurity) {
        console.error(`\n  ${'\x1b[33m'}⚠ Security analysis is disabled.${reset}`);
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
      const rawDb = db.getRawDb();

      const threshold = parseFloat(opts.threshold);
      if (isNaN(threshold) || threshold < 0 || threshold > 1) {
        console.error(`  ✖ --threshold must be a number between 0 and 1`);
        cg.close(); process.exit(1);
      }

      // Optionally refresh staleness data from registries
      if (opts.refresh) {
        console.error(`  ${dim}Fetching latest version info from package registries...${reset}`);
        const { StalenessChecker } = await import('../../security/staleness');
        const checker = new StalenessChecker(db);
        const result = await checker.checkAll();
        console.error(`  ${green}✓${reset} Checked ${bold}${result.checked}${reset} packages, ${bold}${result.stale}${reset} stale`);
        if (result.errors.length > 0) {
          console.error(`  ${'\x1b[33m'}⚠${reset} ${result.errors.length} error(s) during registry fetch`);
        }
        console.error();
      }

      // Query dependencies with staleness data
      const rows: StalenessRow[] = rawDb.all(
        `SELECT node_id, package_name, ecosystem, resolved_version, declared_constraint,
                latest_version, latest_published, staleness_score
         FROM sec_dependencies
         WHERE staleness_score >= ?
         ORDER BY staleness_score DESC`,
        [threshold],
      );

      const totalDeps: { count: number } = rawDb.get(
        `SELECT COUNT(*) as count FROM sec_dependencies`,
      ) ?? { count: 0 };

      if (opts.format === 'json') {
        console.log(JSON.stringify(rows.map(r => ({
          packageName: r.package_name,
          ecosystem: r.ecosystem,
          resolvedVersion: r.resolved_version ?? r.declared_constraint,
          latestVersion: r.latest_version,
          latestPublished: r.latest_published,
          stalenessScore: r.staleness_score,
        })), null, 2));
        cg.close();
        return;
      }

      // ── Table output ───────────────────────────────────────────────────────

      if (rows.length === 0) {
        console.log(`\n  ${dim}No stale dependencies found (threshold: ${threshold}).${reset}`);
        if (!opts.refresh) {
          console.log(`  ${dim}Run with${reset} ${violet}${bold}--refresh${reset} ${dim}to fetch latest version data from registries.${reset}`);
        }
        console.log();
        cg.close();
        return;
      }

      console.log(`\n  ${bold}Stale Dependencies${reset}\n`);

      for (const row of rows) {
        const resolved = row.resolved_version ?? row.declared_constraint ?? '?';
        const latest = row.latest_version ?? '?';
        const score = row.staleness_score ?? 0;
        const months = row.latest_published
          ? Math.round((Date.now() - row.latest_published) / (1000 * 60 * 60 * 24 * 30))
          : null;

        const bar = stalenessBar(score);
        const scoreStr = score.toFixed(2);

        // Colour the bar: red >= 0.7, yellow >= 0.4, dim otherwise
        let barColor = dim;
        if (score >= 0.7) barColor = '\x1b[31m';
        else if (score >= 0.4) barColor = '\x1b[33m';

        const pkgLabel = `${violet}${bold}${row.package_name}${reset} ${dim}(${row.ecosystem})${reset}`;
        const versionLabel = `${resolved} → ${green}${latest}${reset}`;
        const monthsLabel = months !== null ? `${months}mo since latest` : 'publish date unknown';

        console.log(`  ${pkgLabel}`);
        console.log(`    ${versionLabel}  ${dim}${monthsLabel}${reset}`);
        console.log(`    ${barColor}${bar}${reset} ${dim}${scoreStr}${reset}`);
        console.log();
      }

      const staleCount = rows.length;
      const totalCount = totalDeps.count;
      console.log(`  ${bold}${staleCount}${reset} of ${bold}${totalCount}${reset} ${dim}dependenc${staleCount === 1 ? 'y is' : 'ies are'} stale (score >= ${threshold})${reset}\n`);

      cg.close();
    });
}
