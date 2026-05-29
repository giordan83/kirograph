/**
 * Unit tests for SBOMExporter — CycloneDX 1.5 SBOM generation
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SBOMExporter } from './sbom';
import { GraphDatabase } from '../../db/database';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Test Helpers ─────────────────────────────────────────────────────────────

function createTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbom-test-'));
  // Create a package.json so the project name can be detected
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'test-project', version: '1.0.0' }),
  );
  return dir;
}

function setupDb(projectRoot: string): GraphDatabase {
  const db = new GraphDatabase(projectRoot);
  db.applySecuritySchema();
  return db;
}

function insertDependency(
  db: GraphDatabase,
  opts: {
    nodeId: string;
    ecosystem: string;
    packageName: string;
    declaredConstraint: string;
    resolvedVersion?: string;
    scope?: string;
    sourceManifests?: string[];
    isDirect?: boolean;
  },
): void {
  const rawDb = db.getRawDb();

  // Insert into nodes table
  db.upsertNode({
    id: opts.nodeId,
    kind: 'dependency',
    name: opts.packageName,
    qualifiedName: `${opts.ecosystem}/${opts.packageName}`,
    filePath: opts.sourceManifests?.[0] ?? 'package.json',
    language: 'unknown',
    startLine: 0,
    endLine: 0,
    startColumn: 0,
    endColumn: 0,
    updatedAt: Date.now(),
  });

  // Insert into sec_dependencies
  rawDb.run(
    `INSERT OR REPLACE INTO sec_dependencies
      (node_id, ecosystem, package_name, declared_constraint, resolved_version, scope, source_manifests)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.nodeId,
      opts.ecosystem,
      opts.packageName,
      opts.declaredConstraint,
      opts.resolvedVersion ?? null,
      opts.scope ?? 'production',
      JSON.stringify(opts.sourceManifests ?? ['package.json']),
    ],
  );

  // Create declared_in edge if direct
  if (opts.isDirect !== false) {
    db.insertEdge({
      source: opts.nodeId,
      target: opts.sourceManifests?.[0] ?? 'package.json',
      kind: 'declared_in',
    });
  }
}

function insertDependsOnEdge(db: GraphDatabase, source: string, target: string): void {
  db.insertEdge({ source, target, kind: 'depends_on' });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SBOMExporter', () => {
  let projectRoot: string;
  let db: GraphDatabase;

  beforeEach(() => {
    projectRoot = createTempProject();
    db = setupDb(projectRoot);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  describe('empty dependency graph', () => {
    it('generates a valid CycloneDX 1.5 document with empty components', () => {
      const exporter = new SBOMExporter(db, projectRoot);
      const sbom = exporter.export();

      expect(sbom.bomFormat).toBe('CycloneDX');
      expect(sbom.specVersion).toBe('1.5');
      expect(sbom.version).toBe(1);
      expect(sbom.components).toEqual([]);
      expect(sbom.dependencies).toEqual([]);
      expect(sbom.metadata).toBeDefined();
    });

    it('includes metadata with tool name, timestamp, and project name', () => {
      const exporter = new SBOMExporter(db, projectRoot);
      const sbom = exporter.export();

      const meta = sbom.metadata as any;
      expect(meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(meta.tools.components[0].name).toBe('kirograph-sec');
      expect(meta.tools.components[0].version).toBeDefined();
      expect(meta.component.name).toBe('test-project');
    });
  });

  describe('with dependencies', () => {
    beforeEach(() => {
      insertDependency(db, {
        nodeId: 'dep:npm:express',
        ecosystem: 'npm',
        packageName: 'express',
        declaredConstraint: '^4.18.0',
        resolvedVersion: '4.18.2',
        scope: 'production',
        isDirect: true,
      });

      insertDependency(db, {
        nodeId: 'dep:npm:lodash',
        ecosystem: 'npm',
        packageName: 'lodash',
        declaredConstraint: '^4.17.0',
        resolvedVersion: '4.17.21',
        scope: 'production',
        isDirect: false, // transitive — no declared_in edge
      });

      // express depends on lodash (transitive)
      insertDependsOnEdge(db, 'dep:npm:express', 'dep:npm:lodash');
    });

    it('includes all dependencies as components of type library', () => {
      const exporter = new SBOMExporter(db, projectRoot);
      const sbom = exporter.export();

      expect(sbom.components).toHaveLength(2);
      expect(sbom.components.every((c) => c.type === 'library')).toBe(true);
    });

    it('includes correct purl for each component', () => {
      const exporter = new SBOMExporter(db, projectRoot);
      const sbom = exporter.export();

      const express = sbom.components.find((c) => c.name === 'express');
      expect(express?.purl).toBe('pkg:npm/express@4.18.2');

      const lodash = sbom.components.find((c) => c.name === 'lodash');
      expect(lodash?.purl).toBe('pkg:npm/lodash@4.17.21');
    });

    it('sets scope to "required" for direct and "optional" for transitive', () => {
      const exporter = new SBOMExporter(db, projectRoot);
      const sbom = exporter.export();

      const express = sbom.components.find((c) => c.name === 'express');
      expect(express?.scope).toBe('required');

      const lodash = sbom.components.find((c) => c.name === 'lodash');
      expect(lodash?.scope).toBe('optional');
    });

    it('includes direct/transitive classification in properties', () => {
      const exporter = new SBOMExporter(db, projectRoot);
      const sbom = exporter.export();

      const express = sbom.components.find((c) => c.name === 'express');
      const expressClassification = express?.properties?.find(
        (p) => p.name === 'kirograph:classification',
      );
      expect(expressClassification?.value).toBe('direct');

      const lodash = sbom.components.find((c) => c.name === 'lodash');
      const lodashClassification = lodash?.properties?.find(
        (p) => p.name === 'kirograph:classification',
      );
      expect(lodashClassification?.value).toBe('transitive');
    });

    it('includes dependency relationships reflecting depends_on edges', () => {
      const exporter = new SBOMExporter(db, projectRoot);
      const sbom = exporter.export();

      const expressDep = sbom.dependencies.find(
        (d) => d.ref === 'pkg:npm/express@4.18.2',
      );
      expect(expressDep).toBeDefined();
      expect(expressDep?.dependsOn).toContain('pkg:npm/lodash@4.17.21');

      // lodash has no depends_on
      const lodashDep = sbom.dependencies.find(
        (d) => d.ref === 'pkg:npm/lodash@4.17.21',
      );
      expect(lodashDep).toBeDefined();
      expect(lodashDep?.dependsOn).toBeUndefined();
    });
  });

  describe('version fallback', () => {
    it('uses declared constraint when resolved version is not available', () => {
      insertDependency(db, {
        nodeId: 'dep:npm:some-pkg',
        ecosystem: 'npm',
        packageName: 'some-pkg',
        declaredConstraint: '>=2.0.0',
        resolvedVersion: undefined,
        isDirect: true,
      });

      const exporter = new SBOMExporter(db, projectRoot);
      const sbom = exporter.export();

      const comp = sbom.components.find((c) => c.name === 'some-pkg');
      expect(comp?.version).toBe('>=2.0.0');
      expect(comp?.purl).toBe('pkg:npm/some-pkg@>=2.0.0');
    });
  });

  describe('ecosystem purl mapping', () => {
    it('maps go ecosystem to golang in purl', () => {
      insertDependency(db, {
        nodeId: 'dep:go:github.com/gin-gonic/gin',
        ecosystem: 'go',
        packageName: 'github.com/gin-gonic/gin',
        declaredConstraint: 'v1.9.1',
        resolvedVersion: 'v1.9.1',
        isDirect: true,
      });

      const exporter = new SBOMExporter(db, projectRoot);
      const sbom = exporter.export();

      const comp = sbom.components.find((c) => c.name === 'github.com/gin-gonic/gin');
      expect(comp?.purl).toBe('pkg:golang/github.com/gin-gonic/gin@v1.9.1');
    });

    it('maps python ecosystem to pypi in purl', () => {
      insertDependency(db, {
        nodeId: 'dep:python:django',
        ecosystem: 'python',
        packageName: 'django',
        declaredConstraint: '==4.2.0',
        resolvedVersion: '4.2.0',
        isDirect: true,
      });

      const exporter = new SBOMExporter(db, projectRoot);
      const sbom = exporter.export();

      const comp = sbom.components.find((c) => c.name === 'django');
      expect(comp?.purl).toBe('pkg:pypi/django@4.2.0');
    });

    it('maps cargo ecosystem correctly in purl', () => {
      insertDependency(db, {
        nodeId: 'dep:cargo:serde',
        ecosystem: 'cargo',
        packageName: 'serde',
        declaredConstraint: '1.0.188',
        resolvedVersion: '1.0.188',
        isDirect: true,
      });

      const exporter = new SBOMExporter(db, projectRoot);
      const sbom = exporter.export();

      const comp = sbom.components.find((c) => c.name === 'serde');
      expect(comp?.purl).toBe('pkg:cargo/serde@1.0.188');
    });

    it('maps maven ecosystem correctly in purl', () => {
      insertDependency(db, {
        nodeId: 'dep:maven:org.apache.logging.log4j/log4j-core',
        ecosystem: 'maven',
        packageName: 'org.apache.logging.log4j/log4j-core',
        declaredConstraint: '2.17.0',
        resolvedVersion: '2.17.0',
        isDirect: true,
      });

      const exporter = new SBOMExporter(db, projectRoot);
      const sbom = exporter.export();

      const comp = sbom.components.find(
        (c) => c.name === 'org.apache.logging.log4j/log4j-core',
      );
      expect(comp?.purl).toBe(
        'pkg:maven/org.apache.logging.log4j/log4j-core@2.17.0',
      );
    });
  });

  describe('exportJSON', () => {
    it('returns a pretty-printed JSON string', () => {
      insertDependency(db, {
        nodeId: 'dep:npm:express',
        ecosystem: 'npm',
        packageName: 'express',
        declaredConstraint: '^4.18.0',
        resolvedVersion: '4.18.2',
        isDirect: true,
      });

      const exporter = new SBOMExporter(db, projectRoot);
      const json = exporter.exportJSON();

      // Should be valid JSON
      const parsed = JSON.parse(json);
      expect(parsed.bomFormat).toBe('CycloneDX');
      expect(parsed.specVersion).toBe('1.5');

      // Should be pretty-printed (contains newlines and indentation)
      expect(json).toContain('\n');
      expect(json).toContain('  ');
    });
  });
});
