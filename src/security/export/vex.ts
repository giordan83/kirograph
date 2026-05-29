/**
 * KiroGraph-Sec VEX Exporter
 *
 * Generates CycloneDX 1.5 VEX (Vulnerability Exploitability eXchange) documents
 * with reachability-informed vulnerability status. Each Vulnerability_Node is
 * mapped to a VEX entry with an analysis state derived from the reachability verdict.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8
 */

import * as path from 'path';
import type { GraphDatabase } from '../../db/database';
import type { CycloneDXVEX, CycloneDXVulnerability, ReachabilityPath } from '../types';

/** Tool metadata for VEX document */
const TOOL_NAME = 'kirograph-sec';
const TOOL_VERSION = '0.1.0';

/**
 * VEXExporter serializes vulnerability assessments with reachability verdicts
 * into CycloneDX 1.5 VEX format.
 */
export class VEXExporter {
  private readonly db: GraphDatabase;
  private readonly projectRoot: string;

  constructor(db: GraphDatabase, projectRoot: string) {
    this.db = db;
    this.projectRoot = projectRoot;
  }

  /**
   * Generate CycloneDX 1.5 VEX JSON object.
   *
   * Queries all Vulnerability_Nodes and their reachability verdicts,
   * producing one VEX entry per vulnerability.
   */
  export(): CycloneDXVEX {
    const rawDb = this.db.getRawDb();
    const projectName = path.basename(this.projectRoot);

    // Build metadata
    const metadata: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      tools: {
        components: [
          {
            type: 'application',
            name: TOOL_NAME,
            version: TOOL_VERSION,
          },
        ],
      },
      component: {
        type: 'application',
        name: projectName,
      },
    };

    // Query all vulnerability nodes
    const vulnRows: Array<{
      node_id: string;
      cve_id: string;
      severity_score: number | null;
      source_database: string;
    }> = rawDb.all(
      `SELECT node_id, cve_id, severity_score, source_database FROM sec_vulnerabilities`,
    );

    // Build vulnerability entries
    const vulnerabilities: CycloneDXVulnerability[] = [];

    for (const vuln of vulnRows) {
      const entry = this.buildVulnerabilityEntry(rawDb, vuln);
      vulnerabilities.push(entry);
    }

