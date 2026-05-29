/**
 * Unit tests for the npm security manifest plugin.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseNpmManifest } from './npm';

describe('parseNpmManifest', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kirograph-npm-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writePackageJson(content: Record<string, unknown>, dir?: string): string {
    const targetDir = dir ?? tmpDir;
    const filePath = path.join(targetDir, 'package.json');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
    return filePath;
  }

  it('extracts production dependencies with correct scope', async () => {
    const manifestPath = writePackageJson({
      name: 'test-project',
      version: '1.0.0',
      dependencies: {
        express: '^4.18.2',
        lodash: '~4.17.21',
      },
    });

    const deps = await parseNpmManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(2);
    const express = deps.find(d => d.name === 'express');
    expect(express).toBeDefined();
    expect(express!.declaredConstraint).toBe('^4.18.2');
    expect(express!.scope).toBe('production');
    expect(express!.ecosystem).toBe('npm');

    const lodash = deps.find(d => d.name === 'lodash');
    expect(lodash).toBeDefined();
    expect(lodash!.declaredConstraint).toBe('~4.17.21');
    expect(lodash!.scope).toBe('production');
  });

  it('extracts devDependencies with development scope', async () => {
    const manifestPath = writePackageJson({
      name: 'test-project',
      devDependencies: {
        vitest: '^1.0.0',
        typescript: '^5.0.0',
      },
    });

    const deps = await parseNpmManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(2);
    expect(deps.every(d => d.scope === 'development')).toBe(true);
  });

  it('extracts optionalDependencies with optional scope', async () => {
    const manifestPath = writePackageJson({
      name: 'test-project',
      optionalDependencies: {
        'better-sqlite3': '^11.0.0',
      },
    });

    const deps = await parseNpmManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].scope).toBe('optional');
    expect(deps[0].name).toBe('better-sqlite3');
  });

  it('handles all scope fields together', async () => {
    const manifestPath = writePackageJson({
      name: 'test-project',
      dependencies: { express: '^4.18.0' },
      devDependencies: { vitest: '^1.0.0' },
      optionalDependencies: { sqlite3: '^5.0.0' },
    });

    const deps = await parseNpmManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(3);
    expect(deps.find(d => d.name === 'express')!.scope).toBe('production');
    expect(deps.find(d => d.name === 'vitest')!.scope).toBe('development');
    expect(deps.find(d => d.name === 'sqlite3')!.scope).toBe('optional');
  });

  it('resolves versions from package-lock.json (v2/v3 format)', async () => {
    writePackageJson({
      name: 'test-project',
      dependencies: { express: '^4.18.0' },
    });

    // Write a package-lock.json with resolved versions
    const lockContent = {
      lockfileVersion: 3,
      packages: {
        '': { name: 'test-project', version: '1.0.0' },
        'node_modules/express': { version: '4.18.2' },
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, 'package-lock.json'),
      JSON.stringify(lockContent),
    );

    const manifestPath = path.join(tmpDir, 'package.json');
    const deps = await parseNpmManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].resolvedVersion).toBe('4.18.2');
    expect(deps[0].declaredConstraint).toBe('^4.18.0');
  });

  it('resolves versions from package-lock.json (v1 format)', async () => {
    writePackageJson({
      name: 'test-project',
      dependencies: { lodash: '^4.17.0' },
    });

    const lockContent = {
      lockfileVersion: 1,
      dependencies: {
        lodash: { version: '4.17.21' },
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, 'package-lock.json'),
      JSON.stringify(lockContent),
    );

    const manifestPath = path.join(tmpDir, 'package.json');
    const deps = await parseNpmManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].resolvedVersion).toBe('4.17.21');
  });

  it('resolves versions from yarn.lock', async () => {
    writePackageJson({
      name: 'test-project',
      dependencies: { react: '^18.0.0' },
    });

    const yarnLock = `# yarn lockfile v1

react@^18.0.0:
  version "18.2.0"
  resolved "https://registry.yarnpkg.com/react/-/react-18.2.0.tgz"
  integrity sha512-abc123
`;
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), yarnLock);

    const manifestPath = path.join(tmpDir, 'package.json');
    const deps = await parseNpmManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].resolvedVersion).toBe('18.2.0');
  });

  it('handles scoped packages in yarn.lock', async () => {
    writePackageJson({
      name: 'test-project',
      dependencies: { '@types/node': '^20.0.0' },
    });

    const yarnLock = `# yarn lockfile v1

"@types/node@^20.0.0":
  version "20.11.5"
  resolved "https://registry.yarnpkg.com/@types/node/-/node-20.11.5.tgz"
`;
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), yarnLock);

    const manifestPath = path.join(tmpDir, 'package.json');
    const deps = await parseNpmManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe('@types/node');
    expect(deps[0].resolvedVersion).toBe('20.11.5');
  });

  it('skips invalid dependency entries gracefully', async () => {
    const manifestPath = writePackageJson({
      name: 'test-project',
      dependencies: {
        express: '^4.18.0',
        '': '^1.0.0',           // invalid: empty name
        '.hidden': '^1.0.0',    // invalid: starts with dot
        validPkg: '',           // invalid: empty constraint
        anotherValid: '^2.0.0', // valid
        badConstraint: 123,     // invalid: non-string constraint
      },
    });

    const deps = await parseNpmManifest(manifestPath, tmpDir);

    // Should only extract valid entries
    const names = deps.map(d => d.name);
    expect(names).toContain('express');
    expect(names).toContain('anotherValid');
    expect(names).not.toContain('');
    expect(names).not.toContain('.hidden');
    expect(names).not.toContain('validPkg');
    expect(names).not.toContain('badConstraint');
  });

  it('returns empty array for invalid JSON', async () => {
    const filePath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(filePath, 'not valid json {{{');

    const deps = await parseNpmManifest(filePath, tmpDir);
    expect(deps).toEqual([]);
  });

  it('returns empty array for non-object JSON', async () => {
    const filePath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(filePath, '"just a string"');

    const deps = await parseNpmManifest(filePath, tmpDir);
    expect(deps).toEqual([]);
  });

  it('returns empty array for array JSON', async () => {
    const filePath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(filePath, '[1, 2, 3]');

    const deps = await parseNpmManifest(filePath, tmpDir);
    expect(deps).toEqual([]);
  });

  it('handles package.json with no dependency fields', async () => {
    const manifestPath = writePackageJson({
      name: 'empty-project',
      version: '1.0.0',
    });

    const deps = await parseNpmManifest(manifestPath, tmpDir);
    expect(deps).toEqual([]);
  });

  it('sets sourceManifest as relative path', async () => {
    const subDir = path.join(tmpDir, 'packages', 'sub');
    const manifestPath = writePackageJson(
      { name: 'sub', dependencies: { foo: '^1.0.0' } },
      subDir,
    );

    const deps = await parseNpmManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].sourceManifest).toBe('packages/sub/package.json');
  });

  it('handles peerDependencies with production scope', async () => {
    const manifestPath = writePackageJson({
      name: 'test-project',
      peerDependencies: { react: '>=16.0.0' },
    });

    const deps = await parseNpmManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe('react');
    expect(deps[0].scope).toBe('production');
    expect(deps[0].declaredConstraint).toBe('>=16.0.0');
  });

  it('does not duplicate peerDependencies already in dependencies', async () => {
    const manifestPath = writePackageJson({
      name: 'test-project',
      dependencies: { react: '^18.0.0' },
      peerDependencies: { react: '>=16.0.0' },
    });

    const deps = await parseNpmManifest(manifestPath, tmpDir);

    const reactDeps = deps.filter(d => d.name === 'react');
    expect(reactDeps).toHaveLength(1);
    expect(reactDeps[0].scope).toBe('production');
    expect(reactDeps[0].declaredConstraint).toBe('^18.0.0');
  });

  it('prefers package-lock.json over yarn.lock', async () => {
    writePackageJson({
      name: 'test-project',
      dependencies: { express: '^4.0.0' },
    });

    // Both lock files present
    const lockContent = {
      lockfileVersion: 3,
      packages: {
        '': { name: 'test-project' },
        'node_modules/express': { version: '4.18.2' },
      },
    };
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), JSON.stringify(lockContent));

    const yarnLock = `# yarn lockfile v1

express@^4.0.0:
  version "4.17.0"
`;
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), yarnLock);

    const manifestPath = path.join(tmpDir, 'package.json');
    const deps = await parseNpmManifest(manifestPath, tmpDir);

    // Should use package-lock.json version
    expect(deps[0].resolvedVersion).toBe('4.18.2');
  });

  it('leaves resolvedVersion undefined when no lock file exists', async () => {
    const manifestPath = writePackageJson({
      name: 'test-project',
      dependencies: { express: '^4.18.0' },
    });

    const deps = await parseNpmManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].resolvedVersion).toBeUndefined();
  });
});
