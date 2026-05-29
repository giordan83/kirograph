/**
 * Unit tests for security context warnings
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSecurityWarningsForNodes, formatSecurityWarnings } from './context-warnings';
import type { SecurityWarning } from './context-warnings';
import { GraphDatabase } from '../db/database';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Test Helpers ─────────────────────────────────────────────────────────────

function createTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-warn-test-'));
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

function insertEntryPoint(db: GraphDatabase, nodeId: string, name: string): void {
  db.upsertNode({
    id: nodeId,
    kind: 'function',
    name,
    qualifiedName: name,
    filePath: 'src/index.ts',
    language: 'typescript',
    startLine: 1,
    endLine: 10,
    startColumn: 0,
    endColumn: 0,
    updatedAt: Date.now(),
  });
}

function insertVulnerability(
  db: GraphDatabase,
  opts: {
    vulnNodeId: string;
    depNodeId: string;
    cveId: string;
    severityScore: number;
    fixedVersion?: string;
    packageName: string;
    ecosystem: string;
    verdict: string;
    paths: Array<{ entryPoint: string; path: string[] }>;
  },
): void {
  const rawDb = db.getRawDb();

  // Insert dependency node
  db.upsertNode({
    id: opts.depNodeId,
    kind: 'dependency',
    name: opts.packageName,
    qualifiedName: `${opts.ecosystem}/${opts.packageName}`,
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
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [opts.depNodeId, opts.ecosystem, opts.packageName, '^1.0.0', '1.0.0', 'production', '["package.json"]'],
  );

  // Insert vulnerability node
  db.upsertNode({
    id: opts.vulnNodeId,
    kind: 'vulnerability',
    name: opts.cveId,
    qualifiedName: opts.cveId,
    filePath: 'package.json',
    language: 'unknown',
    startLine: 0,
    endLine: 0,
    startColumn: 0,
    endColumn: 0,
    updatedAt: Date.now(),
  });

  rawDb.run(
    `INSERT OR REPLACE INTO sec_vulnerabilities
      (node_id, cve_id, severity_score, affected_ranges, fixed_version, summary, source_database)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [opts.vulnNodeId, opts.cveId, opts.severityScore, '[]', opts.fixedVersion ?? null, 'Test vulnerability', 'OSV'],
  );

  // Insert has_vulnerability edge (from dependency to vulnerability)
  db.insertEdge({
    source: opts.depNodeId,
    target: opts.vulnNodeId,
    kind: 'has_vulnerability',
  });

  // Insert reachability record
  rawDb.run(
    `INSERT OR REPLACE INTO sec_reachability
      (vulnerability_node_id, verdict, paths, reaching_entry_point_count, analyzed_at)
     VALUES (?, ?, ?, ?, ?)`,
    [opts.vulnNodeId, opts.verdict, JSON.stringify(opts.paths), opts.paths.length, Date.now()],
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('getSecurityWarningsForNodes', () => {
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

  it('returns empty array when no node IDs provided', () => {
    const result = getSecurityWarningsForNodes(db.getRawDb(), []);
    expect(result).toEqual([]);
  });

  it('returns empty array when no vulnerabilities exist', () => {
    insertEntryPoint(db, 'node-1', 'handleRequest');
    const result = getSecurityWarningsForNodes(db.getRawDb(), ['node-1']);
    expect(result).toEqual([]);
  });

  it('returns warnings for vulnerabilities reachable from context nodes', () => {
    insertEntryPoint(db, 'entry-1', 'handleRequest');
    insertVulnerability(db, {
      vulnNodeId: 'vuln-1',
      depNodeId: 'dep-1',
      cveId: 'CVE-2023-12345',
      severityScore: 9.8,
      fixedVersion: '1.2.0',
      packageName: 'express',
      ecosystem: 'npm',
      verdict: 'affected',
      paths: [{ entryPoint: 'entry-1', path: ['entry-1', 'mid-1', 'dep-1'] }],
    });

    const result = getSecurityWarningsForNodes(db.getRawDb(), ['entry-1']);
    expect(result).toHaveLength(1);
    expect(result[0].cveId).toBe('CVE-2023-12345');
    expect(result[0].severityScore).toBe(9.8);
    expect(result[0].packageName).toBe('express');
    expect(result[0].ecosystem).toBe('npm');
    expect(result[0].fixedVersion).toBe('1.2.0');
    expect(result[0].entryPoints).toContain('entry-1');
  });

  it('returns warnings when a context node is on the path (not just entry point)', () => {
    insertEntryPoint(db, 'entry-1', 'handleRequest');
    insertEntryPoint(db, 'mid-1', 'processData');
    insertVulnerability(db, {
      vulnNodeId: 'vuln-1',
      depNodeId: 'dep-1',
      cveId: 'CVE-2023-99999',
      severityScore: 7.5,
      packageName: 'lodash',
      ecosystem: 'npm',
      verdict: 'affected',
      paths: [{ entryPoint: 'entry-1', path: ['entry-1', 'mid-1', 'dep-1'] }],
    });

    // Query with mid-1 (intermediate node on path)
    const result = getSecurityWarningsForNodes(db.getRawDb(), ['mid-1']);
    expect(result).toHaveLength(1);
    expect(result[0].cveId).toBe('CVE-2023-99999');
  });

  it('does not return warnings for not_affected vulnerabilities', () => {
    insertEntryPoint(db, 'entry-1', 'handleRequest');
    insertVulnerability(db, {
      vulnNodeId: 'vuln-1',
      depNodeId: 'dep-1',
      cveId: 'CVE-2023-00001',
      severityScore: 5.0,
      packageName: 'some-pkg',
      ecosystem: 'npm',
      verdict: 'not_affected',
      paths: [],
    });

    const result = getSecurityWarningsForNodes(db.getRawDb(), ['entry-1']);
    expect(result).toEqual([]);
  });

  it('does not return warnings when context nodes are not on any path', () => {
    insertEntryPoint(db, 'entry-1', 'handleRequest');
    insertEntryPoint(db, 'unrelated', 'otherFunction');
    insertVulnerability(db, {
      vulnNodeId: 'vuln-1',
      depNodeId: 'dep-1',
      cveId: 'CVE-2023-11111',
      severityScore: 8.0,
      packageName: 'express',
      ecosystem: 'npm',
      verdict: 'affected',
      paths: [{ entryPoint: 'entry-1', path: ['entry-1', 'dep-1'] }],
    });

    // Query with 'unrelated' which is not on any path
    const result = getSecurityWarningsForNodes(db.getRawDb(), ['unrelated']);
    expect(result).toEqual([]);
  });

  it('sorts warnings by severity (highest first)', () => {
    insertEntryPoint(db, 'entry-1', 'handleRequest');
    insertVulnerability(db, {
      vulnNodeId: 'vuln-1',
      depNodeId: 'dep-1',
      cveId: 'CVE-2023-LOW',
      severityScore: 3.0,
      packageName: 'low-pkg',
      ecosystem: 'npm',
      verdict: 'affected',
      paths: [{ entryPoint: 'entry-1', path: ['entry-1', 'dep-1'] }],
    });
    insertVulnerability(db, {
      vulnNodeId: 'vuln-2',
      depNodeId: 'dep-2',
      cveId: 'CVE-2023-HIGH',
      severityScore: 9.5,
      packageName: 'high-pkg',
      ecosystem: 'npm',
      verdict: 'affected',
      paths: [{ entryPoint: 'entry-1', path: ['entry-1', 'dep-2'] }],
    });

    const result = getSecurityWarningsForNodes(db.getRawDb(), ['entry-1']);
    expect(result).toHaveLength(2);
    expect(result[0].cveId).toBe('CVE-2023-HIGH');
    expect(result[1].cveId).toBe('CVE-2023-LOW');
  });
});

describe('formatSecurityWarnings', () => {
  it('returns empty string when no warnings', () => {
    expect(formatSecurityWarnings([], new Map())).toBe('');
  });

  it('formats a single warning with severity and entry point', () => {
    const warnings: SecurityWarning[] = [
      {
        cveId: 'CVE-2023-12345',
        severityScore: 9.8,
        packageName: 'express',
        ecosystem: 'npm',
        fixedVersion: '4.18.3',
        entryPoints: ['entry-1'],
      },
    ];
    const nodeNames = new Map([['entry-1', 'handleRequest']]);

    const result = formatSecurityWarnings(warnings, nodeNames);
    expect(result).toContain('## ⚠ Security');
    expect(result).toContain('**CVE-2023-12345**');
    expect(result).toContain('CVSS 9.8');
    expect(result).toContain('express (npm)');
    expect(result).toContain('handleRequest');
    expect(result).toContain('💡 Fix: npm install express@4.18.3');
  });

  it('shows max 3 vulnerabilities and a "more" note', () => {
    const warnings: SecurityWarning[] = Array.from({ length: 5 }, (_, i) => ({
      cveId: `CVE-2023-${i}`,
      severityScore: 9.0 - i,
      packageName: `pkg-${i}`,
      ecosystem: 'npm',
      fixedVersion: null,
      entryPoints: ['entry-1'],
    }));
    const nodeNames = new Map([['entry-1', 'main']]);

    const result = formatSecurityWarnings(warnings, nodeNames);
    expect(result).toContain('CVE-2023-0');
    expect(result).toContain('CVE-2023-1');
    expect(result).toContain('CVE-2023-2');
    expect(result).not.toContain('CVE-2023-3');
    expect(result).not.toContain('CVE-2023-4');
    expect(result).toContain('2 more — use kirograph_vulns for full list');
  });

  it('does not show fix suggestion when fixedVersion is null', () => {
    const warnings: SecurityWarning[] = [
      {
        cveId: 'CVE-2023-99999',
        severityScore: 7.0,
        packageName: 'lodash',
        ecosystem: 'npm',
        fixedVersion: null,
        entryPoints: ['entry-1'],
      },
    ];
    const nodeNames = new Map([['entry-1', 'main']]);

    const result = formatSecurityWarnings(warnings, nodeNames);
    expect(result).not.toContain('💡 Fix');
  });

  it('uses node ID when name is not in the map', () => {
    const warnings: SecurityWarning[] = [
      {
        cveId: 'CVE-2023-00001',
        severityScore: 5.0,
        packageName: 'some-pkg',
        ecosystem: 'npm',
        fixedVersion: null,
        entryPoints: ['unknown-id'],
      },
    ];

    const result = formatSecurityWarnings(warnings, new Map());
    expect(result).toContain('unknown-id');
  });
});
