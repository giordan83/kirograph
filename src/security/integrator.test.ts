/**
 * Tests for DependencyGraphIntegrator.cleanup()
 *
 * Verifies that orphaned Dependency_Nodes are correctly identified and removed
 * when their source manifests no longer exist on disk or when they have no
 * declared_in edges.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DependencyGraphIntegrator } from './integrator';
import { GraphDatabase } from '../db/database';
import type { Node, Edge } from '../types';

describe('DependencyGraphIntegrator.cleanup()', () => {
  let db: GraphDatabase;
  let integrator: DependencyGraphIntegrator;
  let tmpDir: string;
  const projectRoot = '/tmp/test-project';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kirograph-integrator-test-'));
    db = new GraphDatabase(tmpDir);
    db.applySecuritySchema();
    integrator = new DependencyGraphIntegrator(db, projectRoot);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createDependencyNode(
    name: string,
    ecosystem: string,
    sourceManifests: string[],
    options?: { addDeclaredInEdge?: boolean },
  ): string {
    const nodeId = `dep:${ecosystem}:${name}`;
    const rawDb = db.getRawDb();

    const node: Node = {
      id: nodeId,
      kind: 'dependency',
      name,
      qualifiedName: `${ecosystem}/${name}`,
      filePath: sourceManifests[0] ?? '',
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
      [nodeId, ecosystem, name, '^1.0.0', '1.0.0', 'production', JSON.stringify(sourceManifests)],
    );

    // Optionally add declared_in edge (simulates a manifest that still declares this dep)
    if (options?.addDeclaredInEdge !== false) {
      for (const manifest of sourceManifests) {
        const edge: Edge = {
          source: nodeId,
          target: manifest,
          kind: 'declared_in',
        };
        db.insertEdge(edge);
      }
    }

    return nodeId;
  }

  function createEdge(source: string, target: string, kind: string): void {
    const edge: Edge = {
      source,
      target,
      kind: kind as Edge['kind'],
    };
    db.insertEdge(edge);
  }

  it('should return zero counts when no dependencies exist', async () => {
    const result = await integrator.cleanup(() => true);
    expect(result.nodesRemoved).toBe(0);
    expect(result.edgesRemoved).toBe(0);
  });

  it('should not remove dependencies whose manifests still exist and have declared_in edges', async () => {
    const manifestPath = 'package.json';
    const nodeId = createDependencyNode('express', 'npm', [manifestPath]);

    const manifestExists = () => true;

    const result = await integrator.cleanup(manifestExists);
    expect(result.nodesRemoved).toBe(0);
    expect(result.edgesRemoved).toBe(0);

    const node = db.getNode(nodeId);
    expect(node).not.toBeNull();
  });

  it('should remove dependencies with no declared_in edges', async () => {
    const manifestPath = 'package.json';
    const nodeId = createDependencyNode('express', 'npm', [manifestPath], {
      addDeclaredInEdge: false,
    });

    const manifestExists = () => true;

    const result = await integrator.cleanup(manifestExists);
    expect(result.nodesRemoved).toBe(1);

    const node = db.getNode(nodeId);
    expect(node).toBeNull();
  });

  it('should remove dependencies whose manifests no longer exist on disk', async () => {
    const manifestPath = 'package.json';
    const nodeId = createDependencyNode('express', 'npm', [manifestPath]);

    const manifestExists = () => false;

    const result = await integrator.cleanup(manifestExists);
    expect(result.nodesRemoved).toBe(1);

    const node = db.getNode(nodeId);
    expect(node).toBeNull();
  });

  it('should remove edges connected to orphaned nodes', async () => {
    const manifestPath = 'package.json';
    const depNodeId = createDependencyNode('lodash', 'npm', [manifestPath], {
      addDeclaredInEdge: false,
    });

    const codeNode: Node = {
      id: 'file:src/index.ts:import:lodash',
      kind: 'import',
      name: 'lodash',
      qualifiedName: 'src/index.ts:lodash',
      filePath: 'src/index.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 20,
      updatedAt: Date.now(),
    };
    db.upsertNode(codeNode);
    createEdge(codeNode.id, depNodeId, 'imports');

    const manifestExists = () => true;
    const result = await integrator.cleanup(manifestExists);
    expect(result.nodesRemoved).toBe(1);
    expect(result.edgesRemoved).toBe(1);
  });

  it('should keep dependency if at least one source manifest exists on disk', async () => {
    const manifests = ['packages/a/package.json', 'packages/b/package.json'];
    const nodeId = createDependencyNode('react', 'npm', manifests);

    const manifestExists = (p: string) => p.includes('packages/a/package.json');

    const result = await integrator.cleanup(manifestExists);
    expect(result.nodesRemoved).toBe(0);

    const node = db.getNode(nodeId);
    expect(node).not.toBeNull();
  });

  it('should remove transitive dependencies no longer reachable from direct deps', async () => {
    const manifest = 'package.json';

    // Direct dependency (manifest exists, has declared_in edge)
    const directId = createDependencyNode('express', 'npm', [manifest]);

    // Transitive dependency reachable from express
    const reachableTransId = createDependencyNode('accepts', 'npm', [manifest]);
    createEdge(directId, reachableTransId, 'depends_on');

    // Orphaned direct dependency (no declared_in edge)
    const orphanedDirectId = createDependencyNode('lodash', 'npm', ['old-package.json'], {
      addDeclaredInEdge: false,
    });

    // Transitive dependency ONLY reachable from orphaned direct (no declared_in edge)
    const unreachableTransId = createDependencyNode('lodash.merge', 'npm', ['old-package.json'], {
      addDeclaredInEdge: false,
    });
    createEdge(orphanedDirectId, unreachableTransId, 'depends_on');

    const manifestExists = () => true;

    const result = await integrator.cleanup(manifestExists);

    // lodash and lodash.merge should be removed
    expect(result.nodesRemoved).toBe(2);

    // express and accepts should remain
    expect(db.getNode(directId)).not.toBeNull();
    expect(db.getNode(reachableTransId)).not.toBeNull();

    // orphaned nodes should be gone
    expect(db.getNode(orphanedDirectId)).toBeNull();
    expect(db.getNode(unreachableTransId)).toBeNull();
  });

  it('should handle transitive chains correctly — all reachable from direct dep', async () => {
    const manifest = 'package.json';

    const directId = createDependencyNode('express', 'npm', [manifest]);

    // Chain: express → body-parser → raw-body → bytes
    const bp = createDependencyNode('body-parser', 'npm', [manifest]);
    const rb = createDependencyNode('raw-body', 'npm', [manifest]);
    const bytes = createDependencyNode('bytes', 'npm', [manifest]);

    createEdge(directId, bp, 'depends_on');
    createEdge(bp, rb, 'depends_on');
    createEdge(rb, bytes, 'depends_on');

    const manifestExists = () => true;

    const result = await integrator.cleanup(manifestExists);

    expect(result.nodesRemoved).toBe(0);
    expect(result.edgesRemoved).toBe(0);
  });

  it('should count edges correctly when multiple edges connect to orphaned node', async () => {
    const orphanedManifest = 'removed/package.json';
    const depId = createDependencyNode('old-pkg', 'npm', [orphanedManifest], {
      addDeclaredInEdge: false,
    });

    const codeNode1: Node = {
      id: 'node:a',
      kind: 'function',
      name: 'funcA',
      qualifiedName: 'funcA',
      filePath: 'src/a.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 5,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    };
    const codeNode2: Node = {
      id: 'node:b',
      kind: 'function',
      name: 'funcB',
      qualifiedName: 'funcB',
      filePath: 'src/b.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 5,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    };
    db.upsertNode(codeNode1);
    db.upsertNode(codeNode2);

    createEdge(codeNode1.id, depId, 'imports');
    createEdge(codeNode2.id, depId, 'references');
    createEdge(depId, 'some-manifest', 'declared_in');

    // No manifests exist on disk
    const manifestExists = () => false;

    const result = await integrator.cleanup(manifestExists);
    expect(result.nodesRemoved).toBe(1);
    // 2 incoming (imports, references) + 1 outgoing (declared_in) = 3
    expect(result.edgesRemoved).toBe(3);
  });
});
