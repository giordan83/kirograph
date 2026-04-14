/**
 * Rust Cargo.toml manifest parser.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ManifestParser, ArchPackage } from '../types';

export const cargoParser: ManifestParser = {
  name: 'cargo',
  manifestFiles: ['Cargo.toml'],
  language: 'rust',

  canParse(manifestPath: string): boolean {
    return path.basename(manifestPath) === 'Cargo.toml';
  },

  async parse(manifestPath: string, projectRoot: string): Promise<ArchPackage[]> {
    let content: string;
    try {
      content = fs.readFileSync(manifestPath, 'utf8');
    } catch {
      return [];
    }

    const nameMatch = content.match(/^\[package\][^[]*name\s*=\s*"([^"]+)"/ms);
    const versionMatch = content.match(/^\[package\][^[]*version\s*=\s*"([^"]+)"/ms);
    const name = nameMatch ? nameMatch[1] : path.basename(path.dirname(manifestPath));
    const version = versionMatch ? versionMatch[1] : undefined;

    const externalDeps: string[] = [];
    const depsMatch = content.match(/^\[dependencies\]([\s\S]*?)(?=^\[|\Z)/m);
    if (depsMatch) {
      for (const line of depsMatch[1].split('\n')) {
        const m = line.trim().match(/^([a-zA-Z0-9_-]+)\s*=/);
        if (m) externalDeps.push(m[1]);
      }
    }

    const relDir = path.relative(projectRoot, path.dirname(manifestPath)).replace(/\\/g, '/') || '.';
    const relManifest = path.relative(projectRoot, manifestPath).replace(/\\/g, '/');

    const packages: ArchPackage[] = [{
      id: `pkg:cargo:${relDir}`,
      name,
      path: relDir,
      source: 'manifest',
      language: 'rust',
      manifestPath: relManifest,
      version,
      externalDeps,
      updatedAt: Date.now(),
    }];

    // Handle workspace members
    const workspaceMatch = content.match(/^\[workspace\][^[]*members\s*=\s*\[([^\]]+)\]/ms);
    if (workspaceMatch) {
      const members = workspaceMatch[1].match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, '')) ?? [];
      for (const member of members) {
        const memberDir = path.join(path.dirname(manifestPath), member);
        const memberCargo = path.join(memberDir, 'Cargo.toml');
        if (fs.existsSync(memberCargo)) {
          const sub = await this.parse(memberCargo, projectRoot);
          packages.push(...sub);
        }
      }
    }

    return packages;
  },
};
