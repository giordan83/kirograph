/**
 * Supply Chain Health Checker
 *
 * Queries OpenSSF Scorecard and registry APIs to assess the health of
 * dependencies: maintenance activity, maintainer count, package age, and
 * overall supply-chain risk level.
 */

import { logWarn } from '../errors';
import type { GraphDatabase } from '../db/database';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SupplyChainRisk {
  packageName: string;
  ecosystem: string;
  nodeId: string;
  // OpenSSF Scorecard
  scorecardScore: number | null;    // 0-10
  scorecardChecks: Record<string, number> | null;
  // Maintenance health
  daysSinceLastCommit: number | null;
  isAbandoned: boolean;   // no commit in > 365 days
  maintainerCount: number | null;
  isSingleMaintainer: boolean;
  // Package age
  publishedAt: string | null;
  isVeryNew: boolean;  // published < 30 days ago (supply chain risk)
  // Risk summary
  riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
  riskReasons: string[];
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

const TIMEOUT_MS = 10_000;

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', ...headers },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Registry repo-URL resolvers ───────────────────────────────────────────────

async function getGithubRepoFromNpm(name: string): Promise<string | null> {
  try {
    const encoded = encodeURIComponent(name);
    const data = await fetchJson(`https://registry.npmjs.org/${encoded}/latest`) as Record<string, unknown>;
    const repo = data['repository'] as Record<string, string> | string | undefined;
    const url = typeof repo === 'string' ? repo : repo?.url ?? null;
    return extractGithubPath(url);
  } catch {
    return null;
  }
}

async function getGithubRepoFromCargo(name: string): Promise<string | null> {
  try {
    const data = await fetchJson(
      `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`,
      { 'User-Agent': 'KiroGraph/1.0' },
    ) as Record<string, unknown>;
    const crate = data['crate'] as Record<string, unknown>;
    const repo = crate['repository'] as string | null | undefined;
    return extractGithubPath(repo ?? null);
  } catch {
    return null;
  }
}

async function getGithubRepoFromPypi(name: string): Promise<string | null> {
  try {
    const data = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`) as Record<string, unknown>;
    const info = data['info'] as Record<string, unknown>;
    const projectUrls = info['project_urls'] as Record<string, string> | null | undefined;
    const homePage = info['home_page'] as string | null | undefined;
    const sourceUrl = projectUrls?.['Source'] ?? projectUrls?.['source'] ?? projectUrls?.['Homepage'] ?? homePage ?? null;
    return extractGithubPath(sourceUrl);
  } catch {
    return null;
  }
}

function extractGithubPath(url: string | null | undefined): string | null {
  if (!url) return null;
  // normalise git+https://, git://, ssh://git@github.com, etc.
  const cleaned = url
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '');
  const m = cleaned.match(/github\.com[/:]([^/\s]+\/[^/\s#?]+)/);
  if (!m) return null;
  return m[1]!;
}

async function resolveGithubRepo(ecosystem: string, name: string): Promise<string | null> {
  const eco = ecosystem.toLowerCase();
  switch (eco) {
    case 'npm':    return getGithubRepoFromNpm(name);
    case 'cargo':  return getGithubRepoFromCargo(name);
    case 'pypi':
    case 'pip':    return getGithubRepoFromPypi(name);
    default:       return null;
  }
}

// ── OpenSSF Scorecard ─────────────────────────────────────────────────────────

interface ScorecardResult {
  score: number;
  checks: Record<string, number>;
}

async function fetchScorecard(githubRepo: string): Promise<ScorecardResult | null> {
  try {
    const data = await fetchJson(`https://api.securityscorecards.dev/projects/github.com/${githubRepo}`) as Record<string, unknown>;
    const score = data['score'] as number;
    const checksRaw = (data['checks'] as Array<Record<string, unknown>>) ?? [];
    const checks: Record<string, number> = {};
    for (const c of checksRaw) {
      const checkName = c['name'] as string;
      const checkScore = c['score'] as number;
      if (checkName) checks[checkName] = checkScore ?? 0;
    }
    return { score, checks };
  } catch {
    return null;
  }
}

// ── Maintenance data from registries ─────────────────────────────────────────

interface MaintenanceInfo {
  daysSinceLastCommit: number | null;
  maintainerCount: number | null;
  publishedAt: string | null;
}

async function getNpmMaintenance(name: string): Promise<MaintenanceInfo> {
  try {
    const encoded = encodeURIComponent(name);
    const full = await fetchJson(`https://registry.npmjs.org/${encoded}`) as Record<string, unknown>;
    const time = (full['time'] as Record<string, string>) ?? {};
    const maintainers = (full['maintainers'] as unknown[]) ?? [];
    const maintainerCount = maintainers.length;

    // Latest publish date
    const timeValues = Object.entries(time)
      .filter(([k]) => k !== 'created' && k !== 'modified')
      .map(([, v]) => new Date(v).getTime())
      .filter(t => !isNaN(t));
    const lastPublishMs = timeValues.length > 0 ? Math.max(...timeValues) : null;
    const daysSinceLastCommit = lastPublishMs !== null
      ? Math.floor((Date.now() - lastPublishMs) / (1000 * 60 * 60 * 24))
      : null;

    // Earliest publish date as "publishedAt"
    const createdStr = time['created'] ?? null;
    const publishedAt = createdStr || null;

    return { daysSinceLastCommit, maintainerCount: maintainerCount || null, publishedAt };
  } catch {
    return { daysSinceLastCommit: null, maintainerCount: null, publishedAt: null };
  }
}

async function getCratesMaintenance(name: string): Promise<MaintenanceInfo> {
  try {
    const data = await fetchJson(
      `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`,
      { 'User-Agent': 'KiroGraph/1.0' },
    ) as Record<string, unknown>;
    const crate = data['crate'] as Record<string, unknown>;
    const updatedAt = (crate['updated_at'] as string) ?? null;
    const createdAt = (crate['created_at'] as string) ?? null;

    const daysSinceLastCommit = updatedAt
      ? Math.floor((Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    return { daysSinceLastCommit, maintainerCount: null, publishedAt: createdAt };
  } catch {
    return { daysSinceLastCommit: null, maintainerCount: null, publishedAt: null };
  }
}

async function getPypiMaintenance(name: string): Promise<MaintenanceInfo> {
  try {
    const data = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`) as Record<string, unknown>;
    const info = data['info'] as Record<string, unknown>;
    const releases = (data['releases'] as Record<string, Array<Record<string, string>>>) ?? {};

    // Find the most recent release upload time across all versions
    let latestMs: number | null = null;
    let earliestMs: number | null = null;
    for (const files of Object.values(releases)) {
      for (const f of files) {
        const t = f['upload_time_iso_8601'] ?? f['upload_time'];
        if (t) {
          const ms = new Date(t).getTime();
          if (!isNaN(ms)) {
            latestMs = latestMs === null ? ms : Math.max(latestMs, ms);
            earliestMs = earliestMs === null ? ms : Math.min(earliestMs, ms);
          }
        }
      }
    }

    const daysSinceLastCommit = latestMs !== null
      ? Math.floor((Date.now() - latestMs) / (1000 * 60 * 60 * 24))
      : null;

    // PyPI doesn't expose maintainer counts in the public JSON
    const maintainerCount = null;
    const authorEmail = info['author_email'] as string | null | undefined;
    // Rough proxy: if the author_email field has multiple addresses → multiple maintainers
    const estimatedMaintainers = authorEmail
      ? authorEmail.split(',').filter(s => s.trim()).length
      : null;

    const publishedAt = earliestMs !== null ? new Date(earliestMs).toISOString() : null;

    return { daysSinceLastCommit, maintainerCount: estimatedMaintainers ?? maintainerCount, publishedAt };
  } catch {
    return { daysSinceLastCommit: null, maintainerCount: null, publishedAt: null };
  }
}

async function getMaintenance(ecosystem: string, name: string): Promise<MaintenanceInfo> {
  const eco = ecosystem.toLowerCase();
  switch (eco) {
    case 'npm':    return getNpmMaintenance(name);
    case 'cargo':  return getCratesMaintenance(name);
    case 'pypi':
    case 'pip':    return getPypiMaintenance(name);
    default:       return { daysSinceLastCommit: null, maintainerCount: null, publishedAt: null };
  }
}

// ── Risk scoring ──────────────────────────────────────────────────────────────

function computeRisk(
  scorecardScore: number | null,
  daysSinceLastCommit: number | null,
  maintainerCount: number | null,
  isVeryNew: boolean,
  hasActiveCVEs: boolean,
): { riskLevel: SupplyChainRisk['riskLevel']; riskReasons: string[] } {
  const reasons: string[] = [];

  const isAbandoned = daysSinceLastCommit !== null && daysSinceLastCommit > 365;
  const isSingleMaintainer = maintainerCount !== null && maintainerCount === 1;
  const lowScorecard = scorecardScore !== null && scorecardScore < 3;
  const mediumScorecard = scorecardScore !== null && scorecardScore >= 3 && scorecardScore <= 6;
  const noActivityRecent = daysSinceLastCommit !== null && daysSinceLastCommit > 180;

  if (isAbandoned) reasons.push(`Abandoned: no activity for ${daysSinceLastCommit} days`);
  if (isVeryNew) reasons.push('Very new package (< 30 days old): potential supply chain risk');
  if (isSingleMaintainer) reasons.push('Single maintainer: bus-factor risk');
  if (lowScorecard) reasons.push(`Low OpenSSF Scorecard score: ${scorecardScore!.toFixed(1)}/10`);
  if (mediumScorecard) reasons.push(`Moderate OpenSSF Scorecard score: ${scorecardScore!.toFixed(1)}/10`);
  if (noActivityRecent && !isAbandoned) reasons.push(`No activity in ${daysSinceLastCommit} days`);
  if (hasActiveCVEs) reasons.push('Has known CVEs');

  let riskLevel: SupplyChainRisk['riskLevel'];
  if (isAbandoned && hasActiveCVEs) {
    riskLevel = 'critical';
  } else if (isSingleMaintainer || lowScorecard || isVeryNew) {
    riskLevel = 'high';
  } else if (mediumScorecard || (noActivityRecent && !isAbandoned)) {
    riskLevel = 'medium';
  } else if (scorecardScore !== null && scorecardScore > 6) {
    riskLevel = 'low';
  } else {
    riskLevel = 'unknown';
  }

  return { riskLevel, riskReasons: reasons };
}

// ── SupplyChainChecker ────────────────────────────────────────────────────────

export class SupplyChainChecker {
  constructor(private readonly db: GraphDatabase) {}

  async checkAll(): Promise<{ results: SupplyChainRisk[]; errors: string[] }> {
    const rawDb = this.db.getRawDb();
    const rows: Array<{
      node_id: string;
      package_name: string;
      ecosystem: string;
    }> = rawDb.all(
      `SELECT node_id, package_name, ecosystem FROM sec_dependencies`,
    );

    const results: SupplyChainRisk[] = [];
    const errors: string[] = [];

    for (const row of rows) {
      try {
        const risk = await this._check(row.node_id, row.package_name, row.ecosystem);
        if (risk) results.push(risk);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logWarn(`[supply-chain] Failed to check ${row.package_name} (${row.ecosystem}): ${msg}`);
        errors.push(`${row.package_name} (${row.ecosystem}): ${msg}`);
      }
    }

    return { results, errors };
  }

  async checkOne(packageName: string, ecosystem: string): Promise<SupplyChainRisk | null> {
    const rawDb = this.db.getRawDb();
    const row: { node_id: string } | undefined = rawDb.get(
      `SELECT node_id FROM sec_dependencies WHERE package_name = ? AND ecosystem = ? LIMIT 1`,
      [packageName, ecosystem],
    );
    if (!row) return null;
    return this._check(row.node_id, packageName, ecosystem);
  }

  private async _check(
    nodeId: string,
    packageName: string,
    ecosystem: string,
  ): Promise<SupplyChainRisk | null> {
    // Resolve GitHub repo from registry metadata
    const githubRepo = await resolveGithubRepo(ecosystem, packageName);

    // Fetch Scorecard (only if we have a GitHub repo)
    let scorecardScore: number | null = null;
    let scorecardChecks: Record<string, number> | null = null;
    if (githubRepo) {
      const sc = await fetchScorecard(githubRepo);
      if (sc) {
        scorecardScore = sc.score;
        scorecardChecks = sc.checks;
      }
    }

    // Fetch maintenance info from registry
    const maintenance = await getMaintenance(ecosystem, packageName);
    const { daysSinceLastCommit, maintainerCount, publishedAt } = maintenance;

    const isAbandoned = daysSinceLastCommit !== null && daysSinceLastCommit > 365;
    const isSingleMaintainer = maintainerCount !== null && maintainerCount === 1;

    // Package age
    const publishedMs = publishedAt ? new Date(publishedAt).getTime() : null;
    const isVeryNew = publishedMs !== null && (Date.now() - publishedMs) < 30 * 24 * 60 * 60 * 1000;

    // Check if dep has known CVEs
    const rawDb = this.db.getRawDb();
    const cveCount: { count: number } = rawDb.get(
      `SELECT COUNT(*) as count FROM sec_vulnerabilities v
       JOIN edges e ON e.target = v.node_id AND e.kind = 'has_vulnerability'
       WHERE e.source = ?`,
      [nodeId],
    ) ?? { count: 0 };
    const hasActiveCVEs = cveCount.count > 0;

    const { riskLevel, riskReasons } = computeRisk(
      scorecardScore,
      daysSinceLastCommit,
      maintainerCount,
      isVeryNew,
      hasActiveCVEs,
    );

    return {
      packageName,
      ecosystem,
      nodeId,
      scorecardScore,
      scorecardChecks,
      daysSinceLastCommit,
      isAbandoned,
      maintainerCount,
      isSingleMaintainer,
      publishedAt,
      isVeryNew,
      riskLevel,
      riskReasons,
    };
  }
}
