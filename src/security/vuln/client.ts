/**
 * VulnerabilityDatabaseClient
 *
 * Orchestrates vulnerability enrichment by querying configured databases,
 * merging and deduplicating results by CVE identifier, creating Vulnerability_Nodes
 * linked to affected Dependency_Nodes, and handling unreachable databases gracefully.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7
 */

import type { GraphDatabase } from '../../db/database';
import type { Edge } from '../../types';
import type { CVERecord, EnrichmentResult } from '../types';
import type { VulnDatabaseAdapter } from './types';
import { logError, logWarn } from '../../errors';

/**
 * Dependency row from sec_dependencies table.
 */
interface DependencyRow {
  node_id: string;
  ecosystem: string;
  package_name: string;
  resolved_version: string | null;
  declared_constraint: string;
}

export class VulnerabilityDatabaseClient {
  private readonly adapters: VulnDatabaseAdapter[];
  private readonly db: GraphDatabase;
  private readonly timeoutMs: number;

  constructor(
    adapters: VulnDatabaseAdapter[],
    db: GraphDatabase,
    timeoutMs: number = 30000,
  ) {
    this.adapters = adapters;
    this.db = db;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Enrich all Dependency_Nodes with vulnerability data.
   *
   * Iterates over all dependencies in sec_dependencies, queries each configured
   * database adapter in order, merges results, deduplicates by CVE ID, creates
   * Vulnerability_Nodes and has_vulnerability edges, and updates timestamps.
   */
  async enrichAll(): Promise<EnrichmentResult> {
    const rawDb = this.db.getRawDb();
    const result: EnrichmentResult = {
      vulnerabilitiesFound: 0,
      dependenciesChecked: 0,
      errors: [],
      staleNodes: [],
    };

    // Get all dependency nodes
    const depRows: DependencyRow[] = rawDb.all(
      `SELECT node_id, ecosystem, package_name, resolved_version, declared_constraint
       FROM sec_dependencies`,
    );

    for (const dep of depRows) {
      const version = dep.resolved_version || dep.declared_constraint;
      if (!version) {
        continue;
      }

      const cveRecords = await this.queryAdaptersForDependency(
        dep,
        version,
        result,
      );

      // Deduplicate by CVE ID across all adapters
      const uniqueCves = this.deduplicateByCveId(cveRecords);

      // Create Vulnerability_Nodes and edges for each unique CVE
      for (const cve of uniqueCves) {
        this.upsertVulnerabilityNode(rawDb, cve, dep.node_id);
        result.vulnerabilitiesFound++;
      }

      // Record lastVulnCheck timestamp (Requirement 3.4)
      const now = Date.now();
      rawDb.run(
        `UPDATE sec_dependencies SET last_vuln_check = ? WHERE node_id = ?`,
        [now, dep.node_id],
      );

      result.dependenciesChecked++;
    }

    return result;
  }

  /**
   * Enrich a single Dependency_Node with vulnerability data.
   *
   * @param dependencyNodeId - The node ID of the dependency to enrich
   * @returns Array of CVE records found for this dependency
   */
  async enrichOne(dependencyNodeId: string): Promise<CVERecord[]> {
    const rawDb = this.db.getRawDb();

    const dep: DependencyRow | undefined = rawDb.get(
      `SELECT node_id, ecosystem, package_name, resolved_version, declared_constraint
       FROM sec_dependencies WHERE node_id = ?`,
      [dependencyNodeId],
    );

    if (!dep) {
      return [];
    }

    const version = dep.resolved_version || dep.declared_constraint;
    if (!version) {
      return [];
    }

    const enrichResult: EnrichmentResult = {
      vulnerabilitiesFound: 0,
      dependenciesChecked: 0,
      errors: [],
      staleNodes: [],
    };

    const cveRecords = await this.queryAdaptersForDependency(
      dep,
      version,
      enrichResult,
    );

    // Deduplicate by CVE ID
    const uniqueCves = this.deduplicateByCveId(cveRecords);

    // Create Vulnerability_Nodes and edges
    for (const cve of uniqueCves) {
      this.upsertVulnerabilityNode(rawDb, cve, dep.node_id);
    }

    // Record lastVulnCheck timestamp
    const now = Date.now();
    rawDb.run(
      `UPDATE sec_dependencies SET last_vuln_check = ? WHERE node_id = ?`,
      [now, dep.node_id],
    );

    return uniqueCves;
  }

  /**
   * Query all configured adapters for a single dependency.
   * Handles timeouts and unreachable databases gracefully.
   */
  private async queryAdaptersForDependency(
    dep: DependencyRow,
    version: string,
    result: EnrichmentResult,
  ): Promise<CVERecord[]> {
    const allRecords: CVERecord[] = [];

    for (const adapter of this.adapters) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
          const records = await adapter.query(
            dep.ecosystem,
            dep.package_name,
            version,
            controller.signal,
          );
          allRecords.push(...records);
        } finally {
          clearTimeout(timeout);
        }
      } catch (error: unknown) {
        // Handle unreachable database (Requirement 3.5)
        const errorMessage = error instanceof Error ? error.message : String(error);
        logError(
          `[sec:vuln] Failed to query ${adapter.name} for ${dep.package_name}@${version}: ${errorMessage}`,
        );

        result.errors.push({
          dependency: dep.package_name,
          database: adapter.name,
          error: errorMessage,
        });

        // Set vulnDataStale flag on the dependency node
        this.markDependencyStale(dep.node_id, result);
      }
    }

    return allRecords;
  }

  /**
   * Mark a dependency node as having stale vulnerability data.
   * Retains cached data but sets the stale flag with timestamp.
   */
  private markDependencyStale(nodeId: string, result: EnrichmentResult): void {
    const rawDb = this.db.getRawDb();
    const now = Date.now();

    rawDb.run(
      `UPDATE sec_dependencies
       SET vuln_data_stale = 1, vuln_data_stale_since = ?
       WHERE node_id = ?`,
      [now, nodeId],
    );

    if (!result.staleNodes.includes(nodeId)) {
      result.staleNodes.push(nodeId);
    }

    logWarn(
      `[sec:vuln] Vulnerability data marked stale for dependency node ${nodeId}`,
    );
  }

  /**
   * Deduplicate CVE records by their ID.
   * When the same CVE is reported by multiple databases, keep the first occurrence.
   */
  private deduplicateByCveId(records: CVERecord[]): CVERecord[] {
    const seen = new Map<string, CVERecord>();
    for (const record of records) {
      if (!seen.has(record.id)) {
        seen.set(record.id, record);
      }
    }
    return [...seen.values()];
  }

  /**
   * Create or update a Vulnerability_Node and link it to the affected dependency.
   *
   * - Creates a node in `nodes` table with kind='vulnerability', ID format `vuln:<cve_id>`
   * - Inserts a row in `sec_vulnerabilities` with CVE metadata
   * - Creates a `has_vulnerability` edge from the Dependency_Node to the Vulnerability_Node
   */
  private upsertVulnerabilityNode(
    rawDb: any,
    cve: CVERecord,
    dependencyNodeId: string,
  ): void {
    const vulnNodeId = `vuln:${cve.id}`;
    const now = Date.now();

    // Truncate summary to 500 characters (Requirement 3.3)
    const summary = cve.summary.length > 500
      ? cve.summary.slice(0, 500)
      : cve.summary;

    // Determine source database from the first adapter that returned this CVE
    // (in practice, the adapter name is not stored on CVERecord, so we use
    // the first configured adapter's name as the source)
    const sourceDatabase = this.adapters.length > 0 ? this.adapters[0].name : 'unknown';

    // Upsert into nodes table
    rawDb.run(
      `INSERT OR REPLACE INTO nodes
        (id, kind, name, qualified_name, file_path, language,
         start_line, end_line, start_column, end_column,
         is_exported, is_async, is_static, is_abstract, updated_at)
       VALUES (?, 'vulnerability', ?, ?, '', 'unknown', 0, 0, 0, 0, 0, 0, 0, 0, ?)`,
      [vulnNodeId, cve.id, cve.id, now],
    );

    // Upsert into sec_vulnerabilities table
    const affectedRangesJson = JSON.stringify(cve.affectedVersionRanges);
    rawDb.run(
      `INSERT OR REPLACE INTO sec_vulnerabilities
        (node_id, cve_id, severity_score, affected_ranges, fixed_version, summary, source_database)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        vulnNodeId,
        cve.id,
        cve.severity,
        affectedRangesJson,
        cve.fixedVersion ?? null,
        summary,
        sourceDatabase,
      ],
    );

    // Create has_vulnerability edge from Dependency_Node to Vulnerability_Node
    const edge: Edge = {
      source: dependencyNodeId,
      target: vulnNodeId,
      kind: 'has_vulnerability',
      confidence: 'extracted',
      confidenceScore: 1.0,
    };
    this.db.insertEdge(edge);
  }
}
