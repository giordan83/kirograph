/**
 * NPM / package.json manifest parser.
 * Handles JS/TS projects. Supports monorepos (workspaces).
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ManifestParser, ArchPackage } from '../types';

export const npmParser: ManifestParser = {
  name: 'npm',
  manifestFiles: ['package.json'],
  language: 'typescript',

  canParse(manifestPath: string): boolean {
    return path.basename(manifestPath) === 'package.json';
  },

  async parse(manifestPath: string, projectRoot: string): Promise<ArchPackage[]> {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      return [];
    }
    if (typeof raw !== 'object' || raw === null) return [];
    const pkg = raw as Record<string, unknown>;

    const name = typeof pkg.name === 'string' ? pkg.name : path.basename(path.dirname(manifestPath));
    const version = typeof pkg.version === 'string' ? pkg.version : undefined;
    const relDir = path.relative(projectRoot, path.dirname(manifestPath)).replace(/\\/g, '/') || '.';
    const relManifest = path.relative(projectRoot, manifestPath).replace(/\\/g, '/');

    const externalDeps = _collectDeps(pkg);

    const packages: ArchPackage[] = [{
      id: `pkg:npm:${relDir === '.' ? name : relDir}`,
      name,
      path: relDir,
      source: 'manifest',
      language: 'typescript',
      manifestPath: relManifest,
      version,
      externalDeps,
      updatedAt: Date.now(),
    }];

    // Handle workspaces — each workspace entry is its own package
    const workspaces = _getWorkspaces(pkg);
    for (const ws of workspaces) {
      const wsDir = path.join(path.dirname(manifestPath), ws);
      const wsPkg = path.join(wsDir, 'package.json');
      if (fs.existsSync(wsPkg)) {
        const sub = await this.parse(wsPkg, projectRoot);
        packages.push(...sub);
      }
    }

    return packages;
  },
};

function _collectDeps(pkg: Record<string, unknown>): string[] {
  const deps = new Set<string>();
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const d = pkg[field];
    if (typeof d === 'object' && d !== null) {
      for (const k of Object.keys(d as object)) deps.add(k);
    }
  }
  return [...deps];
}

function _getWorkspaces(pkg: Record<string, unknown>): string[] {
  const ws = pkg.workspaces;
  if (Array.isArray(ws)) return ws.filter((w): w is string => typeof w === 'string');
  if (typeof ws === 'object' && ws !== null) {
    const packages = (ws as Record<string, unknown>).packages;
    if (Array.isArray(packages)) return packages.filter((w): w is string => typeof w === 'string');
  }
  return [];
}
