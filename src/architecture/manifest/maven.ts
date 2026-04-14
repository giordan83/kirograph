/**
 * Maven pom.xml manifest parser.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ManifestParser, ArchPackage } from '../types';

export const mavenParser: ManifestParser = {
  name: 'maven',
  manifestFiles: ['pom.xml'],
  language: 'java',

  canParse(manifestPath: string): boolean {
    return path.basename(manifestPath) === 'pom.xml';
  },

  async parse(manifestPath: string, projectRoot: string): Promise<ArchPackage[]> {
    let content: string;
    try {
      content = fs.readFileSync(manifestPath, 'utf8');
    } catch {
      return [];
    }

    const artifactId = content.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1];
    const version = content.match(/<version>([^<]+)<\/version>/)?.[1];
    const name = content.match(/<name>([^<]+)<\/name>/)?.[1] ?? artifactId ?? path.basename(path.dirname(manifestPath));

    const externalDeps: string[] = [];
    for (const m of content.matchAll(/<dependency>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?<\/dependency>/g)) {
      externalDeps.push(m[1]);
    }

    const relDir = path.relative(projectRoot, path.dirname(manifestPath)).replace(/\\/g, '/') || '.';
    const relManifest = path.relative(projectRoot, manifestPath).replace(/\\/g, '/');

    return [{
      id: `pkg:maven:${relDir}`,
      name,
      path: relDir,
      source: 'manifest',
      language: 'java',
      manifestPath: relManifest,
      version,
      externalDeps,
      updatedAt: Date.now(),
    }];
  },
};
