/**
 * Sync Module — file discovery and change detection
 *
 * Extracted from KiroGraph class private methods in src/index.ts.
 * Provides scanDirectory, hashContent, shouldIncludeFile, and getChangedFiles.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import picomatch from 'picomatch';
import type { KiroGraphConfig } from '../config';
import { detectLanguage } from '../extraction/languages';

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Returns picomatch matchers for all exclude patterns plus .kirographignore root file lines.
 */
function buildExcludeMatchers(config: KiroGraphConfig): ((s: string) => boolean)[] {
  const patterns = [...config.exclude];

  return patterns.map(p => {
    try {
      return picomatch(p);
    } catch {
      return () => false;
    }
  });
}

/**
 * Returns a combined picomatch matcher or null if no include patterns.
 */
function buildIncludeMatcher(config: KiroGraphConfig): ((s: string) => boolean) | null {
  if (!config.include || config.include.length === 0) return null;
  const matchers = config.include.map(p => {
    try {
      return picomatch(p);
    } catch {
      return () => false;
    }
  });
  return (s: string) => matchers.some(m => m(s));
}

/**
 * Recursive filesystem walk. Checks .kirographignore, guards against symlink cycles,
 * respects AbortSignal, and filters files through shouldIncludeFile.
 */
function scanDirectoryWalk(
  root: string,
  config: KiroGraphConfig,
  signal?: AbortSignal,
  visited: Set<string> = new Set()
): string[] {
  const results: string[] = [];

  const walk = (dir: string) => {
    if (signal?.aborted) return;

    // Guard against symlink cycles
    let realDir: string;
    try { realDir = fs.realpathSync(dir); } catch { return; }
    if (visited.has(realDir)) return;
    visited.add(realDir);

    // Check for .kirographignore in this directory
    const ignoreFile = path.join(dir, '.kirographignore');
    if (fs.existsSync(ignoreFile)) return;

    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (signal?.aborted) return;

      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        if (shouldIncludeFile(rel, config)) {
          const lang = detectLanguage(full);
          if (lang !== 'unknown') results.push(full);
        }
      }
    }
  };

  walk(root);
  return results;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true when relPath passes the include/exclude filter from config.
 * Exclude patterns are checked first; include patterns (if any) are checked second.
 */
export function shouldIncludeFile(relPath: string, config: KiroGraphConfig): boolean {
  const excludeMatchers = buildExcludeMatchers(config);
  if (excludeMatchers.some(m => {
    try { return m(relPath) || m(relPath + '/'); } catch { return false; }
  })) return false;

  const includeMatcher = buildIncludeMatcher(config);
  if (includeMatcher && !includeMatcher(relPath)) return false;

  return true;
}

/**
 * SHA-256 hex digest of the given content.
 */
export function hashContent(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Returns absolute paths of all indexable files under root.
 * Uses git ls-files fast-path when available; falls back to filesystem walk.
 * Respects AbortSignal.
 */
export async function scanDirectory(
  root: string,
  config: KiroGraphConfig,
  signal?: AbortSignal
): Promise<string[]> {
  if (signal?.aborted) return [];

  // Try git fast-path
  try {
    const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    if (signal?.aborted) return [];

    const relPaths = output.split('\n').filter(Boolean);
    return relPaths
      .filter(rel => shouldIncludeFile(rel, config))
      .map(rel => path.join(root, rel))
      .filter(abs => detectLanguage(abs) !== 'unknown');
  } catch {
    // Fall through to filesystem walk
  }

  return scanDirectoryWalk(root, config, signal);
}

/**
 * Classifies git-changed files into added / modified / removed.
 * Returns absolute paths. Returns empty arrays if git is unavailable.
 * Excludes paths whose detected language is 'unknown'.
 */
export async function getChangedFiles(
  root: string,
  config: KiroGraphConfig
): Promise<{ added: string[]; modified: string[]; removed: string[] }> {
  const empty = { added: [] as string[], modified: [] as string[], removed: [] as string[] };

  try {
    const output = execFileSync('git', ['status', '--porcelain', '--no-renames'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const added: string[] = [];
    const modified: string[] = [];
    const removed: string[] = [];

    for (const line of output.split('\n').filter(Boolean)) {
      const statusCode = line.slice(0, 2);
      const relPath = line.slice(3).trim();
      const absPath = path.join(root, relPath);

      // Exclude unknown languages
      if (detectLanguage(absPath) === 'unknown') continue;

      if (statusCode === '??' ) {
        added.push(absPath);
      } else if (statusCode[0] === 'D' || statusCode[1] === 'D') {
        removed.push(absPath);
      } else {
        modified.push(absPath);
      }
    }

    return { added, modified, removed };
  } catch {
    return empty;
  }
}
