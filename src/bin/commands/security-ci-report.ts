/**
 * kirograph security ci-report
 *
 * Generates a structured security report for CI/CD pipelines.
 * Supports JSON, SARIF 2.1.0, and compact text output formats.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from '../../config';
import { dim, reset, violet, bold, green } from '../ui';
import { mapCveToOwasp, OWASP_TOP_10 } from '../../security/owasp';

// ── Report types ──────────────────────────────────────────────────────────────

interface CiVulnEntry {
  cveId: string;
  packageName: string | null;
  ecosystem: string | null;
  version: string | null;
  severityScore: number | null;
  verdict: string | null;
  riskScore: number | null;
  owaspCategory: string;
  owaspName: string;
  summary: string | null;
  fixedVersion: string | null;
}

interface CiReport {
  version: '1.0';
  timestamp: string;
  project: string;
  summary: {
    dependencies: number;
    vulnerabilities: number;
    affected: number;
    riskScore: number;
    secretsFound: number;
    owaspCategories: string[];
  };
  vulnerabilities: CiVulnEntry[];
  secrets: unknown[];
  exitCode: number;
}

// ── SARIF types ───────────────────────────────────────────────────────────────

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  helpUri: string;
  properties: { tags: string[] };
}

interface SarifResult {
  ruleId: string;
  message: { text: string };
  level: 'error' | 'warning' | 'note';
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string; uriBaseId: string };
      region: { startLine: number };
    };
  }>;
  properties: Record<string, unknown>;
}

interface SarifOutput {
  $schema: string;
  version: '2.1.0';
  runs: Array<{
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: SarifRule[];
      };
    };
    results: SarifResult[];
  }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function severityToSarifLevel(score: number | null): 'error' | 'warning' | 'note' {
  if (score == null) return 'note';
  if (score >= 7.0) return 'error';
  if (score >= 4.0) return 'warning';
  return 'note';
}

function computeMaxRisk(vulns: CiVulnEntry[]): number {
  const scores = vulns.map((v) => v.riskScore ?? v.severityScore ?? 0);
  return scores.length > 0 ? Math.max(...scores) : 0;
}

function collectOwaspCategories(vulns: CiVulnEntry[]): string[] {
  const cats = new Set<string>(vulns.map((v) => v.owaspCategory));
  return Array.from(cats).sort();
}

// ── Fail-on evaluation ────────────────────────────────────────────────────────

function shouldFail(failOn: string, vulns: CiVulnEntry[]): boolean {
  switch (failOn) {
    case 'affected':
      return vulns.some((v) => v.verdict === 'affected');
    case 'any':
      return vulns.length > 0;
    case 'critical':
      return vulns.some((v) => v.severityScore != null && v.severityScore >= 9.0);
    default:
      return false;
  }
}

// ── SARIF generation ──────────────────────────────────────────────────────────

function buildSarif(vulns: CiVulnEntry[], projectPath: string): SarifOutput {
  const rulesMap = new Map<string, SarifRule>();

  for (const v of vulns) {
    const ruleId = v.cveId;
    if (!rulesMap.has(ruleId)) {
      const owasp = OWASP_TOP_10[v.owaspCategory as keyof typeof OWASP_TOP_10];
      rulesMap.set(ruleId, {
        id: ruleId,
        name: ruleId.replace(/-/g, ''),
        shortDescription: { text: v.summary ?? ruleId },
        fullDescription: { text: v.summary ?? ruleId },
        helpUri: `https://osv.dev/vulnerability/${ruleId}`,
        properties: {
          tags: [
            'security',
            `owasp:${v.owaspCategory}`,
            owasp ? owasp.name : '',
          ].filter(Boolean),
        },
      });
    }
  }

  const results: SarifResult[] = vulns.map((v) => {
    const pkg = v.packageName ?? 'unknown';
    const ver = v.version ?? '?';
    const msgText =
      `${v.cveId} in ${pkg}@${ver}` +
      (v.fixedVersion ? ` — fix available: ${v.fixedVersion}` : '') +
      (v.summary ? ` — ${v.summary}` : '');

    return {
      ruleId: v.cveId,
      message: { text: msgText },
      level: severityToSarifLevel(v.severityScore),
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: projectPath,
              uriBaseId: '%SRCROOT%',
            },
            region: { startLine: 1 },
          },
        },
      ],
      properties: {
        verdict: v.verdict ?? 'unknown',
        owaspCategory: v.owaspCategory,
        riskScore: v.riskScore,
        severityScore: v.severityScore,
      },
    };
  });

  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'kirograph',
            version: '1.0',
            informationUri: 'https://github.com/eleva/kirograph',
            rules: Array.from(rulesMap.values()),
          },
        },
        results,
      },
    ],
  };
}

// ── Text format ───────────────────────────────────────────────────────────────

function renderText(vulns: CiVulnEntry[], exitCode: number): string {
  const lines: string[] = [];
  for (const v of vulns) {
    const pkg = v.packageName ? `${v.packageName}@${v.version ?? '?'}` : 'unknown';
    const score = v.severityScore != null ? v.severityScore.toFixed(1) : '?';
    const verdict = v.verdict ?? 'pending';
    const risk = v.riskScore != null ? ` risk=${v.riskScore.toFixed(1)}` : '';
    lines.push(`${v.cveId} | ${pkg} | cvss=${score}${risk} | ${verdict} | ${v.owaspCategory}`);
  }
  if (exitCode !== 0) {
    lines.push(`EXIT_CODE=1`);
  }
  return lines.join('\n');
}

// ── Command registration ──────────────────────────────────────────────────────

export function register(program: Command): void {
  program
    .command('ci-report [projectPath]')
    .description('Generate a structured security report for CI/CD pipelines (JSON, SARIF, or text)')
    .option('--format <fmt>', 'Output format: json|sarif|text (default: json)', 'json')
    .option('--fail-on <condition>', 'Exit 1 if condition is met: affected|any|critical', 'affected')
    .option('--output <file>', 'Write report to file instead of stdout')
    .action(async (
      projectPath: string | undefined,
      opts: { format: string; failOn: string; output?: string },
    ) => {
      const target = path.resolve(projectPath ?? process.cwd());
      const config = await loadConfig(target);

      // Validate --format
      const validFormats = ['json', 'sarif', 'text'];
      if (!validFormats.includes(opts.format)) {
        console.error(`  ✖ Invalid --format value: ${opts.format}. Use: ${validFormats.join(', ')}`);
        process.exit(1);
      }

      // Validate --fail-on
      const validFailOns = ['affected', 'any', 'critical'];
      if (!validFailOns.includes(opts.failOn)) {
        console.error(`  ✖ Invalid --fail-on value: ${opts.failOn}. Use: ${validFailOns.join(', ')}`);
        process.exit(1);
      }

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

      // ── Query data ──────────────────────────────────────────────────────────

      const depCount: { count: number } = rawDb.get(
        `SELECT COUNT(*) as count FROM sec_dependencies`,
      ) ?? { count: 0 };

      const vulnRows: Array<{
        cve_id: string;
        package_name: string | null;
        ecosystem: string | null;
        resolved_version: string | null;
        declared_constraint: string | null;
        severity_score: number | null;
        verdict: string | null;
        risk_score: number | null;
        summary: string | null;
        fixed_version: string | null;
      }> = rawDb.all(`
        SELECT
          v.cve_id,
          d.package_name,
          d.ecosystem,
          d.resolved_version,
          d.declared_constraint,
          v.severity_score,
          r.verdict,
          v.risk_score,
          v.summary,
          v.fixed_version
        FROM sec_vulnerabilities v
        LEFT JOIN edges e ON e.target = v.node_id AND e.kind = 'has_vulnerability'
        LEFT JOIN sec_dependencies d ON d.node_id = e.source
        LEFT JOIN sec_reachability r ON r.vulnerability_node_id = v.node_id
        ORDER BY v.risk_score DESC NULLS LAST, v.severity_score DESC NULLS LAST
      `);

      // ── Build enriched vuln list with OWASP mapping ──────────────────────────

      const vulns: CiVulnEntry[] = vulnRows.map((row) => {
        const owaspCat = mapCveToOwasp(row.summary ?? '', row.package_name ?? '');
        return {
          cveId: row.cve_id,
          packageName: row.package_name,
          ecosystem: row.ecosystem,
          version: row.resolved_version ?? row.declared_constraint,
          severityScore: row.severity_score,
          verdict: row.verdict,
          riskScore: row.risk_score,
          owaspCategory: owaspCat,
          owaspName: OWASP_TOP_10[owaspCat].name,
          summary: row.summary,
          fixedVersion: row.fixed_version,
        };
      });

      // ── Compute exit code ────────────────────────────────────────────────────

      const willFail = shouldFail(opts.failOn, vulns);
      const exitCode = willFail ? 1 : 0;

      // ── Build and emit report ─────────────────────────────────────────────────

      let output: string;

      if (opts.format === 'sarif') {
        const sarif = buildSarif(vulns, target);
        output = JSON.stringify(sarif, null, 2);
      } else if (opts.format === 'text') {
        output = renderText(vulns, exitCode);
      } else {
        // JSON
        const affectedCount = vulns.filter((v) => v.verdict === 'affected').length;
        const maxRisk = parseFloat(computeMaxRisk(vulns).toFixed(1));

        const report: CiReport = {
          version: '1.0',
          timestamp: new Date().toISOString(),
          project: path.basename(target),
          summary: {
            dependencies: depCount.count,
            vulnerabilities: vulns.length,
            affected: affectedCount,
            riskScore: maxRisk,
            secretsFound: 0, // secrets scanning not yet wired
            owaspCategories: collectOwaspCategories(vulns),
          },
          vulnerabilities: vulns,
          secrets: [],
          exitCode,
        };
        output = JSON.stringify(report, null, 2);
      }

      // ── Write or print ────────────────────────────────────────────────────────

      if (opts.output) {
        const outPath = path.resolve(opts.output);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, output, 'utf-8');
        console.error(`  ${green}✓${reset} Report written to ${violet}${bold}${outPath}${reset}`);
      } else {
        process.stdout.write(output + '\n');
      }

      cg.close();

      if (exitCode !== 0) {
        const failLabel = opts.failOn;
        console.error(
          `\n  \x1b[31m✖\x1b[0m --fail-on ${failLabel}: condition met. Exiting with code 1.`,
        );
        process.exit(1);
      }
    });
}
