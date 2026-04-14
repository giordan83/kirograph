/**
 * C# .csproj manifest parser.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ManifestParser, ArchPackage } from '../types';

export const csprojParser: ManifestParser = {
  name: 'csproj',
  manifestFiles: ['.csproj'],
  language: 'csharp',

  canParse(manifestPath: string): boolean {
    return manifestPath.endsWith('.csproj');
  },

  async parse(manifestPath: string, projectRoot: string): Promise<ArchPackage[]> {
    let content: string;
    try {
      content = fs.readFileSync(manifestPath, 'utf8');
    } catch {
      return [];
    }

    const name = path.basename(manifestPath, '.csproj');
    const version = content.match(/<Version>([^<]+)<\/Version>/)?.[1]
      ?? content.match(/<AssemblyVersion>([^<]+)<\/AssemblyVersion>/)?.[1];

    const externalDeps: string[] = [];
    for (const m of content.matchAll(/<PackageReference\s+Include="([^"]+)"/g)) {
      externalDeps.push(m[1]);
    }

    const relDir = path.relative(projectRoot, path.dirname(manifestPath)).replace(/\\/g, '/') || '.';
    const relManifest = path.relative(projectRoot, manifestPath).replace(/\\/g, '/');

    return [{
      id: `pkg:csproj:${relDir}`,
      name,
      path: relDir,
      source: 'manifest',
      language: 'csharp',
      manifestPath: relManifest,
      version,
      externalDeps,
      updatedAt: Date.now(),
    }];
  },
};
