/**
 * Unit tests for VEXExporter
 *
 * Tests CycloneDX 1.5 VEX generation with various vulnerability/reachability scenarios.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VEXExporter } from './vex';
import { GraphDatabase } from '../../db/database';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('VEXExporter', () => {
  let db: GraphDatabase;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-test-'));
    db = new GraphDatabase(tmpDir);
    db.applySecuritySchema();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper to insert a dependency node into the database.
   */
  function insertDependency(
    nodeId: string,
    ecosystem: string,
    packageName: string,
    version: string,
  ): void {
    const rawDb = db.getRawDb();

    db.upsertNode({
      id: nodeId,
      kind: 'dependency',
      name: packageName,
      qualifiedName: `${ecosystem}/${packageName}`,
      filePath: 'package.json',
      language: 'unknown',
      startLine: 0,
      endLine: 0,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    });

    rawDb.run(
      `INSERT OR REPLACE INTO sec_dependencies
        (node_id, ecosystem, package_name, declared_constraint, resolved_version, scope, source_manifests)
       VALUES (?, ?, ?, ?, ?, 'production', '["package.json"]')`,
      [nodeId, ecosystem, packageName, `^${version}`, version],
    );
  }

  /**
   * Helper to insert a vulnerability node linked to a dependency.
   */
  function insertVulnerability(
    vulnNodeId: string,
    cveId: string,
    depNodeId: string,
    severity: number | null = 7.5,
  ): void {
    const rawDb = db.getRawDb();

    db.upsertNode({
      id: vulnNodeId,
      kind: 'vulnerability',
      name: cveId,
      qualifiedName: cveId,
      filePath: '',
      language: 'unknown',
      startLine: 0,
      endLine: 0,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    });

    rawDb.run(
      `INSERT OR REPLACE INTO sec_vulnerabilities (node_id, cve_id, severity_score, affected_ranges, source_database)
       VALUES (?, ?, ?, '[]', 'OSV')`,
      [vulnNodeId, cveId, severity],
    );

    db.insertEdge({
      source: depNodeId,
      target: vulnNodeId,
      kind: 'has_vulnerability',
      filePath: '',
    });
  }

  /**
   * Helper to insert a reachability result.
   */
  function insertReachability(
    vulnNodeId: string,
    verdict: string,
    paths: any[] | null = null,
    unresolvedSymbols: string[] | null = null,
    entryPointCount: number = 0,
  ): void {
    const rawDb = db.getRawDb();
    rawDb.run(
      `INSERT INTO sec_reachability (vulnerability_node_id, verdict, paths, unresolved_symbols, reaching_entry_point_count, analyzed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        vulnNodeId,
        verdict,
        paths ? JSON.stringify(paths) : null,
        unresolvedSymbols ? JSON.stringify(unresolvedSymbols) : null,
        entryPointCount,
        Date.now(),
      ],
    );
  }

  /**
   * Helper to insert an impact summary.
   */
  function insertImpact(
    vulnNodeId: string,
    layers: string[],
    entryPoints: string[],
    pathCount: number,
  ): void {
    const rawDb = db.getRawDb();
    rawDb.run(
      `INSERT INTO sec_impact (vulnerability_node_id, affected_layers, affected_entry_points, distinct_path_count, analyzed_at)
       VALUES (?, ?, ?, ?, ?)`,
      [vulnNodeId, JSON.stringify(layers), JSON.stringify(entryPoints), pathCount, Date.now()],
    );
  }

  describe('export()', () => {
    it('should produce valid CycloneDX 1.5 VEX with empty vulnerabilities when none exist', () => {
      const exporter = new VEXExporter(db, tmpDir);
      const vex = exporter.export();

      expect(vex.bomFormat).toBe('CycloneDX');
      expect(vex.specVersion).toBe('1.5');
      expect(vex.version).toBe(1);
      expect(vex.metadata).toBeDefined();
      expect(vex.vulnerabilities).toEqual([]);
    });

    it('should include correct metadata with tool name, version, and timestamp', () => {
      const exporter = new VEXExporter(db, '/projects/my-app');
      const vex = exporter.export();

      const meta = vex.metadata as any;
      expect(meta.tools.components[0].name).toBe('kirograph-sec');
      expect(meta.tools.components[0].version).toBe('0.1.0');
      expect(meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(meta.component.name).toBe('my-app');
    });

    it('should map "affected" verdict correctly', () => {
      insertDependency('dep-1', 'npm', 'lodash', '4.17.20');
      insertVulnerability('vuln-1', 'CVE-2021-23337', 'dep-1', 9.8);
      insertReachability(
        'vuln-1',
        'affected',
        [
          { entryPoint: 'ep-1', path: ['ep-1', 'mid-1', 'dep-1'] },
          { entryPoint: 'ep-2', path: ['ep-2', 'dep-1'] },
        ],
        null,
        2,
      );
      insertImpact('vuln-1', ['api', 'service'], ['ep-1', 'ep-2'], 2);

      const exporter = new VEXExporter(db, tmpDir);
      const vex = exporter.export();

      expect(vex.vulnerabilities).toHaveLength(1);
      const v = vex.vulnerabilities[0];
      expect(v.id).toBe('CVE-2021-23337');
      expect(v.analysis?.state).toBe('affected');
      expect(v.analysis?.detail).toContain('2 entry points');
      expect(v.analysis?.detail).toContain('2 layers');
      expect(v.analysis?.detail).toContain('Shortest path length: 2 nodes');
      expect(v.affects).toEqual([{ ref: 'pkg:npm/lodash@4.17.20' }]);
      expect(v.ratings).toEqual([{ score: 9.8, method: 'CVSSv31' }]);
    });

    it('should map "not_affected" verdict with justification "code_not_reachable"', () => {
      insertDependency('dep-1', 'npm', 'express', '4.17.1');
      insertVulnerability('vuln-1', 'CVE-2022-24999', 'dep-1', 5.3);
      insertReachability('vuln-1', 'not_affected', null, null, 0);

      const exporter = new VEXExporter(db, tmpDir);
      const vex = exporter.export();

      expect(vex.vulnerabilities).toHaveLength(1);
      const v = vex.vulnerabilities[0];
      expect(v.analysis?.state).toBe('not_affected');
      expect(v.analysis?.justification).toBe('code_not_reachable');
      expect(v.analysis?.detail).toContain('No reachable path found');
    });

    it('should map "under_investigation" verdict with unresolved symbols', () => {
      insertDependency('dep-1', 'pypi', 'requests', '2.28.0');
      insertVulnerability('vuln-1', 'CVE-2023-32681', 'dep-1', 6.1);
      insertReachability(
        'vuln-1',
        'under_investigation',
        null,
        ['sym-unresolved-1', 'sym-unresolved-2'],
        0,
      );

      const exporter = new VEXExporter(db, tmpDir);
      const vex = exporter.export();

      expect(vex.vulnerabilities).toHaveLength(1);
      const v = vex.vulnerabilities[0];
      expect(v.analysis?.state).toBe('under_investigation');
      expect(v.analysis?.detail).toContain('2 unresolved symbols');
      expect(v.analysis?.detail).toContain('sym-unresolved-1');
      expect(v.analysis?.detail).toContain('sym-unresolved-2');
    });

    it('should set "under_investigation" when no reachability analysis performed', () => {
      insertDependency('dep-1', 'cargo', 'serde', '1.0.188');
      insertVulnerability('vuln-1', 'CVE-2024-00001', 'dep-1', 4.0);
      // No reachability row inserted

      const exporter = new VEXExporter(db, tmpDir);
      const vex = exporter.export();

      expect(vex.vulnerabilities).toHaveLength(1);
      const v = vex.vulnerabilities[0];
      expect(v.analysis?.state).toBe('under_investigation');
      expect(v.analysis?.detail).toContain('has not yet been executed');
    });

    it('should handle multiple vulnerabilities', () => {
      insertDependency('dep-1', 'npm', 'lodash', '4.17.20');
      insertDependency('dep-2', 'npm', 'express', '4.17.1');

      insertVulnerability('vuln-1', 'CVE-2021-23337', 'dep-1', 9.8);
      insertVulnerability('vuln-2', 'CVE-2022-24999', 'dep-2', 5.3);

      insertReachability(
        'vuln-1',
        'affected',
        [{ entryPoint: 'ep-1', path: ['ep-1', 'dep-1'] }],
        null,
        1,
      );
      insertReachability('vuln-2', 'not_affected', null, null, 0);

      const exporter = new VEXExporter(db, tmpDir);
      const vex = exporter.export();

      expect(vex.vulnerabilities).toHaveLength(2);
      const affected = vex.vulnerabilities.find(v => v.id === 'CVE-2021-23337');
      const notAffected = vex.vulnerabilities.find(v => v.id === 'CVE-2022-24999');
      expect(affected?.analysis?.state).toBe('affected');
      expect(notAffected?.analysis?.state).toBe('not_affected');
    });

    it('should use declared_constraint as version when resolved_version is null', () => {
      const rawDb = db.getRawDb();

      db.upsertNode({
        id: 'dep-1',
        kind: 'dependency',
        name: 'axios',
        qualifiedName: 'npm/axios',
        filePath: 'package.json',
        language: 'unknown',
        startLine: 0,
        endLine: 0,
        startColumn: 0,
        endColumn: 0,
        updatedAt: Date.now(),
      });

      rawDb.run(
        `INSERT OR REPLACE INTO sec_dependencies
          (node_id, ecosystem, package_name, declared_constraint, resolved_version, scope, source_manifests)
         VALUES ('dep-1', 'npm', 'axios', '^1.0.0', NULL, 'production', '["package.json"]')`,
      );
      insertVulnerability('vuln-1', 'CVE-2023-45857', 'dep-1', 6.5);
      insertReachability('vuln-1', 'not_affected', null, null, 0);

      const exporter = new VEXExporter(db, tmpDir);
      const vex = exporter.export();

      expect(vex.vulnerabilities[0].affects).toEqual([{ ref: 'pkg:npm/axios@^1.0.0' }]);
    });

    it('should handle vulnerability with no severity score', () => {
      insertDependency('dep-1', 'go', 'github.com/gin-gonic/gin', '1.9.1');
      insertVulnerability('vuln-1', 'CVE-2023-99999', 'dep-1', null);
      insertReachability('vuln-1', 'not_affected', null, null, 0);

      const exporter = new VEXExporter(db, tmpDir);
      const vex = exporter.export();

      expect(vex.vulnerabilities[0].ratings).toBeUndefined();
    });

    it('should handle "under_investigation" with empty unresolved symbols', () => {
      insertDependency('dep-1', 'npm', 'minimist', '1.2.5');
      insertVulnerability('vuln-1', 'CVE-2021-44906', 'dep-1', 9.8);
      insertReachability('vuln-1', 'under_investigation', null, [], 0);

      const exporter = new VEXExporter(db, tmpDir);
      const vex = exporter.export();

      const v = vex.vulnerabilities[0];
      expect(v.analysis?.state).toBe('under_investigation');
      expect(v.analysis?.detail).toBe('Reachability analysis pending.');
    });
  });

  describe('exportJSON()', () => {
    it('should return pretty-printed JSON string', () => {
      const exporter = new VEXExporter(db, tmpDir);
      const json = exporter.exportJSON();

      expect(() => JSON.parse(json)).not.toThrow();
      // Pretty-printed means it contains newlines
      expect(json).toContain('\n');

      const parsed = JSON.parse(json);
      expect(parsed.bomFormat).toBe('CycloneDX');
      expect(parsed.specVersion).toBe('1.5');
    });
  });
});
