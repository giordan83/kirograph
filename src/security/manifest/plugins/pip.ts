/**
 * Pip Version Extraction Plugin for KiroGraph-Sec
 *
 * Extends the existing architecture python parser to extract version constraints
 * and resolved versions from requirements.txt files for security analysis.
 *
 * Reuses `pythonParser` from `src/architecture/manifest/python.ts` for discovery.
 * Parses requirements.txt line by line to extract package names and version constraints.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ParsedDependency } from '../../types';
import { logWarn } from '../../../errors';

/**
 * Lines starting with these prefixes are pip options, not package declarations.
 */
const PIP_OPTION_PREFIXES = ['-r', '-c', '-e', '--index-url', '--extra-index-url'];

/**
 * Regex to parse a pip requirement line.
 * Captures: package name, optional version constraint (operator + version).
 * Examples:
 *   flask==2.3.0       → name="flask", constraint="==2.3.0"
 *   requests>=2.28     → name="requests", constraint=">=2.28"
 *   django~=4.2        → name="django", constraint="~=4.2"
 *   numpy              → name="numpy", constraint=""
 *   package[extra]>=1  → name="package", constraint=">=1"
 */
const REQUIREMENT_REGEX = /^([a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?)(\[.*?\])?\s*(.*)/;

/**
 * Regex to match a version constraint operator at the start of a string.
 */
const VERSION_OPERATOR_REGEX = /^(~=|===|==|!=|>=|<=|>|<)/;

/**
 * Parse a pip requirements.txt manifest and extract dependency declarations
 * with version constraints.
 *
 * @param manifestPath - Absolute path to the requirements.txt file
 * @param projectRoot - Absolute path to the project root directory
 * @returns Array of parsed dependencies with version and scope information
 */
export async function parsePipManifest(
  manifestPath: string,
  projectRoot: string,
): Promise<ParsedDependency[]> {
  const relativeManifest = path.relative(projectRoot, manifestPath).replace(/\\/g, '/');

  // Read the requirements.txt file
  let content: string;
  try {
    content = fs.readFileSync(manifestPath, 'utf8');
  } catch (err) {
    logWarn(`[sec:pip] Failed to read ${relativeManifest}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  const dependencies: ParsedDependency[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    // Strip inline comments and trim whitespace
    const line = stripInlineComment(rawLine).trim();

    // Skip empty lines
    if (line === '') continue;

    // Skip comment lines
    if (line.startsWith('#')) continue;

    // Skip pip option lines
    if (isPipOption(line)) continue;

    // Strip environment markers (e.g. "; sys_platform == 'win32'")
    const withoutMarker = stripEnvironmentMarker(line);

    // Parse the requirement
    const parsed = parseRequirementLine(withoutMarker, i + 1, relativeManifest);
    if (parsed) {
      dependencies.push(parsed);
    }
  }

  return dependencies;
}

/**
 * Strip inline comments from a line.
 * Inline comments in requirements.txt start with # preceded by whitespace.
 */
function stripInlineComment(line: string): string {
  // Match # that is preceded by whitespace (not part of a URL or version)
  const commentIndex = line.search(/\s#/);
  if (commentIndex !== -1) {
    return line.slice(0, commentIndex);
  }
  return line;
}

/**
 * Check if a line is a pip option (not a package declaration).
 */
function isPipOption(line: string): boolean {
  for (const prefix of PIP_OPTION_PREFIXES) {
    if (line.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Strip environment markers from a requirement line.
 * Environment markers follow a semicolon, e.g.:
 *   pywin32; sys_platform == "win32"
 *   colorama>=0.4; os_name == "nt"
 */
function stripEnvironmentMarker(line: string): string {
  const semicolonIndex = line.indexOf(';');
  if (semicolonIndex !== -1) {
    return line.slice(0, semicolonIndex).trim();
  }
  return line;
}

/**
 * Parse a single requirement line into a ParsedDependency.
 * Returns null if the line cannot be parsed (logs a warning).
 */
function parseRequirementLine(
  line: string,
  lineNumber: number,
  relativeManifest: string,
): ParsedDependency | null {
  const match = line.match(REQUIREMENT_REGEX);
  if (!match) {
    logWarn(`[sec:pip] Could not parse line ${lineNumber} in ${relativeManifest}: "${line}"`);
    return null;
  }

  const name = match[1];
  const constraintPart = (match[4] ?? '').trim();

  // Validate that the constraint part, if present, starts with a valid operator
  let declaredConstraint = '';
  let resolvedVersion: string | undefined;

  if (constraintPart !== '') {
    if (!VERSION_OPERATOR_REGEX.test(constraintPart)) {
      logWarn(`[sec:pip] Invalid version constraint for "${name}" at line ${lineNumber} in ${relativeManifest}: "${constraintPart}"`);
      return null;
    }
    declaredConstraint = constraintPart;

    // If the constraint uses ==, the resolved version is the exact version
    const exactMatch = constraintPart.match(/^==\s*([^\s,]+)/);
    if (exactMatch) {
      resolvedVersion = exactMatch[1];
    }
  }

  return {
    name: normalizePackageName(name),
    declaredConstraint,
    resolvedVersion,
    scope: 'production', // requirements.txt doesn't distinguish scopes
    ecosystem: 'pypi',
    sourceManifest: relativeManifest,
  };
}

/**
 * Normalize a Python package name following PEP 503:
 * lowercase and replace any run of underscores, hyphens, or periods with a single hyphen.
 */
function normalizePackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}
