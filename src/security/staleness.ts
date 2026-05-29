/**
 * Dependency Staleness Checker
 *
 * Queries public package registries (npm, PyPI, crates.io, RubyGems, Packagist)
 * to determine the latest published version and compute a staleness score for
 * each dependency tracked in sec_dependencies.
 *
 * Score formula:
 *   score = min(majorVersionsBehind * 0.2, 0.6)   // up to 0.6 for version lag
 *         + min(monthsSinceLatest / 36, 0.4)        // up to 0.4 for time lag
 *   score = min(score, 1.0)
 */

import { compareVersions } from './manifest/parser';
import { logWarn, logError } from '../errors';
import type { GraphDatabase } from '../db/database';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StalenessResult {
  packageName: string;
  ecosystem: string;
  resolvedVersion: string;
  latestVersion: string;
  latestPublished: number;  // epoch ms
  stalenessScore: number;   // 0.0–1.0
  majorVersionsBehind: number;
  monthsSinceLatest: number;
}

// ── Registry fetch helpers ────────────────────────────────────────────────────

const TIMEOUT_MS = 10_000;

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        ...headers,
      },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

interface RegistryResult {
  latestVersion: string;
  latestPublished: number; // epoch ms
}

async function fetchNpm(name: string): Promise<RegistryResult> {
  // Scoped packages: @scope/name — must be URL-encoded as %40scope%2Fname
  const encoded = encodeURIComponent(name);
  const data = await fetchJson(`https://registry.npmjs.org/${encoded}/latest`) as Record<string, unknown>;
  const version = data['version'] as string;
  // Fetch full metadata for publish time
  const full = await fetchJson(`https://registry.npmjs.org/${encoded}`) as Record<string, unknown>;
  const time = (full['time'] as Record<string, string>) ?? {};
  const publishedStr = time[version] ?? (full['time'] as Record<string, string>)?.['modified'] ?? '';
  const latestPublished = publishedStr ? new Date(publishedStr).getTime() : Date.now();
  return { latestVersion: version, latestPublished };
}

async function fetchPypi(name: string): Promise<RegistryResult> {
  const data = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`) as Record<string, unknown>;
  const info = data['info'] as Record<string, unknown>;
  const version = info['version'] as string;
  const releases = (data['releases'] as Record<string, Array<Record<string, string>>>) ?? {};
  const files = releases[version] ?? [];
  const uploadTime = files[0]?.['upload_time_iso_8601'] ?? '';
  const latestPublished = uploadTime ? new Date(uploadTime).getTime() : Date.now();
  return { latestVersion: version, latestPublished };
}

async function fetchCrates(name: string): Promise<RegistryResult> {
  const data = await fetchJson(
    `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`,
    { 'User-Agent': 'KiroGraph/1.0' },
  ) as Record<string, unknown>;
  const crate = data['crate'] as Record<string, unknown>;
  const version = crate['newest_version'] as string;
  const updatedAt = (crate['updated_at'] as string) ?? '';
  const latestPublished = updatedAt ? new Date(updatedAt).getTime() : Date.now();
  return { latestVersion: version, latestPublished };
}

async function fetchRubygems(name: string): Promise<RegistryResult> {
  const data = await fetchJson(`https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`) as Record<string, unknown>;
  const version = data['version'] as string;
  const createdAt = (data['version_created_at'] as string) ?? '';
  const latestPublished = createdAt ? new Date(createdAt).getTime() : Date.now();
  return { latestVersion: version, latestPublished };
}

async function fetchPackagist(name: string): Promise<RegistryResult> {
  // name is expected to be "vendor/package"
  const parts = name.split('/');
  if (parts.length !== 2) throw new Error(`Invalid Composer package name: ${name}`);
  const [vendor, pkg] = parts;
  const data = await fetchJson(`https://repo.packagist.org/p2/${encodeURIComponent(vendor!)}/${encodeURIComponent(pkg!)}.json`) as Record<string, unknown>;
  const packages = (data['packages'] as Record<string, unknown[]>) ?? {};
  const versions = (packages[name] ?? []) as Array<Record<string, unknown>>;
  if (versions.length === 0) throw new Error(`No versions found for ${name}`);

  // Find highest non-dev version
  let latestVersion = '';
  let latestPublished = 0;
  for (const v of versions) {
    const versionStr = (v['version'] as string) ?? '';
    if (versionStr.startsWith('dev-') || versionStr === 'dev-master') continue;
    if (!latestVersion || compareVersions(versionStr, latestVersion) > 0) {
      latestVersion = versionStr;
      const timeStr = (v['time'] as string) ?? '';
      latestPublished = timeStr ? new Date(timeStr).getTime() : 0;
    }
  }
  if (!latestVersion) throw new Error(`No stable versions found for ${name}`);
  return { latestVersion, latestPublished: latestPublished || Date.now() };
}

// ── Ecosystem dispatch ────────────────────────────────────────────────────────

