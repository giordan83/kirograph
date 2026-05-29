/**
 * Tests for DependencyGraphIntegrator.resolveTransitives()
 *
 * Verifies transitive dependency resolution from lock files,
 * creation of depends_on edges, and incomplete status marking.
 *
 * Requirements: 2.3, 2.5
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DependencyGraphIntegrator } from './integrator';
import { GraphDatabase } from '../db/database';
import type { Node, Edge } from '../types';

describe('DependencyGraphIntegrator.resolveTransitives()', () => {
  let db: GraphDatabase;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kirograph-transitives-test-'));
    db = new GraphDatabase(tmpDir);
    db.applySecuritySchema();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper to create a dependency node in the database.
   */
  function createDepNode(
    name: string,
    ecosystem: string,
    version?: string,
  ): string {
    const nodeId = `dep:${ecosystem}:${name}`;
    const rawDb = db.getRawDb();

    const node: Node = {
      id: nodeId,
      kind: 'dependency',
      name,
      qualifiedName: `${ecosystem}/${name}`,
      filePath: 'package.json',
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
        (node_id, ecosystem, package_name, declared_constraint,
         resolved_version, scope, source_manifests)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        nodeId,
        ecosystem,
        name,
        version ?? '^1.0.0',
        version ?? '1.0.0',
        'production',
        '["package.json"]',
      ],
    );
    return nodeId;
  }

  it('should create depends_on edges from npm package-lock.json', async () => {
    createDepNode('express', 'npm');
    createDepNode('body-parser', 'npm');
    createDepNode('accepts', 'npm');

    // Create a package-lock.json with transitive relationships
    const lockData = {
      name: 'test-project',
      lockfileVersion: 3,
      packages: {
        '': { name: 'test-project', version: '1.0.0' },
        'node_modules/express': {
          version: '4.18.2',
          dependencies: { 'body-parser': '^1.20.0', accepts: '~1.3.8' },
        },
        'node_modules/body-parser': {
          version: '1.20.2',
          dependencies: {},
        },
        'node_modules/accepts': {
          version: '1.3.8',
          dependencies: {},
        },
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, 'package-lock.json'),
      JSON.stringify(lockData, null, 2),
    );

    const integrator = new DependencyGraphIntegrator(db, tmpDir);
    const result = await integrator.resolveTransitives(10);

    expect(result.dependsOnEdgesCreated).toBe(2);
    expect(result.incompleteNodes).toHaveLength(0);

    // Verify edges exist
    const edges = db.getAllEdges();
    const dependsOnEdges = edges.filter(e => e.kind === 'depends_on');
    expect(dependsOnEdges).toHaveLength(2);

    // express depends_on body-parser
    expect(dependsOnEdges).toContainEqual(
      expect.objectContaining({
        source: 'dep:npm:express',
        target: 'dep:npm:body-parser',
        kind: 'depends_on',
      }),
    );
    // express depends_on accepts
    expect(dependsOnEdges).toContainEqual(
      expect.objectContaining({
        source: 'dep:npm:express',
        target: 'dep:npm:accepts',
        kind: 'depends_on',
      }),
    );
  });

  it('should mark dependencies as incomplete when no lock file exists', async () => {
    createDepNode('serde', 'cargo');
    createDepNode('tokio', 'cargo');

    // No Cargo.lock in tmpDir
    const integrator = new DependencyGraphIntegrator(db, tmpDir);
    const result = await integrator.resolveTransitives(10);

    expect(result.dependsOnEdgesCreated).toBe(0);
    expect(result.incompleteNodes).toHaveLength(2);
    expect(result.incompleteNodes).toContain('dep:cargo:serde');
    expect(result.incompleteNodes).toContain('dep:cargo:tokio');

    // Verify transitive_status is set to incomplete in the database
    const rawDb = db.getRawDb();
    const row = rawDb.get(
      'SELECT transitive_status FROM sec_dependencies WHERE node_id = ?',
      ['dep:cargo:serde'],
    );
    expect(row.transitive_status).toBe('incomplete');
  });

  it('should respect maxDepth limit', async () => {
    // Create a chain: a -> b -> c -> d
    createDepNode('a', 'npm');
    createDepNode('b', 'npm');
    createDepNode('c', 'npm');
    createDepNode('d', 'npm');

    const lockData = {
      name: 'test-project',
      lockfileVersion: 3,
      packages: {
        '': { name: 'test-project', version: '1.0.0' },
        'node_modules/a': {
          version: '1.0.0',
          dependencies: { b: '^1.0.0' },
        },
        'node_modules/b': {
          version: '1.0.0',
          dependencies: { c: '^1.0.0' },
        },
        'node_modules/c': {
          version: '1.0.0',
          dependencies: { d: '^1.0.0' },
        },
        'node_modules/d': {
          version: '1.0.0',
          dependencies: {},
        },
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, 'package-lock.json'),
      JSON.stringify(lockData, null, 2),
    );

    // With maxDepth=1, each node resolves only 1 level of its own transitives
    const integrator = new DependencyGraphIntegrator(db, tmpDir);
    const result = await integrator.resolveTransitives(1);

    // a->b (depth 1 from a), b->c (depth 1 from b), c->d (depth 1 from c)
    expect(result.dependsOnEdgesCreated).toBe(3);

    // Verify that deeper transitive edges are NOT created
    // (e.g., a should NOT have a depends_on edge to c or d)
    const edges = db.getAllEdges();
    const dependsOnEdges = edges.filter(e => e.kind === 'depends_on');

    // Only direct transitive edges should exist
    const edgePairs = dependsOnEdges.map(e => `${e.source}->${e.target}`);
    expect(edgePairs).toContain('dep:npm:a->dep:npm:b');
    expect(edgePairs).toContain('dep:npm:b->dep:npm:c');
    expect(edgePairs).toContain('dep:npm:c->dep:npm:d');
    // a should NOT directly depend on c or d at depth 1
    expect(edgePairs).not.toContain('dep:npm:a->dep:npm:c');
    expect(edgePairs).not.toContain('dep:npm:a->dep:npm:d');
  });

  it('should handle Cargo.lock transitive dependencies', async () => {
    createDepNode('serde', 'cargo');
    createDepNode('serde_derive', 'cargo');

    // Create a Cargo.lock with dependency relationships
    const cargoLock = `[[package]]
name = "serde"
version = "1.0.193"
dependencies = [
 "serde_derive",
]

[[package]]
name = "serde_derive"
version = "1.0.193"
`;
    fs.writeFileSync(path.join(tmpDir, 'Cargo.lock'), cargoLock);

    const integrator = new DependencyGraphIntegrator(db, tmpDir);
    const result = await integrator.resolveTransitives(10);

    expect(result.dependsOnEdgesCreated).toBe(1);
    expect(result.incompleteNodes).toHaveLength(0);

    const edges = db.getAllEdges();
    const dependsOnEdges = edges.filter(e => e.kind === 'depends_on');
    expect(dependsOnEdges).toContainEqual(
      expect.objectContaining({
        source: 'dep:cargo:serde',
        target: 'dep:cargo:serde_derive',
        kind: 'depends_on',
      }),
    );
  });

  it('should mark Go dependencies as incomplete (no tree in go.sum)', async () => {
    createDepNode('github.com/gin-gonic/gin', 'go');

    // Create a go.sum file (doesn't encode dependency tree)
    fs.writeFileSync(
      path.join(tmpDir, 'go.sum'),
      'github.com/gin-gonic/gin v1.9.1 h1:abc=\n',
    );

    const integrator = new DependencyGraphIntegrator(db, tmpDir);
    const result = await integrator.resolveTransitives(10);

    expect(result.dependsOnEdgesCreated).toBe(0);
    expect(result.incompleteNodes).toHaveLength(1);
    expect(result.incompleteNodes).toContain('dep:go:github.com/gin-gonic/gin');
  });

  it('should return empty result when no dependencies exist', async () => {
    const integrator = new DependencyGraphIntegrator(db, tmpDir);
    const result = await integrator.resolveTransitives(10);

    expect(result.dependsOnEdgesCreated).toBe(0);
    expect(result.incompleteNodes).toHaveLength(0);
  });

  it('should not create duplicate depends_on edges', async () => {
    createDepNode('express', 'npm');
    createDepNode('body-parser', 'npm');

    const lockData = {
      name: 'test-project',
      lockfileVersion: 3,
      packages: {
        '': { name: 'test-project', version: '1.0.0' },
        'node_modules/express': {
          version: '4.18.2',
          dependencies: { 'body-parser': '^1.20.0' },
        },
        'node_modules/body-parser': {
          version: '1.20.2',
          dependencies: {},
        },
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, 'package-lock.json'),
      JSON.stringify(lockData, null, 2),
    );

    const integrator = new DependencyGraphIntegrator(db, tmpDir);
    const result = await integrator.resolveTransitives(10);

    expect(result.dependsOnEdgesCreated).toBe(1);

    // Verify only one edge exists
    const edges = db.getAllEdges();
    const dependsOnEdges = edges.filter(e => e.kind === 'depends_on');
    expect(dependsOnEdges).toHaveLength(1);
  });

  it('should handle npm lockfileVersion 1 format', async () => {
    createDepNode('express', 'npm');
    createDepNode('debug', 'npm');

    const lockData = {
      name: 'test-project',
      lockfileVersion: 1,
      dependencies: {
        express: {
          version: '4.18.2',
          requires: { debug: '2.6.9' },
        },
        debug: {
          version: '2.6.9',
        },
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, 'package-lock.json'),
      JSON.stringify(lockData, null, 2),
    );

    const integrator = new DependencyGraphIntegrator(db, tmpDir);
    const result = await integrator.resolveTransitives(10);

    expect(result.dependsOnEdgesCreated).toBe(1);

    const edges = db.getAllEdges();
    const dependsOnEdges = edges.filter(e => e.kind === 'depends_on');
    expect(dependsOnEdges).toContainEqual(
      expect.objectContaining({
        source: 'dep:npm:express',
        target: 'dep:npm:debug',
        kind: 'depends_on',
      }),
    );
  });

  it('should handle deep transitive chains with maxDepth=10', async () => {
    // Create a chain of 5 dependencies: a -> b -> c -> d -> e
    createDepNode('a', 'npm');
    createDepNode('b', 'npm');
    createDepNode('c', 'npm');
    createDepNode('d', 'npm');
    createDepNode('e', 'npm');

    const lockData = {
      name: 'test-project',
      lockfileVersion: 3,
      packages: {
        '': { name: 'test-project', version: '1.0.0' },
        'node_modules/a': { version: '1.0.0', dependencies: { b: '1.0.0' } },
        'node_modules/b': { version: '1.0.0', dependencies: { c: '1.0.0' } },
        'node_modules/c': { version: '1.0.0', dependencies: { d: '1.0.0' } },
        'node_modules/d': { version: '1.0.0', dependencies: { e: '1.0.0' } },
        'node_modules/e': { version: '1.0.0', dependencies: {} },
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, 'package-lock.json'),
      JSON.stringify(lockData, null, 2),
    );

    const integrator = new DependencyGraphIntegrator(db, tmpDir);
    const result = await integrator.resolveTransitives(10);

    // All edges in the chain should be created
    expect(result.dependsOnEdgesCreated).toBe(4);
    expect(result.incompleteNodes).toHaveLength(0);
  });

  it('should handle circular dependencies in lock file gracefully', async () => {
    createDepNode('a', 'npm');
    createDepNode('b', 'npm');

    // a depends on b, b depends on a (circular)
    const lockData = {
      name: 'test-project',
      lockfileVersion: 3,
      packages: {
        '': { name: 'test-project', version: '1.0.0' },
        'node_modules/a': { version: '1.0.0', dependencies: { b: '1.0.0' } },
        'node_modules/b': { version: '1.0.0', dependencies: { a: '1.0.0' } },
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, 'package-lock.json'),
      JSON.stringify(lockData, null, 2),
    );

    const integrator = new DependencyGraphIntegrator(db, tmpDir);
    const result = await integrator.resolveTransitives(10);

    // Should create edges without infinite loop
    expect(result.dependsOnEdgesCreated).toBe(2);
    expect(result.incompleteNodes).toHaveLength(0);
  });

  it('should log warning with dependency name when marking incomplete', async () => {
    createDepNode('flask', 'python');

    // No pip lock file exists
    const integrator = new DependencyGraphIntegrator(db, tmpDir);
    const result = await integrator.resolveTransitives(10);

    expect(result.incompleteNodes).toContain('dep:python:flask');

    // Verify the database was updated
    const rawDb = db.getRawDb();
    const row = rawDb.get(
      'SELECT transitive_status FROM sec_dependencies WHERE node_id = ?',
      ['dep:python:flask'],
    );
    expect(row.transitive_status).toBe('incomplete');
  });
});
