/**
 * Maven Version Extraction Plugin for KiroGraph-Sec
 *
 * Extends the existing architecture maven parser to extract version constraints,
 * dependency scopes, and groupId/artifactId for security analysis.
 *
 * Reuses `mavenParser` from `src/architecture/manifest/maven.ts` for discovery and
 * basic parsing, then layers on version/scope extraction from pom.xml.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ParsedDependency } from '../../types';
import { logWarn } from '../../../errors';

/**
 * Maven scope to ParsedDependency scope mapping.
 *
 * - compile (default), runtime → production
 * - test → development
 * - provided, system → optional
 */
function mapMavenScope(mavenScope: string | undefined): ParsedDependency['scope'] {
  if (!mavenScope || mavenScope.trim() === '') {
    return 'production';
  }

  const normalized = mavenScope.trim().toLowerCase();
  switch (normalized) {
    case 'compile':
    case 'runtime':
      return 'production';
    case 'test':
      return 'development';
    case 'provided':
    case 'system':
      return 'optional';
    default:
      // Unknown scope defaults to production
      return 'production';
  }
}

/**
 * Extract text content from an XML element by tag name within a given XML fragment.
 * Returns undefined if the element is not found.
 */
function extractXmlElement(xml: string, tagName: string): string | undefined {
  const regex = new RegExp(`<${tagName}>([^<]*)</${tagName}>`);
  const match = xml.match(regex);
  return match ? match[1].trim() : undefined;
}

/**
 * Parse a Maven pom.xml manifest and extract dependency declarations
 * with groupId, artifactId, version constraints, and scopes.
 *
 * @param manifestPath - Absolute path to the pom.xml file
 * @param projectRoot - Absolute path to the project root directory
 * @returns Array of parsed dependencies with version and scope information
 */
export async function parseMavenManifest(
  manifestPath: string,
  projectRoot: string,
): Promise<ParsedDependency[]> {
  const relativeManifest = path.relative(projectRoot, manifestPath).replace(/\\/g, '/');

  // Read the pom.xml content
  let content: string;
  try {
    content = fs.readFileSync(manifestPath, 'utf8');
  } catch (err) {
    logWarn(`[sec:maven] Failed to read ${relativeManifest}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  // Validate basic XML structure
  if (!content.includes('<project')) {
    logWarn(`[sec:maven] Invalid pom.xml structure at ${relativeManifest} — missing <project> element`);
    return [];
  }

  // Extract all <dependency> blocks from the <dependencies> sections
  const dependencies: ParsedDependency[] = [];

  // Match all <dependency>...</dependency> blocks
  const dependencyBlocks = content.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g);

  for (const block of dependencyBlocks) {
    const depXml = block[1];

    const groupId = extractXmlElement(depXml, 'groupId');
    const artifactId = extractXmlElement(depXml, 'artifactId');
    const version = extractXmlElement(depXml, 'version');
    const scope = extractXmlElement(depXml, 'scope');

    // Validate required fields
    if (!groupId || groupId.trim() === '') {
      logWarn(`[sec:maven] Missing groupId in dependency at ${relativeManifest} — skipping`);
      continue;
    }

    if (!artifactId || artifactId.trim() === '') {
      logWarn(`[sec:maven] Missing artifactId in dependency at ${relativeManifest} — skipping`);
      continue;
    }

    // Skip dependencies with unresolved Maven properties (e.g. ${project.version})
    if (groupId.includes('${') || artifactId.includes('${')) {
      logWarn(`[sec:maven] Unresolved property in dependency ${groupId}:${artifactId} at ${relativeManifest} — skipping`);
      continue;
    }

    // Build the dependency name as groupId:artifactId (Maven convention)
    const name = `${groupId}:${artifactId}`;

    // Version constraint — may be absent (managed by parent POM or BOM)
    let declaredConstraint: string;
    if (version && version.trim() !== '' && !version.includes('${')) {
      declaredConstraint = version.trim();
    } else {
      // No version or unresolved property — use empty string to indicate managed externally
      declaredConstraint = version && !version.includes('${') ? version.trim() : '';
    }

    const mappedScope = mapMavenScope(scope);

    dependencies.push({
      name,
      declaredConstraint,
      resolvedVersion: declaredConstraint || undefined,
      scope: mappedScope,
      ecosystem: 'maven',
      sourceManifest: relativeManifest,
    });
  }

  return dependencies;
}
