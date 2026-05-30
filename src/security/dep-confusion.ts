/**
 * Dependency Confusion Checker
 *
 * Detects internal packages whose names exist in public registries
 * (a supply chain attack vector), and flags typosquatting candidates.
 */

import { logWarn } from '../errors';
import type { GraphDatabase } from '../db/database';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DepConfusionFinding {
  packageName: string;
  ecosystem: string;
  internalSource: string;    // e.g. "private registry" or "local path"
  publicExists: boolean;
  publicVersion: string | null;
  publicPublishedAt: string | null;
  riskLevel: 'critical' | 'high' | 'medium';
  explanation: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Well-known packages for typosquatting detection
const WELL_KNOWN_NPM: string[] = [
  'lodash', 'express', 'react', 'axios', 'webpack', 'babel', 'moment',
  'next', 'vue', 'angular',
];

// ── Levenshtein distance (for typosquatting) ──────────────────────────────────

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0]![j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,       // deletion
        matrix[i]![j - 1]! + 1,        // insertion
        matrix[i - 1]![j - 1]! + cost, // substitution
      );
    }
  }
  return matrix[b.length]![a.length]!;
}

function isTyposquatCandidate(name: string, wellKnown: string[]): string | null {
  // Strip scoped prefix for comparison
  const base = name.startsWith('@') ? name.split('/')[1] ?? name : name;
  for (const known of wellKnown) {
    const dist = levenshtein(base.toLowerCase(), known.toLowerCase());
    if (dist > 0 && dist <= 2) return known;
  }
  return null;
}

// ── Registry HEAD check ───────────────────────────────────────────────────────

const TIMEOUT_MS = 10_000;

interface PublicInfo {
  exists: boolean;
  version: string | null;
  publishedAt: string | null;
}

async function checkNpmPublic(name: string): Promise<PublicInfo> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const encoded = encodeURIComponent(name);
    const resp = await fetch(`https://registry.npmjs.org/${encoded}/latest`, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!resp.ok) return { exists: false, version: null, publishedAt: null };
    const data = await resp.json() as Record<string, unknown>;
    const version = (data['version'] as string) ?? null;
    // Fetch time info
    const full = await fetch(`https://registry.npmjs.org/${encoded}`, {
      headers: { 'Accept': 'application/json' },
    });
    let publishedAt: string | null = null;
    if (full.ok) {
      const fullData = await full.json() as Record<string, unknown>;
      const time = (fullData['time'] as Record<string, string>) ?? {};
      publishedAt = time['created'] ?? null;
    }
    return { exists: true, version, publishedAt };
  } catch {
    return { exists: false, version: null, publishedAt: null };
  } finally {
    clearTimeout(timer);
  }
}

async function checkPypiPublic(name: string): Promise<PublicInfo> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!resp.ok) return { exists: false, version: null, publishedAt: null };
    const data = await resp.json() as Record<string, unknown>;
    const info = data['info'] as Record<string, unknown>;
    const version = (info['version'] as string) ?? null;
    return { exists: true, version, publishedAt: null };
  } catch {
    return { exists: false, version: null, publishedAt: null };
  } finally {
    clearTimeout(timer);
  }
}

async function checkPublicRegistry(ecosystem: string, name: string): Promise<PublicInfo> {
  const eco = ecosystem.toLowerCase();
  switch (eco) {
    case 'npm':  return checkNpmPublic(name);
    case 'pypi':
    case 'pip':  return checkPypiPublic(name);
    default:
      // For other ecosystems, we do not have a reliable public lookup
      return { exists: false, version: null, publishedAt: null };
  }
}

// ── Internal package detection ────────────────────────────────────────────────

interface InternalIndicator {
  isInternal: boolean;
  source: string;
}

