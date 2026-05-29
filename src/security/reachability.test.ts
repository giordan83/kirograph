/**
 * Tests for ReachabilityAnalyzer
 *
 * Verifies BFS traversal, verdict assignment, multi-entry-point path recording,
 * and impact analysis with architecture context.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ReachabilityAnalyzer } from './reachability';
import { GraphDatabase } from '../db/database';
import { createDefaultConfig, type KiroGraphConfig } from '../config';
import type { Node, Edge } from '../types';

describe('ReachabilityAnalyzer', () => {
  let db: GraphDatabase;
  let config: KiroGraphConfig;
  let analyzer: ReachabilityAnalyzer;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kirograph-reachability-test-'));
    db = new GraphDatabase(tmpDir);
    db.applySecuritySchema();
    config = createDefaultConfig();
    config.enableArchitecture = true;
    config.enableSecurity = true;
    analyzer = new ReachabilityAnalyzer(db, config);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function createNode(id: string, kind: Node['kind'], opts?: Partial<Node>): void {
    const node: Node = {
      id,
      kind,
      name: opts?.name ?? id,
      qualifiedName: opts?.qualifiedName ?? id,
      filePath: opts?.filePath ?? `src/${id}.ts`,
      language: 'typescript',
      startLine: 0,
      endLine: 0,
      startColumn: 0,
      endColumn: 0,
      isExported: opts?.isExported ?? false,
      updatedAt: Date.now(),
    };
    db.upsertNode(node);
  }

  function createEdge(source: string, target: string, kind: Edge['kind']): void {
    db.insertEdge({ source, target, kind });
  }

  function createDependencyNode(name: string): string {
    const nodeId = `dep:npm:${name}`;
    createNode(nodeId, 'dependency', { name });
    const rawDb = db.getRawDb();
    rawDb.run(
      `INSERT OR REPLACE INTO sec_dependencies
        (node_id, ecosystem, package_name, declared_constraint, resolved_version, scope, source_manifests)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nodeId, 'npm', name, '^1.0.0', '1.0.0', 'production', '["package.json"]'],
    );
    return nodeId;
  }

  function createVulnerabilityNode(cveId: string, depNodeId: string): string {
    const nodeId = `vuln:${cveId}`;
    createNode(nodeId, 'vulnerability', { name: cveId });
    const rawDb = db.getRawDb();
    rawDb.run(
      `INSERT OR REPLACE INTO sec_vulnerabilities
        (node_id, cve_id, severity_score, affected_ranges, fixed_version, summary, source_database)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nodeId, cveId, 7.5, '[]', '1.0.1', 'Test vulnerability', 'OSV'],
    );
    // Create has_vulnerability edge: dependency → vulnerability
    createEdge(depNodeId, nodeId, 'has_vulnerability');
    return nodeId;
  }

  function createEntryPoint(id: string, kind: 'route' | 'function' = 'route'): void {
    createNode(id, kind, { isExported: true });
  }

  function assignLayer(filePath: string, layerId: string): void {
    const rawDb = db.getRawDb();
    // Ensure the layer exists in arch_layers (FK constraint)
    rawDb.run(
      `INSERT OR IGNORE INTO arch_layers (id, name, source, patterns, updated_at)
       VALUES (?, ?, 'auto', '[]', ?)`,
      [layerId, layerId, Date.now()],
    );
    rawDb.run(
      `INSERT OR REPLACE INTO arch_file_layers (file_path, layer_id, confidence, matched_pattern)
       VALUES (?, ?, 1.0, '**')`,
      [filePath, layerId],
    );
  }

  // ── Tests: Core Reachability Traversal (Task 7.1) ───────────────────────────

  describe('analyze() - core reachability', () => {
    it('should return affected when a path exists from entry point to dependency', async () => {
      // Graph: entryPoint → intermediate → dependency
      createEntryPoint('ep1');
      createNode('mid1', 'function');
      const depId = createDependencyNode('vulnerable-pkg');
      const vulnId = createVulnerabilityNode('CVE-2023-001', depId);

      createEdge('ep1', 'mid1', 'calls');
      createEdge('mid1', depId, 'imports');

      const result = await analyzer.analyze(vulnId);

      expect(result.verdict).toBe('affected');
      expect(result.paths.length).toBe(1);
      expect(result.paths[0].entryPoint).toBe('ep1');
      expect(result.paths[0].path).toEqual(['ep1', 'mid1', depId]);
      expect(result.reachingEntryPointCount).toBe(1);
    });

    it('should return not_affected when no path exists', async () => {
      // Graph: entryPoint → mid1 (no connection to dep)
      createEntryPoint('ep1');
      createNode('mid1', 'function');
      const depId = createDependencyNode('isolated-pkg');
      const vulnId = createVulnerabilityNode('CVE-2023-002', depId);

      createEdge('ep1', 'mid1', 'calls');
      // No edge from mid1 to depId

      const result = await analyzer.analyze(vulnId);

      expect(result.verdict).toBe('not_affected');
      expect(result.paths.length).toBe(0);
      expect(result.reachingEntryPointCount).toBe(0);
    });

    it('should return under_investigation when unresolved imports are encountered', async () => {
      // Graph: entryPoint → unresolvedImport (import node with no outgoing edges)
      createEntryPoint('ep1');
      createNode('unresolved1', 'import');
      const depId = createDependencyNode('maybe-pkg');
      const vulnId = createVulnerabilityNode('CVE-2023-003', depId);

      createEdge('ep1', 'unresolved1', 'imports');
      // unresolved1 has no outgoing edges → unresolved import

      const result = await analyzer.analyze(vulnId);

      expect(result.verdict).toBe('under_investigation');
      expect(result.unresolvedSymbols).toContain('unresolved1');
      expect(result.paths.length).toBe(0);
    });

    it('should handle cycles without infinite loops', async () => {
      // Graph: ep1 → A → B → A (cycle), no path to dep
      createEntryPoint('ep1');
      createNode('nodeA', 'function');
      createNode('nodeB', 'function');
      const depId = createDependencyNode('unreachable-pkg');
      const vulnId = createVulnerabilityNode('CVE-2023-004', depId);

      createEdge('ep1', 'nodeA', 'calls');
      createEdge('nodeA', 'nodeB', 'calls');
      createEdge('nodeB', 'nodeA', 'calls'); // cycle

      const result = await analyzer.analyze(vulnId);

      expect(result.verdict).toBe('not_affected');
      expect(result.paths.length).toBe(0);
    });

    it('should visit each node at most once', async () => {
      // Graph: ep1 → A → dep, ep1 → B → A → dep
      // A should only be visited once per BFS from ep1
      createEntryPoint('ep1');
      createNode('nodeA', 'function');
      createNode('nodeB', 'function');
      const depId = createDependencyNode('shared-pkg');
      const vulnId = createVulnerabilityNode('CVE-2023-005', depId);

      createEdge('ep1', 'nodeA', 'calls');
      createEdge('ep1', 'nodeB', 'calls');
      createEdge('nodeA', depId, 'imports');
      createEdge('nodeB', 'nodeA', 'calls');

      const result = await analyzer.analyze(vulnId);

      expect(result.verdict).toBe('affected');
      // Should find shortest path: ep1 → nodeA → dep
      expect(result.paths[0].path).toEqual(['ep1', 'nodeA', depId]);
    });

    it('should traverse calls, imports, and references edges', async () => {
      createEntryPoint('ep1');
      createNode('mid1', 'function');
      createNode('mid2', 'class');
      const depId = createDependencyNode('ref-pkg');
      const vulnId = createVulnerabilityNode('CVE-2023-006', depId);

      createEdge('ep1', 'mid1', 'calls');
      createEdge('mid1', 'mid2', 'references');
      createEdge('mid2', depId, 'imports');

      const result = await analyzer.analyze(vulnId);

      expect(result.verdict).toBe('affected');
      expect(result.paths[0].path).toEqual(['ep1', 'mid1', 'mid2', depId]);
    });

    it('should return under_investigation when no dependency is linked', async () => {
      // Vulnerability with no has_vulnerability edge
      const vulnId = 'vuln:CVE-2023-orphan';
      createNode(vulnId, 'vulnerability', { name: 'CVE-2023-orphan' });
      const rawDb = db.getRawDb();
      rawDb.run(
        `INSERT OR REPLACE INTO sec_vulnerabilities
          (node_id, cve_id, severity_score, affected_ranges, summary, source_database)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [vulnId, 'CVE-2023-orphan', 5.0, '[]', 'Orphan vuln', 'OSV'],
      );

      const result = await analyzer.analyze(vulnId);

      expect(result.verdict).toBe('under_investigation');
    });

    it('should return not_affected when no entry points exist', async () => {
      // No entry points in the graph
      const depId = createDependencyNode('no-ep-pkg');
      const vulnId = createVulnerabilityNode('CVE-2023-007', depId);

      const result = await analyzer.analyze(vulnId);

      expect(result.verdict).toBe('not_affected');
    });

    it('should limit unresolved symbols to 50', async () => {
      createEntryPoint('ep1');
      const depId = createDependencyNode('many-unresolved-pkg');
      const vulnId = createVulnerabilityNode('CVE-2023-008', depId);

      // Create 60 unresolved import nodes
      for (let i = 0; i < 60; i++) {
        const importId = `unresolved-import-${i}`;
        createNode(importId, 'import');
        createEdge('ep1', importId, 'imports');
      }

      const result = await analyzer.analyze(vulnId);

      expect(result.verdict).toBe('under_investigation');
      expect(result.unresolvedSymbols.length).toBeLessThanOrEqual(50);
    });

    it('should store result in sec_reachability table', async () => {
      createEntryPoint('ep1');
      const depId = createDependencyNode('stored-pkg');
      const vulnId = createVulnerabilityNode('CVE-2023-009', depId);
      createEdge('ep1', depId, 'imports');

      await analyzer.analyze(vulnId);

      const rawDb = db.getRawDb();
      const row = rawDb.get(
        `SELECT * FROM sec_reachability WHERE vulnerability_node_id = ?`,
        [vulnId],
      );
      expect(row).not.toBeNull();
      expect(row.verdict).toBe('affected');
      expect(row.reaching_entry_point_count).toBe(1);
    });
  });

  // ── Tests: Multi-Entry-Point Path Recording (Task 7.2) ─────────────────────

  describe('analyze() - multi-entry-point paths', () => {
    it('should record shortest path from each reaching entry point', async () => {
      createEntryPoint('ep1');
      createEntryPoint('ep2');
      createNode('mid1', 'function');
      createNode('mid2', 'function');
      const depId = createDependencyNode('multi-ep-pkg');
      const vulnId = createVulnerabilityNode('CVE-2023-010', depId);

      // ep1 → mid1 → dep (length 3)
      createEdge('ep1', 'mid1', 'calls');
      createEdge('mid1', depId, 'imports');

      // ep2 → dep (length 2, shorter)
      createEdge('ep2', depId, 'imports');

      const result = await analyzer.analyze(vulnId);

      expect(result.verdict).toBe('affected');
      expect(result.reachingEntryPointCount).toBe(2);
      expect(result.paths.length).toBe(2);

      const ep1Path = result.paths.find(p => p.entryPoint === 'ep1');
      const ep2Path = result.paths.find(p => p.entryPoint === 'ep2');

      expect(ep1Path).toBeDefined();
      expect(ep1Path!.path).toEqual(['ep1', 'mid1', depId]);

      expect(ep2Path).toBeDefined();
      expect(ep2Path!.path).toEqual(['ep2', depId]);
    });

    it('should include total count of reaching entry points', async () => {
      const depId = createDependencyNode('counted-pkg');
      const vulnId = createVulnerabilityNode('CVE-2023-011', depId);

      // Create 5 entry points, 3 of which reach the dep
      for (let i = 0; i < 5; i++) {
        createEntryPoint(`ep${i}`);
        if (i < 3) {
          createEdge(`ep${i}`, depId, 'imports');
        }
      }

      const result = await analyzer.analyze(vulnId);

      expect(result.verdict).toBe('affected');
      expect(result.reachingEntryPointCount).toBe(3);
      expect(result.paths.length).toBe(3);
    });

    it('should handle exported functions as entry points', async () => {
      createEntryPoint('exported-fn', 'function');
      const depId = createDependencyNode('fn-ep-pkg');
      const vulnId = createVulnerabilityNode('CVE-2023-012', depId);

      createEdge('exported-fn', depId, 'references');

      const result = await analyzer.analyze(vulnId);

      expect(result.verdict).toBe('affected');
      expect(result.paths[0].entryPoint).toBe('exported-fn');
    });
  });

  // ── Tests: Impact Analysis (Task 7.3) ──────────────────────────────────────

  describe('getImpactSummary()', () => {
    it('should return null for non-affected vulnerabilities', async () => {
      createEntryPoint('ep1');
      const depId = createDependencyNode('not-affected-pkg');
      const vulnId = createVulnerabilityNode('CVE-2023-020', depId);
      // No path to dep → not_affected

      await analyzer.analyze(vulnId);
      const summary = await analyzer.getImpactSummary(vulnId);

      expect(summary).toBeNull();
    });

    it('should identify affected layers on reachable paths', async () => {
      createEntryPoint('ep1');
      createNode('mid1', 'function', { filePath: 'src/api/handler.ts' });
      createNode('mid2', 'function', { filePath: 'src/service/logic.ts' });
      const depId = createDependencyNode('layered-pkg');
      const vulnId = createVulnerabilityNode('CVE-2023-021', depId);

      createEdge('ep1', 'mid1', 'calls');
      createEdge('mid1', 'mid2', 'calls');
      createEdge('mid2', depId, 'imports');

      // Assign layers
      assignLayer('src/api/handler.ts', 'api');
      assignLayer('src/service/logic.ts', 'service');

      await analyzer.analyze(vulnId);
      const summary = await analyzer.getImpactSummary(vulnId);

      expect(summary).not.toBeNull();
      expect(summary!.affectedLayers).toContain('api');
      expect(summary!.affectedLayers).toContain('service');
    });

    it('should identify all affected entry points', async () => {
      createEntryPoint('ep1');
      createEntryPoint('ep2');
      const depId = createDependencyNode('multi-ep-impact-pkg');
      const vulnId = createVulnerabilityNode('CVE-2023-022', depId);

      createEdge('ep1', depId, 'imports');
      createEdge('ep2', depId, 'imports');

      await analyzer.analyze(vulnId);
      const summary = await analyzer.getImpactSummary(vulnId);

      expect(summary).not.toBeNull();
      expect(summary!.affectedEntryPoints).toContain('ep1');
      expect(summary!.affectedEntryPoints).toContain('ep2');
    });

    it('should cap distinct path count at 100', async () => {
      const depId = createDependencyNode('many-paths-pkg');
      const vulnId = createVulnerabilityNode('CVE-2023-023', depId);

      // Create 110 entry points each with a direct path
      for (let i = 0; i < 110; i++) {
        createEntryPoint(`ep${i}`);
        createEdge(`ep${i}`, depId, 'imports');
      }

      await analyzer.analyze(vulnId);
      const summary = await analyzer.getImpactSummary(vulnId);

      expect(summary).not.toBeNull();
      expect(summary!.distinctPathCount).toBeLessThanOrEqual(100);
    });

    it('should classify symbols with no assigned layer as unclassified', async () => {
      createEntryPoint('ep1');
      createNode('mid1', 'function', { filePath: 'src/unknown/file.ts' });
      const depId = createDependencyNode('unclassified-pkg');
      const vulnId = createVulnerabilityNode('CVE-2023-024', depId);

      createEdge('ep1', 'mid1', 'calls');
      createEdge('mid1', depId, 'imports');

      // No layer assigned to src/unknown/file.ts

      await analyzer.analyze(vulnId);
      const summary = await analyzer.getImpactSummary(vulnId);

      expect(summary).not.toBeNull();
      expect(summary!.affectedLayers).toContain('unclassified');
    });

    it('should omit layer classification when enableArchitecture is false', async () => {
      config.enableArchitecture = false;
      analyzer = new ReachabilityAnalyzer(db, config);

      createEntryPoint('ep1');
      createNode('mid1', 'function', { filePath: 'src/api/handler.ts' });
      const depId = createDependencyNode('no-arch-pkg');
      const vulnId = createVulnerabilityNode('CVE-2023-025', depId);

      createEdge('ep1', 'mid1', 'calls');
      createEdge('mid1', depId, 'imports');

      assignLayer('src/api/handler.ts', 'api');

      await analyzer.analyze(vulnId);
      const summary = await analyzer.getImpactSummary(vulnId);

      expect(summary).not.toBeNull();
      // When enableArchitecture is false, affectedLayers should be empty
      expect(summary!.affectedLayers).toEqual([]);
    });

    it('should store impact summary in sec_impact table', async () => {
      createEntryPoint('ep1');
      const depId = createDependencyNode('stored-impact-pkg');
      const vulnId = createVulnerabilityNode('CVE-2023-026', depId);
      createEdge('ep1', depId, 'imports');

      await analyzer.analyze(vulnId);
      await analyzer.getImpactSummary(vulnId);

      const rawDb = db.getRawDb();
      const row = rawDb.get(
        `SELECT * FROM sec_impact WHERE vulnerability_node_id = ?`,
        [vulnId],
      );
      expect(row).not.toBeNull();
      expect(row.distinct_path_count).toBeGreaterThan(0);
    });
  });

  // ── Tests: analyzeAll() ─────────────────────────────────────────────────────

  describe('analyzeAll()', () => {
    it('should analyze all vulnerability nodes', async () => {
      createEntryPoint('ep1');
      const dep1 = createDependencyNode('pkg1');
      const dep2 = createDependencyNode('pkg2');
      const vuln1 = createVulnerabilityNode('CVE-2023-030', dep1);
      const vuln2 = createVulnerabilityNode('CVE-2023-031', dep2);

      createEdge('ep1', dep1, 'imports');
      // dep2 is not reachable

      const results = await analyzer.analyzeAll();

      expect(results.size).toBe(2);
      expect(results.get(vuln1)!.verdict).toBe('affected');
      expect(results.get(vuln2)!.verdict).toBe('not_affected');
    });

    it('should return empty map when no vulnerabilities exist', async () => {
      const results = await analyzer.analyzeAll();
      expect(results.size).toBe(0);
    });
  });
});
