import { Command } from 'commander';
import * as path from 'path';
import { loadConfig } from '../../config';
import { dim, reset, violet, bold, green } from '../ui';
import { formatFixSuggestion } from '../../security/export/fix-suggestions';

export function register(program: Command): void {
  program
    .command('vulns [projectPath]')
    .description('List vulnerabilities with reachability verdicts and severity')
    .option('--severity <level>', 'Filter by severity: critical, high, medium, low')
    .option('--verdict <verdict>', 'Filter by verdict: affected, not_affected, under_investigation')
    .option('--refresh', 'Trigger fresh vulnerability enrichment before listing')
    .option('--epss <threshold>', 'Filter by EPSS score (e.g. 0.5 shows only vulns with EPSS >= 0.5)')
    .option('--stale', 'Show staleness score of the affected dependency alongside each CVE')
    .option('--add <cveId>', 'Manually register a CVE')
    .option('--package <name>', 'Package name for --add')
    .option('--version <ver>', 'Package version for --add')
    .action(async (projectPath: string | undefined, opts: {
      severity?: string;
      verdict?: string;
      refresh?: boolean;
      epss?: string;
      stale?: boolean;
      add?: string;
      package?: string;
      version?: string;
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

      // Handle --add: manually register a CVE
      if (opts.add) {
        if (!opts.package || !opts.version) {
          console.error(`  ✖ --add requires --package <name> and --version <ver>`);
          cg.close(); process.exit(1);
        }

        const cveId = opts.add;
        const pkgName = opts.package;
        const pkgVersion = opts.version;

        // Find the matching dependency node
        const depRow: { node_id: string; ecosystem: string } | undefined = rawDb.get(
          `SELECT node_id, ecosystem FROM sec_dependencies
           WHERE package_name = ? AND (resolved_version = ? OR declared_constraint = ?)`,
          [pkgName, pkgVersion, pkgVersion],
        );

        if (!depRow) {
          console.error(`  ✖ No dependency found matching ${violet}${pkgName}@${pkgVersion}${reset}`);
          console.error(`  ${dim}Run${reset} ${violet}${bold}kirograph index${reset} ${dim}first to discover dependencies.${reset}`);
          cg.close(); process.exit(1);
        }

        // Create the vulnerability node
        const vulnNodeId = `vuln:${cveId}`;
        const now = Date.now();

        rawDb.run(
          `INSERT OR REPLACE INTO nodes
            (id, kind, name, qualified_name, file_path, language,
             start_line, end_line, start_column, end_column,
             is_exported, is_async, is_static, is_abstract, updated_at)
           VALUES (?, 'vulnerability', ?, ?, '', 'unknown', 0, 0, 0, 0, 0, 0, 0, 0, ?)`,
          [vulnNodeId, cveId, cveId, now],
        );

        rawDb.run(
          `INSERT OR REPLACE INTO sec_vulnerabilities
            (node_id, cve_id, severity_score, affected_ranges, fixed_version, summary, source_database)
           VALUES (?, ?, NULL, '[]', NULL, 'Manually registered', 'manual')`,
          [vulnNodeId, cveId],
        );

        // Create has_vulnerability edge
        rawDb.run(
          `INSERT OR IGNORE INTO edges (source, target, kind, confidence, confidence_score)
           VALUES (?, ?, 'has_vulnerability', 'extracted', 1.0)`,
          [depRow.node_id, vulnNodeId],
        );

        console.log(`  ${green}✓${reset} Registered ${violet}${bold}${cveId}${reset} against ${violet}${pkgName}@${pkgVersion}${reset}`);
        cg.close();
        return;
      }

      // Handle --refresh: trigger fresh vulnerability enrichment
      if (opts.refresh) {
        console.error(`  ${dim}Refreshing vulnerability data from configured databases...${reset}`);
        const { OsvAdapter } = await import('../../security/vuln/osv-adapter');
        const { VulnerabilityDatabaseClient } = await import('../../security/vuln/client');

        const adapters = config.securityDatabases.map((dbName: string) => {
          if (dbName.toUpperCase() === 'OSV') return new OsvAdapter();
          return null;
        }).filter(Boolean) as any[];

        const client = new VulnerabilityDatabaseClient(adapters, db);
        const result = await client.enrichAll();

        console.error(`  ${green}✓${reset} Checked ${bold}${result.dependenciesChecked}${reset} dependencies, found ${bold}${result.vulnerabilitiesFound}${reset} vulnerabilities`);
        if (result.errors.length > 0) {
          console.error(`  ${'\x1b[33m'}⚠${reset} ${result.errors.length} error(s) during enrichment`);
        }
        console.error();
      }

      // Build query for listing vulnerabilities
      let query = `
        SELECT
          v.node_id, v.cve_id, v.severity_score, v.fixed_version, v.summary, v.source_database,
          v.epss_score, v.epss_percentile,
          d.package_name, d.ecosystem, d.resolved_version, d.declared_constraint,
          d.staleness_score,
          r.verdict
        FROM sec_vulnerabilities v
        LEFT JOIN edges e ON e.target = v.node_id AND e.kind = 'has_vulnerability'
        LEFT JOIN sec_dependencies d ON d.node_id = e.source
        LEFT JOIN sec_reachability r ON r.vulnerability_node_id = v.node_id
        WHERE 1=1
      `;
      const params: any[] = [];

      // Apply severity filter
      if (opts.severity) {
        const severityRanges: Record<string, [number, number]> = {
          critical: [9.0, 10.0],
          high: [7.0, 8.9],
          medium: [4.0, 6.9],
          low: [0.1, 3.9],
        };
        const range = severityRanges[opts.severity.toLowerCase()];
        if (!range) {
          console.error(`  ✖ Invalid severity: ${opts.severity}. Use: critical, high, medium, low`);
          cg.close(); process.exit(1);
        }
        query += ` AND v.severity_score >= ? AND v.severity_score <= ?`;
        params.push(range[0], range[1]);
      }

      // Apply verdict filter
      if (opts.verdict) {
        const validVerdicts = ['affected', 'not_affected', 'under_investigation'];
        if (!validVerdicts.includes(opts.verdict)) {
          console.error(`  ✖ Invalid verdict: ${opts.verdict}. Use: affected, not_affected, under_investigation`);
          cg.close(); process.exit(1);
        }
        query += ` AND r.verdict = ?`;
        params.push(opts.verdict);
      }

      // Apply EPSS threshold filter
      if (opts.epss !== undefined) {
        const epssThreshold = parseFloat(opts.epss);
        if (isNaN(epssThreshold) || epssThreshold < 0 || epssThreshold > 1) {
          console.error(`  ✖ Invalid EPSS threshold: ${opts.epss}. Use a number between 0 and 1 (e.g. 0.5)`);
          cg.close(); process.exit(1);
        }
        query += ` AND v.epss_score >= ?`;
        params.push(epssThreshold);
      }

      query += ` ORDER BY v.severity_score DESC NULLS LAST`;

      const rows: Array<{
        node_id: string;
        cve_id: string;
        severity_score: number | null;
        fixed_version: string | null;
        summary: string | null;
        source_database: string;
        epss_score: number | null;
        epss_percentile: number | null;
        package_name: string | null;
        ecosystem: string | null;
        resolved_version: string | null;
        declared_constraint: string | null;
        staleness_score: number | null;
        verdict: string | null;
      }> = rawDb.all(query, params);

      if (rows.length === 0) {
        const filterNote = (opts.severity || opts.verdict)
          ? ` matching filters`
          : '';
        console.log(`\n  ${dim}No vulnerabilities found${filterNote}.${reset}\n`);
        cg.close();
        return;
      }

      console.log(`\n  ${bold}Vulnerabilities${reset} (${rows.length})\n`);

      for (const row of rows) {
        // Severity badge
        const score = row.severity_score;
        let severityLabel: string;
        let severityColor: string;
        if (score == null) {
          severityLabel = 'unknown';
          severityColor = dim;
        } else if (score >= 9.0) {
          severityLabel = 'CRITICAL';
          severityColor = '\x1b[31m';
        } else if (score >= 7.0) {
          severityLabel = 'HIGH';
          severityColor = '\x1b[31m';
        } else if (score >= 4.0) {
          severityLabel = 'MEDIUM';
          severityColor = '\x1b[33m';
        } else {
          severityLabel = 'LOW';
          severityColor = dim;
        }

        // Verdict badge
        let verdictLabel: string;
        let verdictColor: string;
        if (!row.verdict) {
          verdictLabel = 'pending';
          verdictColor = dim;
        } else if (row.verdict === 'affected') {
          verdictLabel = 'affected';
          verdictColor = '\x1b[31m';
        } else if (row.verdict === 'not_affected') {
          verdictLabel = 'not affected';
          verdictColor = green;
        } else {
          verdictLabel = 'investigating';
          verdictColor = '\x1b[33m';
        }

        const pkg = row.package_name
          ? `${row.package_name}@${row.resolved_version || row.declared_constraint || '?'}`
          : 'unknown package';

        // EPSS badge
        let epssBadge = '';
        if (row.epss_score != null && row.epss_percentile != null) {
          const epssColor = row.epss_score >= 0.3 ? '\x1b[33m' : dim;
          const scoreStr = row.epss_score.toFixed(2);
          const pctStr = `${Math.round(row.epss_percentile * 100)}th%`;
          epssBadge = `  ${epssColor}${dim}[EPSS: ${scoreStr} / ${pctStr}]${reset}`;
        }

        console.log(`  ${severityColor}${severityLabel}${reset}  ${violet}${bold}${row.cve_id}${reset}  ${dim}${pkg}${reset}  [${verdictColor}${verdictLabel}${reset}]${epssBadge}`);

        if (row.summary && row.summary !== 'Manually registered') {
          const truncated = row.summary.length > 100 ? row.summary.slice(0, 100) + '…' : row.summary;
          console.log(`    ${dim}${truncated}${reset}`);
        }

        // Staleness badge (when --stale flag is set)
        if (opts.stale && row.staleness_score != null) {
          const s = row.staleness_score;
          const staleColor = s >= 0.7 ? '\x1b[31m' : s >= 0.4 ? '\x1b[33m' : dim;
          console.log(`    ${staleColor}${dim}[staleness: ${s.toFixed(2)}]${reset}`);
        }

        // Fix suggestion
        if (row.fixed_version && row.ecosystem && row.package_name) {
          const fix = formatFixSuggestion(row.ecosystem, row.package_name, row.fixed_version);
          if (fix) {
            console.log(`    ${fix}`);
          }
        }

        console.log();
      }

      cg.close();
    });
}
