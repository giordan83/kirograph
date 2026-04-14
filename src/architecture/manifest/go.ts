/**
 * Go module (go.mod) manifest parser.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ManifestParser, ArchPackage } from '../types';

export const goParser: ManifestParser = {
  name: 'go',
  manifestFiles: ['go.mod'],
  language: 'go',

  canParse(manifestPath: string): boolean {
    return path.basename(manifestPath) === 'go.mod';
  },

  async parse(manifestPath: string, projectRoot: string): Promise<ArchPackage[]> {
    let content: string;
    try {
      content = fs.readFileSync(manifestPath, 'utf8');
    } catch {
      return [];
    }

    const moduleMatch = content.match(/^module\s+(\S+)/m);
    const name = moduleMatch ? moduleMatch[1] : path.basename(path.dirname(manifestPath));

    const goVersionMatch = content.match(/^go\s+(\S+)/m);
    const version = goVersionMatch ? goVersionMatch[1] : undefined;

    const externalDeps: string[] = [];
    const requireBlock = content.match(/require\s*\(([^)]+)\)/s);
    if (requireBlock) {
      for (const line of requireBlock[1].split('\n')) {
        const m = line.trim().match(/^(\S+)\s+/);
        if (m && !m[1].startsWith('//')) externalDeps.push(m[1]);
      }
    }
    // Single-line requires
    for (const line of content.split('\n')) {
      const m = line.trim().match(/^require\s+(\S+)\s+/);
      if (m) externalDeps.push(m[1]);
    }

    const relDir = path.relative(projectRoot, path.dirname(manifestPath)).replace(/\\/g, '/') || '.';
    const relManifest = path.relative(projectRoot, manifestPath).replace(/\\/g, '/');

    return [{
      id: `pkg:go:${relDir}`,
      name,
      path: relDir,
      source: 'manifest',
      language: 'go',
      manifestPath: relManifest,
      version,
      externalDeps: [...new Set(externalDeps)],
      updatedAt: Date.now(),
    }];
  },
};
