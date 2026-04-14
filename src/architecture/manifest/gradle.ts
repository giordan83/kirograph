/**
 * Gradle build.gradle / build.gradle.kts manifest parser.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ManifestParser, ArchPackage } from '../types';

export const gradleParser: ManifestParser = {
  name: 'gradle',
  manifestFiles: ['build.gradle', 'build.gradle.kts'],
  language: 'java',

  canParse(manifestPath: string): boolean {
    const base = path.basename(manifestPath);
    return base === 'build.gradle' || base === 'build.gradle.kts';
  },

  async parse(manifestPath: string, projectRoot: string): Promise<ArchPackage[]> {
    let content: string;
    try {
      content = fs.readFileSync(manifestPath, 'utf8');
    } catch {
      return [];
    }

    // Try to detect group/artifact
    const groupMatch = content.match(/group\s*[=:]\s*['"]([^'"]+)['"]/);
    const versionMatch = content.match(/version\s*[=:]\s*['"]([^'"]+)['"]/);
    const dirName = path.basename(path.dirname(manifestPath));

    const name = groupMatch ? `${groupMatch[1]}:${dirName}` : dirName;
    const version = versionMatch ? versionMatch[1] : undefined;

    const externalDeps: string[] = [];
    // Match: implementation 'group:artifact:version' or implementation("group:artifact:version")
    for (const m of content.matchAll(/(?:implementation|api|compile|testImplementation)\s*[\('"]([^'"()]+)['")]/g)) {
      const parts = m[1].split(':');
      if (parts.length >= 2) externalDeps.push(`${parts[0]}:${parts[1]}`);
    }

    const relDir = path.relative(projectRoot, path.dirname(manifestPath)).replace(/\\/g, '/') || '.';
    const relManifest = path.relative(projectRoot, manifestPath).replace(/\\/g, '/');

    return [{
      id: `pkg:gradle:${relDir}`,
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
