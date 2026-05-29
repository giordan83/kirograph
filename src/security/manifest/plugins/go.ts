/**
 * Go Version Extraction Plugin for KiroGraph-Sec
 *
 * Extends the existing architecture go parser to extract version constraints
 * and resolved versions from go.mod and go.sum for security analysis.
 *
 * Reuses `goParser` from `src/architecture/manifest/go.ts` for discovery and
 * basic parsing, then layers on version extraction.
 *
 * In Go modules, the version in go.mod IS the resolved version (go.mod is
 * effectively a lock file). go.sum provides integrity hashes but the version
 * source of truth is go.mod itself. All Go dependencies are scope "production"
 * since Go doesn't have dev dependencies in go.mod.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ParsedDependency } from '../../types';
import { logWarn } from '../../../errors';

/**
 * Parse a go.mod manifest and extract dependency declarations with version
 * information. In Go modules, the version declared in go.mod is the resolved
 * version (pinned), so declaredConstraint and resolvedVersion are the same.
 *
 * @param manifestPath - Absolute path to the go.mod file
 * @param projectRoot - Absolute path to the project root directory
 * @returns Array of parsed dependencies with version information
 */
export async function parseGoManifest(
  manifestPath: string,
  projectRoot: string,
): Promise<ParsedDependency[]> {
  const manifestDir = path.dirname(manifestPath);
  const relativeManifest = path.relative(projectRoot, manifestPath).replace(/\\/g, '/');

  // Read go.mod content
  let content: string;
  try {
    content = fs.readFileSync(manifestPath, 'utf8');
  } catch (err) {
    logWarn(`[sec:go] Failed to read ${relativeManifest}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  // Load go.sum for integrity verification (optional)
  const goSumHashes = loadGoSumHashes(manifestDir);

  // Extract dependencies from require directives
  const dependencies: ParsedDependency[] = [];

  // Parse require block: require ( ... )
  const requireBlockRegex = /require\s*\(([^)]*)\)/gs;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = requireBlockRegex.exec(content)) !== null) {
    const blockContent = blockMatch[1];
    parseRequireLines(blockContent, relativeManifest, goSumHashes, dependencies);
  }

  // Parse single-line require directives: require module/path v1.2.3
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip lines inside require blocks (already handled above)
    // Match: require <module> <version>
    const singleRequireMatch = trimmed.match(/^require\s+(\S+)\s+(\S+)/);
    if (singleRequireMatch) {
      const modulePath = singleRequireMatch[1];
      const version = singleRequireMatch[2];
      addDependency(modulePath, version, relativeManifest, goSumHashes, dependencies);
    }
  }

  return dependencies;
}

/**
 * Parse lines within a require block and extract module paths and versions.
 */
function parseRequireLines(
  blockContent: string,
  relativeManifest: string,
  goSumHashes: GoSumMap,
  dependencies: ParsedDependency[],
): void {
  const lines = blockContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('//')) continue;

    // Match: module/path v1.2.3 [// indirect]
    const match = trimmed.match(/^(\S+)\s+(\S+)/);
    if (match) {
      const modulePath = match[1];
      const version = match[2];

      // Skip if the "module path" is actually a comment
      if (modulePath.startsWith('//')) continue;

      addDependency(modulePath, version, relativeManifest, goSumHashes, dependencies);
    }
  }
}

/**
 * Add a single dependency entry after validation.
 */
function addDependency(
  modulePath: string,
  version: string,
  relativeManifest: string,
  goSumHashes: GoSumMap,
  dependencies: ParsedDependency[],
): void {
  // Validate module path
  if (!isValidGoModulePath(modulePath)) {
    logWarn(`[sec:go] Invalid module path "${modulePath}" in ${relativeManifest} — skipping`);
    return;
  }

  // Validate version format (should start with 'v' for Go modules)
  if (!isValidGoVersion(version)) {
    logWarn(`[sec:go] Invalid version "${version}" for module "${modulePath}" in ${relativeManifest} — skipping`);
    return;
  }

  // Check if this module+version has integrity info in go.sum
  const hasIntegrity = goSumHashes.has(`${modulePath}@${version}`);

  // In Go, the version in go.mod is the resolved version
  // declaredConstraint and resolvedVersion are the same
  dependencies.push({
    name: modulePath,
    declaredConstraint: version,
    resolvedVersion: version,
    scope: 'production', // Go doesn't have dev dependencies in go.mod
    ecosystem: 'go',
    sourceManifest: relativeManifest,
  });
}

/**
 * Map of module@version → true, indicating presence in go.sum.
 * Used for integrity verification awareness.
 */
type GoSumMap = Map<string, boolean>;

/**
 * Load go.sum hashes from the same directory as go.mod.
 * go.sum contains lines like:
 *   module/path v1.2.3 h1:hash...
 *   module/path v1.2.3/go.mod h1:hash...
 */
function loadGoSumHashes(manifestDir: string): GoSumMap {
  const map: GoSumMap = new Map();
  const goSumPath = path.join(manifestDir, 'go.sum');

  if (!fs.existsSync(goSumPath)) {
    return map;
  }

  try {
    const content = fs.readFileSync(goSumPath, 'utf8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Format: module/path version hash
      // e.g.: github.com/gin-gonic/gin v1.9.1 h1:4idEAncQnU5cB7BeOkPtxjfCSye0AAm1R0RVIqFPSKw=
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 3) {
        const modulePath = parts[0];
        let version = parts[1];
        // Strip /go.mod suffix from version if present
        version = version.replace(/\/go\.mod$/, '');
        map.set(`${modulePath}@${version}`, true);
      }
    }
  } catch (err) {
    logWarn(`[sec:go] Failed to read go.sum: ${err instanceof Error ? err.message : String(err)}`);
  }

  return map;
}

/**
 * Validate a Go module path.
 * A valid module path must contain at least one dot in the first path element
 * (domain requirement) and consist of valid characters.
 */
function isValidGoModulePath(modulePath: string): boolean {
  if (!modulePath || typeof modulePath !== 'string') return false;

  // Must not be empty or contain spaces
  if (modulePath.includes(' ') || modulePath.includes('\t')) return false;

  // First path element must contain a dot (domain name requirement)
  const firstSlash = modulePath.indexOf('/');
  const firstElement = firstSlash === -1 ? modulePath : modulePath.slice(0, firstSlash);
  if (!firstElement.includes('.')) return false;

  return true;
}

/**
 * Validate a Go module version string.
 * Valid formats: v1.2.3, v0.0.0-timestamp-hash, v1.2.3-pre, v1.2.3+incompatible
 */
function isValidGoVersion(version: string): boolean {
  if (!version || typeof version !== 'string') return false;

  // Must start with 'v'
  if (!version.startsWith('v')) return false;

  // Basic semver-like check after 'v': at minimum "vX.Y.Z" or pseudo-version
  const versionBody = version.slice(1);
  if (!versionBody) return false;

  // Allow semver, pseudo-versions, and +incompatible suffix
  // Pseudo-version format: v0.0.0-20230101120000-abcdef123456
  const semverPattern = /^\d+\.\d+\.\d+/;
  return semverPattern.test(versionBody);
}