async function fetchLatest(ecosystem: string, packageName: string): Promise<RegistryResult | null> {
  const eco = ecosystem.toLowerCase();
  try {
    switch (eco) {
      case 'npm':       return await fetchNpm(packageName);
      case 'pypi':      return await fetchPypi(packageName);
      case 'pip':       return await fetchPypi(packageName); // alias
      case 'cargo':     return await fetchCrates(packageName);
      case 'rubygems':  return await fetchRubygems(packageName);
      case 'composer':  return await fetchPackagist(packageName);
      default:
        // Maven, Go, NuGet, Swift, Pub, Hex, Gradle — skip
        return null;
    }
  } catch (err) {
    throw err; // let caller handle
  }
}

// ── Score calculation ─────────────────────────────────────────────────────────

function getMajorVersion(version: string): number {
  const clean = version.startsWith('v') ? version.slice(1) : version;
  const stripped = clean.replace(/^[~^>=<]+/, '');
  const major = parseInt(stripped.split('.')[0] ?? '0', 10);
  return isNaN(major) ? 0 : major;
}

function computeStaleness(
  resolvedVersion: string,
  latestVersion: string,
  latestPublished: number,
): { score: number; majorVersionsBehind: number; monthsSinceLatest: number } {
  const resolvedMajor = getMajorVersion(resolvedVersion);
  const latestMajor = getMajorVersion(latestVersion);
  const majorVersionsBehind = Math.max(0, latestMajor - resolvedMajor);

  const monthsSinceLatest = Math.max(0, (Date.now() - latestPublished) / (1000 * 60 * 60 * 24 * 30));

  const versionScore = Math.min(majorVersionsBehind * 0.2, 0.6);
  const timeScore = Math.min(monthsSinceLatest / 36, 0.4);
  const score = Math.min(versionScore + timeScore, 1.0);

  return { score, majorVersionsBehind, monthsSinceLatest: Math.round(monthsSinceLatest) };
}

// ── StalenessChecker ─────────────────────────────────────────────────────────

export class StalenessChecker {
  constructor(private readonly db: GraphDatabase) {}

  /**
   * Check all dependencies in sec_dependencies that have a supported ecosystem.
   * Returns a summary of checked/stale counts and any errors encountered.
   */
  async checkAll(): Promise<{ checked: number; stale: number; errors: string[] }> {
    const rawDb = this.db.getRawDb();
    const rows: Array<{
      node_id: string;
      package_name: string;
      ecosystem: string;
      resolved_version: string | null;
      declared_constraint: string;
    }> = rawDb.all(
      `SELECT node_id, package_name, ecosystem, resolved_version, declared_constraint
       FROM sec_dependencies`,
    );

    let checked = 0;
    let stale = 0;
    const errors: string[] = [];

    for (const row of rows) {
      const result = await this._checkRow(row);
      if (result === null) continue; // unsupported ecosystem — skip
      if (result instanceof Error) {
        errors.push(`${row.package_name} (${row.ecosystem}): ${result.message}`);
        continue;
      }
      checked++;
      if (result.stalenessScore >= 0.3) stale++;
    }

    return { checked, stale, errors };
  }

  /**
   * Check a single dependency by node_id. Returns null if the ecosystem is
   * not supported or the dependency is not found.
   */
  async checkOne(nodeId: string): Promise<StalenessResult | null> {
    const rawDb = this.db.getRawDb();
    const row: {
      node_id: string;
      package_name: string;
      ecosystem: string;
      resolved_version: string | null;
      declared_constraint: string;
    } | undefined = rawDb.get(
      `SELECT node_id, package_name, ecosystem, resolved_version, declared_constraint
       FROM sec_dependencies WHERE node_id = ?`,
      [nodeId],
    );

    if (!row) return null;

    const result = await this._checkRow(row);
    if (result === null || result instanceof Error) return null;
    return result;
  }

  private async _checkRow(row: {
    node_id: string;
    package_name: string;
    ecosystem: string;
    resolved_version: string | null;
    declared_constraint: string;
  }): Promise<StalenessResult | Error | null> {
    const resolvedVersion = row.resolved_version ?? row.declared_constraint;

    let registryResult: RegistryResult | null;
    try {
      registryResult = await fetchLatest(row.ecosystem, row.package_name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logWarn(`[staleness] Failed to fetch ${row.package_name} (${row.ecosystem}): ${msg}`);
      return new Error(msg);
    }

    if (registryResult === null) {
      // Unsupported ecosystem — skip silently
      return null;
    }

    const { latestVersion, latestPublished } = registryResult;
    const { score, majorVersionsBehind, monthsSinceLatest } = computeStaleness(
      resolvedVersion,
      latestVersion,
      latestPublished,
    );

    // Persist to sec_dependencies
    const rawDb = this.db.getRawDb();
    rawDb.run(
      `UPDATE sec_dependencies
       SET latest_version = ?, latest_published = ?, staleness_score = ?
       WHERE node_id = ?`,
      [latestVersion, latestPublished, score, row.node_id],
    );

    return {
      packageName: row.package_name,
      ecosystem: row.ecosystem,
      resolvedVersion,
      latestVersion,
      latestPublished,
      stalenessScore: score,
      majorVersionsBehind,
      monthsSinceLatest,
    };
  }
}
