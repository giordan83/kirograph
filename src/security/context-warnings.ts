/**
 * Security Context Warnings
 *
 * Queries pre-computed reachability data to find vulnerabilities
 * reachable from symbols included in a context response.
 * Used by kirograph_context to append security warnings.
 */

import { formatFixSuggestion } from './export/fix-suggestions';

export interface SecurityWarning {
  cveId: string;
  severityScore: number | null;
  epssScore: number | null;      // exploitation probability 0.0–1.0
  epssPercentile: number | null; // percentile rank among all CVEs
  packageName: string;
  ecosystem: string;
  fixedVersion: string | null;
  entryPoints: string[]; // node IDs of entry points that reach this vulnerability
}

/**
 * Query the pre-computed reachability data to find vulnerabilities
 * reachable from the given node IDs.
 *
 * This is a lightweight query joining sec_reachability + sec_vulnerabilities + sec_dependencies
 * where the reachability paths include any of the context nodes. No graph traversal needed
 * since reachability is pre-computed by the SecurityPipeline.
 *
 * @param rawDb - The raw SQLite database handle
 * @param nodeIds - Node IDs from the context response (entry points + related symbols)
 * @returns Array of SecurityWarning objects for affected vulnerabilities
 */
export function getSecurityWarningsForNodes(rawDb: any, nodeIds: string[]): SecurityWarning[] {
  if (nodeIds.length === 0) return [];

  try {
    // Query: find vulnerabilities with verdict 'affected' whose reachability paths
    // include any of the context node IDs.
    // The sec_reachability.paths field is a JSON array of ReachabilityPath objects,
    // each with an entryPoint and path array. We check if any entry point or path node
    // matches our context nodes.
    const rows = rawDb.all(`
      SELECT DISTINCT
        v.cve_id,
        v.severity_score,
        v.epss_score,
        v.epss_percentile,
        v.fixed_version,
        d.package_name,
        d.ecosystem,
        r.paths
      FROM sec_reachability r
      JOIN sec_vulnerabilities v ON v.node_id = r.vulnerability_node_id
      JOIN edges e ON e.target = v.node_id AND e.kind = 'has_vulnerability'
      JOIN sec_dependencies d ON d.node_id = e.source
      WHERE r.verdict = 'affected'
      ORDER BY v.epss_score DESC NULLS LAST, v.severity_score DESC NULLS LAST
    `) as Array<{
      cve_id: string;
      severity_score: number | null;
      epss_score: number | null;
      epss_percentile: number | null;
      fixed_version: string | null;
      package_name: string;
      ecosystem: string;
      paths: string | null;
    }>;

    if (!rows || rows.length === 0) return [];

    const nodeIdSet = new Set(nodeIds);
    const warnings: SecurityWarning[] = [];

    for (const row of rows) {
      // Parse the paths JSON to check if any context node is on a reachable path
      let paths: Array<{ entryPoint: string; path: string[] }> = [];
      try {
        if (row.paths) {
          paths = JSON.parse(row.paths);
        }
      } catch {
        continue;
      }

      // Find entry points from our context that reach this vulnerability
      const matchingEntryPoints: string[] = [];
      for (const p of paths) {
        // Check if the entry point is in our context nodes
        if (nodeIdSet.has(p.entryPoint)) {
          matchingEntryPoints.push(p.entryPoint);
          continue;
        }
        // Check if any node on the path is in our context nodes
        if (p.path && p.path.some(nodeId => nodeIdSet.has(nodeId))) {
          matchingEntryPoints.push(p.entryPoint);
        }
      }

      if (matchingEntryPoints.length > 0) {
        warnings.push({
          cveId: row.cve_id,
          severityScore: row.severity_score,
          epssScore: row.epss_score,
          epssPercentile: row.epss_percentile,
          packageName: row.package_name,
          ecosystem: row.ecosystem,
          fixedVersion: row.fixed_version,
          entryPoints: [...new Set(matchingEntryPoints)],
        });
      }
    }

    // Sort by risk: EPSS first (actual exploitation probability), then CVSS severity
    warnings.sort((a, b) => {
      const epssA = a.epssScore ?? 0;
      const epssB = b.epssScore ?? 0;
      if (epssA !== epssB) return epssB - epssA;
      return (b.severityScore ?? 0) - (a.severityScore ?? 0);
    });

    return warnings;
  } catch {
    // Security warnings are non-critical — don't fail context on query errors
    return [];
  }
}

/**
 * Format security warnings into a text section for the context output.
 * Shows max 3 vulnerabilities with a note about remaining ones.
 *
 * @param warnings - Array of SecurityWarning objects
 * @param nodeNames - Map of node IDs to human-readable names (for entry point display)
 * @returns Formatted string section, or empty string if no warnings
 */
export function formatSecurityWarnings(warnings: SecurityWarning[], nodeNames: Map<string, string>): string {
  if (warnings.length === 0) return '';

  const MAX_SHOWN = 3;
  const lines: string[] = ['', '## ⚠ Security'];

  const shown = warnings.slice(0, MAX_SHOWN);
  for (const w of shown) {
    const scoreParts: string[] = [];
    if (w.severityScore !== null) scoreParts.push(`CVSS ${w.severityScore.toFixed(1)}`);
    if (w.epssScore !== null) {
      const pct = w.epssPercentile !== null ? ` / ${Math.round(w.epssPercentile * 100)}th%` : '';
      scoreParts.push(`EPSS ${w.epssScore.toFixed(2)}${pct}`);
    }
    const scores = scoreParts.length > 0 ? ` (${scoreParts.join(', ')})` : '';

    const entryPointNames = w.entryPoints
      .map(id => nodeNames.get(id) ?? id)
      .slice(0, 3);
    const entryPointStr = entryPointNames.length > 0
      ? ` — reaches via: ${entryPointNames.join(', ')}`
      : '';

    lines.push(`- **${w.cveId}**${scores}: ${w.packageName} (${w.ecosystem})${entryPointStr}`);

    const fix = formatFixSuggestion(w.ecosystem, w.packageName, w.fixedVersion);
    if (fix) lines.push(`  ${fix}`);
  }

  if (warnings.length > MAX_SHOWN) {
    const remaining = warnings.length - MAX_SHOWN;
    lines.push(`\n${remaining} more — use kirograph_vulns for full list`);
  }

  return lines.join('\n');
}
