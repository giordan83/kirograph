/**
 * Swift Package Manager Version Extraction Plugin for KiroGraph-Sec
 *
 * Parses Package.swift manifests to extract Swift package dependencies with
 * version constraints and resolved versions from Package.resolved.
 *
 * Prefers Package.resolved (more reliable) over regex parsing of Package.swift.
 * Handles both v1 and v2 Package.resolved formats.
 *
 * Package.resolved locations searched:
 * - Same directory as Package.swift
 * - `.build/` subdirectory relative to Package.swift
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ParsedDependency } from '../../types';
import { logWarn } from '../../../errors';

/**
 * Resolved version map: package identity → resolved version string.
 * Built from Package.resolved.
 */
type ResolvedVersionMap = Map<string, string>;

/**
 * A raw dependency entry extracted from Package.swift or Package.resolved.
 */
interface RawDependency {
  name: string;
  constraint: string;
  resolvedVersion?: string;
}

/**
 * Parse a Package.swift manifest and extract package dependencies with
 * version constraints and resolved versions from Package.resolved.
 *
 * @param manifestPath - Absolute path to the Package.swift file
 * @param projectRoot - Absolute path to the project root directory
 * @returns Array of parsed dependencies with version and scope information
 */
export async function parseSwiftManifest(
  manifestPath: string,
  projectRoot: string,
): Promise<ParsedDependency[]> {
  const manifestDir = path.dirname(manifestPath);
  const relativeManifest = path.relative(projectRoot, manifestPath).replace(/\\/g, '/');

  // Try to load Package.resolved first — it's more reliable than parsing Package.swift
  const resolved = loadPackageResolved(manifestDir);
  if (resolved.size > 0 || hasPackageResolved(manifestDir)) {
    // We have a lock file — use its entries as the authoritative dependency list
    return buildFromResolved(resolved, relativeManifest);
  }

  // Fallback: parse Package.swift directly
  let content: string;
  try {
    content = fs.readFileSync(manifestPath, 'utf8');
  } catch (err) {
    logWarn(`[sec:swift] Failed to read ${relativeManifest}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  const rawDeps = extractFromPackageSwift(content, relativeManifest);
  return rawDeps.map((dep) => ({
    name: dep.name,
    declaredConstraint: dep.constraint,
    resolvedVersion: dep.resolvedVersion,
    scope: 'production' as const,
    ecosystem: 'swift',
    sourceManifest: relativeManifest,
  }));
}

/**
 * Build ParsedDependency entries from a resolved version map.
 * All Swift dependencies are production scope (SPM has no dev deps concept).
 */
function buildFromResolved(
  resolved: ResolvedVersionMap,
  relativeManifest: string,
): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  for (const [name, version] of resolved) {
    deps.push({
      name,
      declaredConstraint: version,
      resolvedVersion: version,
      scope: 'production',
      ecosystem: 'swift',
      sourceManifest: relativeManifest,
    });
  }
  return deps;
}

/**
 * Extract dependencies from Package.swift using regex patterns.
 *
 * Handles:
 * - `.package(url: "...", from: "1.0.0")`
 * - `.package(url: "...", exact: "1.0.0")`
 * - `.package(url: "...", .upToNextMajor(from: "1.0.0"))`
 * - `.package(url: "...", .upToNextMinor(from: "1.0.0"))`
 */
function extractFromPackageSwift(content: string, relativeManifest: string): RawDependency[] {
  const deps: RawDependency[] = [];

  // Match .package(url: "...", <version spec>) — possibly spanning multiple lines
  // We capture the url argument and the version specifier
  const packagePattern = /\.package\s*\(\s*url\s*:\s*"([^"]+)"[^)]+\)/gs;
  let match: RegExpExecArray | null;

  while ((match = packagePattern.exec(content)) !== null) {
    const url = match[1];
    const fullMatch = match[0];

    const name = packageNameFromUrl(url);
    if (!name) {
      logWarn(`[sec:swift] Could not derive package name from URL "${url}" in ${relativeManifest} — skipping`);
      continue;
    }

    const constraint = extractVersionConstraint(fullMatch, relativeManifest);
    deps.push({ name, constraint });
  }

  return deps;
}

/**
 * Extract a version constraint string from a .package(...) call.
 * Returns '*' if no recognised version spec is found.
 */
function extractVersionConstraint(packageCall: string, relativeManifest: string): string {
  // from: "1.0.0"
  const fromMatch = packageCall.match(/\bfrom\s*:\s*"([^"]+)"/);
  if (fromMatch) return `from: ${fromMatch[1]}`;

  // exact: "1.0.0"
  const exactMatch = packageCall.match(/\bexact\s*:\s*"([^"]+)"/);
  if (exactMatch) return `exact: ${exactMatch[1]}`;

  // .upToNextMajor(from: "1.0.0")
  const upToMajorMatch = packageCall.match(/\.upToNextMajor\s*\(\s*from\s*:\s*"([^"]+)"\s*\)/);
  if (upToMajorMatch) return `upToNextMajor: ${upToMajorMatch[1]}`;

  // .upToNextMinor(from: "1.0.0")
  const upToMinorMatch = packageCall.match(/\.upToNextMinor\s*\(\s*from\s*:\s*"([^"]+)"\s*\)/);
  if (upToMinorMatch) return `upToNextMinor: ${upToMinorMatch[1]}`;

  // Range: "1.0.0"..<"2.0.0"
  const rangeMatch = packageCall.match(/"([^"]+)"\s*\.{2,3}<\s*"([^"]+)"/);
  if (rangeMatch) return `${rangeMatch[1]} ..< ${rangeMatch[2]}`;

  logWarn(`[sec:swift] Unrecognised version specifier in Package.swift at ${relativeManifest} — using '*'`);
  return '*';
}

/**
 * Derive a package name from a Swift package URL.
 * Extracts the last path component and strips a `.git` suffix.
 *
 * e.g., `https://github.com/apple/swift-argument-parser.git` → `swift-argument-parser`
 */
function packageNameFromUrl(url: string): string | null {
  try {
    // Remove trailing slash
    const cleaned = url.replace(/\/+$/, '');
    const segments = cleaned.split('/');
    const last = segments[segments.length - 1];
    if (!last) return null;
    // Strip .git suffix
    return last.replace(/\.git$/i, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Check whether Package.resolved exists in the expected locations.
 */
function hasPackageResolved(manifestDir: string): boolean {
  return (
    fs.existsSync(path.join(manifestDir, 'Package.resolved')) ||
    fs.existsSync(path.join(manifestDir, '.build', 'Package.resolved'))
  );
}

/**
 * Attempt to load resolved versions from Package.resolved.
 * Searches the manifest directory and `.build/` subdirectory.
 * Returns an empty map if Package.resolved is not available.
 *
 * Supports both v1 and v2 Package.resolved formats.
 */
function loadPackageResolved(manifestDir: string): ResolvedVersionMap {
  const map: ResolvedVersionMap = new Map();

  const candidates = [
    path.join(manifestDir, 'Package.resolved'),
    path.join(manifestDir, '.build', 'Package.resolved'),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;

    try {
      const lockContent = fs.readFileSync(candidate, 'utf8');
      extractFromPackageResolved(lockContent, map, candidate);
      return map; // Use first found
    } catch (err) {
      logWarn(`[sec:swift] Failed to parse ${candidate}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return map;
}

/**
 * Extract resolved versions from Package.resolved content.
 *
 * v2 format:
 * ```json
 * { "pins": [{ "identity": "name", "kind": "remoteSourceControl",
 *              "location": "url", "state": { "version": "1.2.3" } }] }
 * ```
 *
 * v1 format:
 * ```json
 * { "object": { "pins": [{ "package": "Name", "repositoryURL": "url",
 *                          "state": { "version": "1.2.3" } }] } }
 * ```
 */
function extractFromPackageResolved(
  content: string,
  map: ResolvedVersionMap,
  filePath: string,
): void {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(content) as Record<string, unknown>;
  } catch {
    logWarn(`[sec:swift] ${filePath} is not valid JSON — resolved versions unavailable`);
    return;
  }

  // Determine format version and locate pins array
  let pins: unknown[] | null = null;

  // v2: top-level `pins` array
  if (Array.isArray(data['pins'])) {
    pins = data['pins'] as unknown[];
    extractPinsV2(pins, map);
    return;
  }

  // v1: `object.pins` array
  const obj = data['object'];
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const objRecord = obj as Record<string, unknown>;
    if (Array.isArray(objRecord['pins'])) {
      pins = objRecord['pins'] as unknown[];
      extractPinsV1(pins, map);
      return;
    }
  }

  logWarn(`[sec:swift] ${filePath} has unrecognised Package.resolved format — resolved versions unavailable`);
}

/**
 * Extract pins from Package.resolved v2 format.
 * Each pin has: `{ identity, kind, location, state: { version } }`
 */
function extractPinsV2(pins: unknown[], map: ResolvedVersionMap): void {
  for (const pin of pins) {
    if (!pin || typeof pin !== 'object') continue;
    const p = pin as Record<string, unknown>;
    const identity = typeof p['identity'] === 'string' ? p['identity'].toLowerCase() : null;
    const state = p['state'];
    const version =
      state && typeof state === 'object' && !Array.isArray(state)
        ? (state as Record<string, unknown>)['version']
        : null;
    if (identity && typeof version === 'string' && version) {
      if (!map.has(identity)) {
        map.set(identity, version);
      }
    }
  }
}

/**
 * Extract pins from Package.resolved v1 format.
 * Each pin has: `{ package, repositoryURL, state: { version } }`
 */
function extractPinsV1(pins: unknown[], map: ResolvedVersionMap): void {
  for (const pin of pins) {
    if (!pin || typeof pin !== 'object') continue;
    const p = pin as Record<string, unknown>;
    // v1 uses `package` or derives name from `repositoryURL`
    let name: string | null = null;
    if (typeof p['package'] === 'string' && p['package']) {
      name = p['package'].toLowerCase();
    } else if (typeof p['repositoryURL'] === 'string') {
      name = packageNameFromUrl(p['repositoryURL']);
    }
    const state = p['state'];
    const version =
      state && typeof state === 'object' && !Array.isArray(state)
        ? (state as Record<string, unknown>)['version']
        : null;
    if (name && typeof version === 'string' && version) {
      if (!map.has(name)) {
        map.set(name, version);
      }
    }
  }
}