function detectInternal(
  packageName: string,
  sourceManifests: string[],
  declaredConstraint: string,
): InternalIndicator {
  // Local file references
  if (declaredConstraint.startsWith('file:') || declaredConstraint.startsWith('./') || declaredConstraint.startsWith('../')) {
    return { isInternal: true, source: 'local path' };
  }
  if (declaredConstraint.startsWith('git+') || declaredConstraint.startsWith('git://')) {
    return { isInternal: true, source: 'git dependency' };
  }

  // Manifest path hints (e.g. a private registry URL)
  for (const manifest of sourceManifests) {
    if (manifest.includes('.kirograph/local') || manifest.includes('local/')) {
      return { isInternal: true, source: 'local registry' };
    }
  }

  // Scoped packages with company-like scope names (heuristic)
  // e.g. @mycompany/foo — not @types, @babel, @jest, etc.
  const wellKnownScopes = new Set([
    '@types', '@babel', '@jest', '@testing-library', '@angular', '@vue',
    '@react', '@emotion', '@mui', '@chakra-ui', '@tailwindcss', '@storybook',
    '@vitejs', '@rollup', '@esbuild', '@swc', '@aws-sdk', '@google-cloud',
  ]);

  if (packageName.startsWith('@')) {
    const scope = packageName.split('/')[0]!;
    if (!wellKnownScopes.has(scope)) {
      return { isInternal: true, source: `private scope ${scope}` };
    }
  }

  return { isInternal: false, source: 'public registry' };
}

// ── DepConfusionChecker ───────────────────────────────────────────────────────

export class DepConfusionChecker {
  constructor(private readonly db: GraphDatabase) {}

  async check(): Promise<DepConfusionFinding[]> {
    const rawDb = this.db.getRawDb();
    const rows: Array<{
      node_id: string;
      package_name: string;
      ecosystem: string;
      declared_constraint: string;
      source_manifests: string;
      scope: string;
    }> = rawDb.all(
      `SELECT node_id, package_name, ecosystem, declared_constraint, source_manifests, scope
       FROM sec_dependencies
       WHERE scope = 'production'`,
    );

    const findings: DepConfusionFinding[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const key = `${row.ecosystem}:${row.package_name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let manifests: string[] = [];
      try {
        manifests = JSON.parse(row.source_manifests) as string[];
      } catch {
        // ignore malformed JSON
      }

      // ── 1. Internal package confusion ────────────────────────────────────────
      const { isInternal, source } = detectInternal(
        row.package_name,
        manifests,
        row.declared_constraint,
      );

      if (isInternal) {
        let publicInfo: PublicInfo = { exists: false, version: null, publishedAt: null };
        try {
          // For scoped packages, also check the unscoped name
          let nameToCheck = row.package_name;
          if (nameToCheck.startsWith('@')) {
            nameToCheck = nameToCheck.split('/')[1] ?? nameToCheck;
          }
          publicInfo = await checkPublicRegistry(row.ecosystem, nameToCheck);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logWarn(`[dep-confusion] Registry check failed for ${row.package_name}: ${msg}`);
        }

        if (publicInfo.exists) {
          findings.push({
            packageName: row.package_name,
            ecosystem: row.ecosystem,
            internalSource: source,
            publicExists: true,
            publicVersion: publicInfo.version,
            publicPublishedAt: publicInfo.publishedAt,
            riskLevel: 'critical',
            explanation:
              `Package "${row.package_name}" appears to be an internal dependency (${source}) ` +
              `but a public package with the same name exists in the ${row.ecosystem} registry ` +
              `(version ${publicInfo.version ?? 'unknown'}). This is a potential dependency confusion attack vector.`,
          });
          continue;
        }

        // Internal package without public counterpart — medium risk
        findings.push({
          packageName: row.package_name,
          ecosystem: row.ecosystem,
          internalSource: source,
          publicExists: false,
          publicVersion: null,
          publicPublishedAt: null,
          riskLevel: 'medium',
          explanation:
            `Package "${row.package_name}" appears to be an internal dependency (${source}). ` +
            `No public package found with the same name, but this should be monitored.`,
        });
        continue;
      }

      // ── 2. Typosquatting detection (npm only for now) ─────────────────────
      if (row.ecosystem.toLowerCase() === 'npm') {
        const similar = isTyposquatCandidate(row.package_name, WELL_KNOWN_NPM);
        if (similar) {
          findings.push({
            packageName: row.package_name,
            ecosystem: row.ecosystem,
            internalSource: 'public registry',
            publicExists: true,
            publicVersion: null,
            publicPublishedAt: null,
            riskLevel: 'high',
            explanation:
              `Package "${row.package_name}" has a name very similar to the well-known package ` +
              `"${similar}" (Levenshtein distance ≤ 2). This may be a typosquatting attempt.`,
          });
        }
      }
    }

    return findings;
  }
}