    return {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      version: 1,
      metadata,
      vulnerabilities,
    };
  }

  /**
   * Export to pretty-printed JSON string.
   */
  exportJSON(): string {
    return JSON.stringify(this.export(), null, 2);
  }

  /**
   * Build a single CycloneDX vulnerability entry from a Vulnerability_Node.
   *
   * Maps reachability verdicts to CycloneDX analysis states:
   * - affected → "affected" with path summary detail
   * - not_affected → "not_affected" with justification "code_not_reachable"
   * - under_investigation → "under_investigation" with unresolved symbols detail
   * - no reachability data → "under_investigation" with pending analysis detail
   */
  private buildVulnerabilityEntry(
    rawDb: any,
    vuln: { node_id: string; cve_id: string; severity_score: number | null; source_database: string },
  ): CycloneDXVulnerability {
    const entry: CycloneDXVulnerability = {
      id: vuln.cve_id,
      source: {
        name: vuln.source_database,
      },
    };

    // Add severity rating if available
    if (vuln.severity_score != null) {
      entry.ratings = [
        {
          score: vuln.severity_score,
          method: 'CVSSv31',
        },
      ];
    }

    // Find the affected component purl via has_vulnerability edge
    const depEdge = rawDb.get(
      `SELECT source FROM edges WHERE target = ? AND kind = 'has_vulnerability'`,
      [vuln.node_id],
    );

    if (depEdge) {
      const depRow = rawDb.get(
        `SELECT ecosystem, package_name, resolved_version, declared_constraint
         FROM sec_dependencies WHERE node_id = ?`,
        [depEdge.source],
      );

      if (depRow) {
        const version = depRow.resolved_version || depRow.declared_constraint;
        const purl = `pkg:${depRow.ecosystem}/${depRow.package_name}@${version}`;
        entry.affects = [{ ref: purl }];
      }
    }

    // Query reachability verdict
    const reachRow = rawDb.get(
      `SELECT verdict, paths, unresolved_symbols, reaching_entry_point_count
       FROM sec_reachability WHERE vulnerability_node_id = ?`,
      [vuln.node_id],
    );

    if (!reachRow) {
      // No reachability analysis performed (Requirement 7.5)
      entry.analysis = {
        state: 'under_investigation',
        detail: 'Reachability analysis has not yet been executed for this vulnerability.',
      };
    } else {
      entry.analysis = this.buildAnalysis(rawDb, vuln.node_id, reachRow);
    }

    return entry;
  }

  /**
   * Build the analysis section based on the reachability verdict.
   */
  private buildAnalysis(
    rawDb: any,
    vulnerabilityNodeId: string,
    reachRow: {
      verdict: string;
      paths: string | null;
      unresolved_symbols: string | null;
      reaching_entry_point_count: number;
    },
  ): CycloneDXVulnerability['analysis'] {
    switch (reachRow.verdict) {
      case 'affected':
        return this.buildAffectedAnalysis(rawDb, vulnerabilityNodeId, reachRow);

      case 'not_affected':
        return {
          state: 'not_affected',
          justification: 'code_not_reachable',
          detail: 'No reachable path found from any application entry point to this dependency.',
        };

      case 'under_investigation':
        return this.buildUnderInvestigationAnalysis(reachRow);

      default:
        return {
          state: 'under_investigation',
          detail: 'Reachability analysis pending.',
        };
    }
  }

  /**
   * Build analysis detail for "affected" verdict.
   *
   * Includes: entry point count, layer count, shortest path length.
   */
  private buildAffectedAnalysis(
    rawDb: any,
    vulnerabilityNodeId: string,
    reachRow: {
      paths: string | null;
      reaching_entry_point_count: number;
    },
  ): CycloneDXVulnerability['analysis'] {
    const entryPointCount = reachRow.reaching_entry_point_count;

    // Get impact summary for layer information
    const impactRow = rawDb.get(
      `SELECT affected_layers, distinct_path_count FROM sec_impact WHERE vulnerability_node_id = ?`,
      [vulnerabilityNodeId],
    );

    let layerCount = 0;
    if (impactRow && impactRow.affected_layers) {
      const layers: string[] = JSON.parse(impactRow.affected_layers);
      layerCount = layers.length;
    }

    // Calculate shortest path length from stored paths
    let shortestPathLength = 0;
    if (reachRow.paths) {
      const paths: ReachabilityPath[] = JSON.parse(reachRow.paths);
      if (paths.length > 0) {
        shortestPathLength = Math.min(...paths.map(p => p.path.length));
      }
    }

    const detail = `Reachable from ${entryPointCount} entry point${entryPointCount !== 1 ? 's' : ''} via ${layerCount} layer${layerCount !== 1 ? 's' : ''}. Shortest path length: ${shortestPathLength} nodes.`;

    return {
      state: 'affected',
      detail,
    };
  }

  /**
   * Build analysis detail for "under_investigation" verdict.
   *
   * Lists unresolved symbols or states pending analysis reason.
   */
  private buildUnderInvestigationAnalysis(
    reachRow: {
      unresolved_symbols: string | null;
    },
  ): CycloneDXVulnerability['analysis'] {
    if (reachRow.unresolved_symbols) {
      const symbols: string[] = JSON.parse(reachRow.unresolved_symbols);
      if (symbols.length > 0) {
        return {
          state: 'under_investigation',
          detail: `${symbols.length} unresolved symbol${symbols.length !== 1 ? 's' : ''} blocked complete analysis: ${symbols.join(', ')}`,
        };
      }
    }

    return {
      state: 'under_investigation',
      detail: 'Reachability analysis pending.',
    };
  }
}
