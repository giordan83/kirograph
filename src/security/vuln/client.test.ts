/**
 * Tests for VulnerabilityDatabaseClient
 *
 * Verifies:
 * - Querying configured databases and creating Vulnerability_Nodes
 * - Deduplication by CVE identifier across multiple databases
 * - Recording lastVulnCheck timestamp on queried Dependency_Nodes
 * - Handling unreachable databases: log error, set vulnDataStale flag
 * - enrichOne() for single dependency enrichment
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { VulnerabilityDatabaseClient } from './client';
import type { VulnDatabaseAdapter } from './types';
import { GraphDatabase } from '../../db/database';
import type { Node, Edge } from '../../types';
import type { CVERecord } from '../types';

describe('VulnerabilityDatabaseClient', () => {
  let db: GraphDatabase;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kirograph-vuln-client-test-'));
    db = new GraphDatabase(tmpDir);
    db.applySecuritySchema();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createDependencyNode(
    name: string,
    ecosystem: string,
    version: string,
  ): string {
    const nodeId = `dep:${ecosystem}:${name}`;
    const rawDb = db.getRawDb();

    const node: Node = {
      id: nodeId,
      kind: 'dependency',
      name,
      qualifiedName: `${ecosystem}/${name}`,
      filePath: '',
      language: 'unknown',
      startLine: 0,
      endLine: 0,
      startColumn: 0,
      endColumn: 0,
      isExported: false,
      isAsync: false,
      isStatic: false,
      isAbstract: false,
      updatedAt: Date.now(),
    };

    db.upsertNode(node);

    rawDb.run(
      `INSERT OR REPLACE INTO sec_dependencies
        (node_id, ecosystem, package_name, declared_constraint, resolved_version, scope, source_manifests)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nodeId, ecosystem, name, `^${version}`, version, 'production', JSON.stringify(['package.json'])],
    );

    return nodeId;
  }

  function createMockAdapter(
    name: string,
    results: Map<string, CVERecord[]>,
  ): VulnDatabaseAdapter {
    return {
      name,
      async query(ecosystem: string, packageName: string, version: string): Promise<CVERecord[]> {
        const key = `${ecosystem}:${packageName}:${version}`;
        return results.get(key) ?? [];
      },
    };
  }

  function createFailingAdapter(name: string, errorMessage: string): VulnDatabaseAdapter {
    return {
      name,
      async query(): Promise<CVERecord[]> {
        throw new Error(errorMessage);
      },
    };
  }

  const sampleCve: CVERecord = {
    id: 'CVE-2023-12345',
    severity: 7.5,
    affectedVersionRanges: [{ introduced: '1.0.0', fixed: '1.2.0' }],
    fixedVersion: '1.2.0',
    summary: 'A critical vulnerability in express',
  };

  const sampleCve2: CVERecord = {
    id: 'CVE-2023-67890',
    severity: 5.0,
    affectedVersionRanges: [{ introduced: '0.9.0', fixed: '1.1.0' }],
    fixedVersion: '1.1.0',
    summary: 'A moderate vulnerability',
  };

  describe('enrichAll()', () => {
    it('should return zero counts when no dependencies exist', async () => {
      const adapter = createMockAdapter('OSV', new Map());
      const client = new VulnerabilityDatabaseClient([adapter], db);

      const result = await client.enrichAll();

      expect(result.vulnerabilitiesFound).toBe(0);
      expect(result.dependenciesChecked).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.staleNodes).toHaveLength(0);
    });

    it('should create Vulnerability_Nodes for matching CVEs', async () => {
      const depNodeId = createDependencyNode('express', 'npm', '1.0.5');

      const results = new Map<string, CVERecord[]>();
      results.set('npm:express:1.0.5', [sampleCve]);

      const adapter = createMockAdapter('OSV', results);
      const client = new VulnerabilityDatabaseClient([adapter], db);

      const result = await client.enrichAll();

      expect(result.vulnerabilitiesFound).toBe(1);
      expect(result.dependenciesChecked).toBe(1);

      // Verify Vulnerability_Node was created
      const vulnNode = db.getNode('vuln:CVE-2023-12345');
      expect(vulnNode).not.toBeNull();
      expect(vulnNode!.kind).toBe('vulnerability');
      expect(vulnNode!.name).toBe('CVE-2023-12345');

      // Verify sec_vulnerabilities row
      const rawDb = db.getRawDb();
      const vulnRow = rawDb.get(
        'SELECT * FROM sec_vulnerabilities WHERE cve_id = ?',
        ['CVE-2023-12345'],
      );
      expect(vulnRow).not.toBeNull();
      expect(vulnRow.severity_score).toBe(7.5);
      expect(vulnRow.fixed_version).toBe('1.2.0');
      expect(vulnRow.source_database).toBe('OSV');

      // Verify has_vulnerability edge
      const edges = db.getEdgesForNodes([depNodeId]);
      const vulnEdge = edges.find(
        e => e.source === depNodeId && e.target === 'vuln:CVE-2023-12345' && e.kind === 'has_vulnerability',
      );
      expect(vulnEdge).toBeDefined();
    });

    it('should update last_vuln_check timestamp on queried dependencies', async () => {
      createDependencyNode('express', 'npm', '1.0.5');

      const adapter = createMockAdapter('OSV', new Map());
      const client = new VulnerabilityDatabaseClient([adapter], db);

      const before = Date.now();
      await client.enrichAll();
      const after = Date.now();

      const rawDb = db.getRawDb();
      const row = rawDb.get(
        'SELECT last_vuln_check FROM sec_dependencies WHERE package_name = ?',
        ['express'],
      );
      expect(row.last_vuln_check).toBeGreaterThanOrEqual(before);
      expect(row.last_vuln_check).toBeLessThanOrEqual(after);
    });

    it('should deduplicate CVEs by ID across multiple databases', async () => {
      createDependencyNode('express', 'npm', '1.0.5');

      // Both adapters return the same CVE
      const results1 = new Map<string, CVERecord[]>();
      results1.set('npm:express:1.0.5', [sampleCve]);

      const results2 = new Map<string, CVERecord[]>();
      results2.set('npm:express:1.0.5', [
        { ...sampleCve, summary: 'Different summary from DB2' },
      ]);

      const adapter1 = createMockAdapter('OSV', results1);
      const adapter2 = createMockAdapter('NVD', results2);
      const client = new VulnerabilityDatabaseClient([adapter1, adapter2], db);

      const result = await client.enrichAll();

      // Only one Vulnerability_Node should be created despite two databases reporting it
      expect(result.vulnerabilitiesFound).toBe(1);

      const rawDb = db.getRawDb();
      const vulnRows = rawDb.all('SELECT * FROM sec_vulnerabilities WHERE cve_id = ?', ['CVE-2023-12345']);
      expect(vulnRows).toHaveLength(1);
    });

    it('should handle multiple unique CVEs from multiple databases', async () => {
      createDependencyNode('express', 'npm', '1.0.5');

      const results1 = new Map<string, CVERecord[]>();
      results1.set('npm:express:1.0.5', [sampleCve]);

      const results2 = new Map<string, CVERecord[]>();
      results2.set('npm:express:1.0.5', [sampleCve2]);

      const adapter1 = createMockAdapter('OSV', results1);
      const adapter2 = createMockAdapter('NVD', results2);
      const client = new VulnerabilityDatabaseClient([adapter1, adapter2], db);

      const result = await client.enrichAll();

      expect(result.vulnerabilitiesFound).toBe(2);

      expect(db.getNode('vuln:CVE-2023-12345')).not.toBeNull();
      expect(db.getNode('vuln:CVE-2023-67890')).not.toBeNull();
    });

    it('should handle unreachable databases: set vulnDataStale flag', async () => {
      const depNodeId = createDependencyNode('express', 'npm', '1.0.5');

      const failingAdapter = createFailingAdapter('OSV', 'Network error');
      const client = new VulnerabilityDatabaseClient([failingAdapter], db);

      const result = await client.enrichAll();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].dependency).toBe('express');
      expect(result.errors[0].database).toBe('OSV');
      expect(result.errors[0].error).toBe('Network error');

      expect(result.staleNodes).toContain(depNodeId);

      // Verify vuln_data_stale flag is set
      const rawDb = db.getRawDb();
      const row = rawDb.get(
        'SELECT vuln_data_stale, vuln_data_stale_since FROM sec_dependencies WHERE node_id = ?',
        [depNodeId],
      );
      expect(row.vuln_data_stale).toBe(1);
      expect(row.vuln_data_stale_since).toBeGreaterThan(0);
    });

    it('should continue processing other dependencies when one adapter fails', async () => {
      createDependencyNode('express', 'npm', '1.0.5');
      createDependencyNode('lodash', 'npm', '4.17.21');

      // Adapter that fails for express but succeeds for lodash
      const adapter: VulnDatabaseAdapter = {
        name: 'OSV',
        async query(_eco: string, pkg: string): Promise<CVERecord[]> {
          if (pkg === 'express') throw new Error('Timeout');
          return [];
        },
      };

      const client = new VulnerabilityDatabaseClient([adapter], db);
      const result = await client.enrichAll();

      // Both dependencies should be checked
      expect(result.dependenciesChecked).toBe(2);
      expect(result.errors).toHaveLength(1);
    });

    it('should truncate summary to 500 characters', async () => {
      createDependencyNode('express', 'npm', '1.0.5');

      const longSummary = 'A'.repeat(600);
      const cveWithLongSummary: CVERecord = {
        ...sampleCve,
        summary: longSummary,
      };

      const results = new Map<string, CVERecord[]>();
      results.set('npm:express:1.0.5', [cveWithLongSummary]);

      const adapter = createMockAdapter('OSV', results);
      const client = new VulnerabilityDatabaseClient([adapter], db);

      await client.enrichAll();

      const rawDb = db.getRawDb();
      const row = rawDb.get(
        'SELECT summary FROM sec_vulnerabilities WHERE cve_id = ?',
        ['CVE-2023-12345'],
      );
      expect(row.summary).toHaveLength(500);
    });
  });

  describe('enrichOne()', () => {
    it('should return empty array for non-existent dependency', async () => {
      const adapter = createMockAdapter('OSV', new Map());
      const client = new VulnerabilityDatabaseClient([adapter], db);

      const result = await client.enrichOne('dep:npm:nonexistent');

      expect(result).toHaveLength(0);
    });

    it('should enrich a single dependency and return CVE records', async () => {
      const depNodeId = createDependencyNode('express', 'npm', '1.0.5');

      const results = new Map<string, CVERecord[]>();
      results.set('npm:express:1.0.5', [sampleCve, sampleCve2]);

      const adapter = createMockAdapter('OSV', results);
      const client = new VulnerabilityDatabaseClient([adapter], db);

      const cves = await client.enrichOne(depNodeId);

      expect(cves).toHaveLength(2);
      expect(cves[0].id).toBe('CVE-2023-12345');
      expect(cves[1].id).toBe('CVE-2023-67890');

      // Verify nodes were created
      expect(db.getNode('vuln:CVE-2023-12345')).not.toBeNull();
      expect(db.getNode('vuln:CVE-2023-67890')).not.toBeNull();
    });

    it('should update last_vuln_check for the single dependency', async () => {
      const depNodeId = createDependencyNode('express', 'npm', '1.0.5');

      const adapter = createMockAdapter('OSV', new Map());
      const client = new VulnerabilityDatabaseClient([adapter], db);

      const before = Date.now();
      await client.enrichOne(depNodeId);
      const after = Date.now();

      const rawDb = db.getRawDb();
      const row = rawDb.get(
        'SELECT last_vuln_check FROM sec_dependencies WHERE node_id = ?',
        [depNodeId],
      );
      expect(row.last_vuln_check).toBeGreaterThanOrEqual(before);
      expect(row.last_vuln_check).toBeLessThanOrEqual(after);
    });

    it('should deduplicate CVEs when enriching a single dependency', async () => {
      const depNodeId = createDependencyNode('express', 'npm', '1.0.5');

      const results1 = new Map<string, CVERecord[]>();
      results1.set('npm:express:1.0.5', [sampleCve]);

      const results2 = new Map<string, CVERecord[]>();
      results2.set('npm:express:1.0.5', [sampleCve]);

      const adapter1 = createMockAdapter('OSV', results1);
      const adapter2 = createMockAdapter('NVD', results2);
      const client = new VulnerabilityDatabaseClient([adapter1, adapter2], db);

      const cves = await client.enrichOne(depNodeId);

      expect(cves).toHaveLength(1);
    });
  });
});
