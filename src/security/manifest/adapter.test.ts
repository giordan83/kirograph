/**
 * Unit tests for SecurityManifestAdapter
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SecurityManifestAdapter, type VersionExtractionPlugin } from './adapter';
import type { ParsedDependency } from '../types';

describe('SecurityManifestAdapter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-adapter-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should initialize with architecture parsers', () => {
      const adapter = new SecurityManifestAdapter(tmpDir);
      const parsers = adapter.getArchParsers();
      expect(parsers.length).toBeGreaterThan(0);
      // Should include the known parsers
      const names = parsers.map(p => p.name);
      expect(names).toContain('npm');
      expect(names).toContain('cargo');
      expect(names).toContain('go');
      expect(names).toContain('maven');
      expect(names).toContain('python');
    });
  });

  describe('registerPlugin', () => {
    it('should register and retrieve a version extraction plugin', () => {
      const adapter = new SecurityManifestAdapter(tmpDir);
      const plugin: VersionExtractionPlugin = {
        ecosystem: 'npm',
        manifestFiles: ['package.json'],
        canExtract: (p) => path.basename(p) === 'package.json',
        extract: async () => [],
      };
      adapter.registerPlugin(plugin);
      const plugins = adapter.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0].ecosystem).toBe('npm');
    });

    it('should overwrite plugin for same ecosystem', () => {
      const adapter = new SecurityManifestAdapter(tmpDir);
      const plugin1: VersionExtractionPlugin = {
        ecosystem: 'npm',
        manifestFiles: ['package.json'],
        canExtract: () => true,
        extract: async () => [{ name: 'a', declaredConstraint: '1.0', scope: 'production', ecosystem: 'npm', sourceManifest: 'package.json' }],
      };
      const plugin2: VersionExtractionPlugin = {
        ecosystem: 'npm',
        manifestFiles: ['package.json'],
        canExtract: () => true,
        extract: async () => [{ name: 'b', declaredConstraint: '2.0', scope: 'development', ecosystem: 'npm', sourceManifest: 'package.json' }],
      };
      adapter.registerPlugin(plugin1);
      adapter.registerPlugin(plugin2);
      const plugins = adapter.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toBe(plugin2);
    });
  });

  describe('discoverManifests', () => {
    it('should discover package.json files', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test', dependencies: { express: '^4.0.0' } }));
      const adapter = new SecurityManifestAdapter(tmpDir);
      const manifests = adapter.discoverManifests();
      expect(manifests).toHaveLength(1);
      expect(manifests[0]).toBe(path.join(tmpDir, 'package.json'));
    });

    it('should discover nested manifest files', () => {
      fs.mkdirSync(path.join(tmpDir, 'sub'));
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root' }));
      fs.writeFileSync(path.join(tmpDir, 'sub', 'package.json'), JSON.stringify({ name: 'sub' }));
      const adapter = new SecurityManifestAdapter(tmpDir);
      const manifests = adapter.discoverManifests();
      expect(manifests).toHaveLength(2);
    });

    it('should skip node_modules directory', () => {
      fs.mkdirSync(path.join(tmpDir, 'node_modules'));
      fs.writeFileSync(path.join(tmpDir, 'node_modules', 'package.json'), JSON.stringify({ name: 'dep' }));
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root' }));
      const adapter = new SecurityManifestAdapter(tmpDir);
      const manifests = adapter.discoverManifests();
      expect(manifests).toHaveLength(1);
      expect(manifests[0]).toBe(path.join(tmpDir, 'package.json'));
    });

    it('should skip .git directory', () => {
      fs.mkdirSync(path.join(tmpDir, '.git'));
      fs.writeFileSync(path.join(tmpDir, '.git', 'package.json'), JSON.stringify({ name: 'git' }));
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root' }));
      const adapter = new SecurityManifestAdapter(tmpDir);
      const manifests = adapter.discoverManifests();
      expect(manifests).toHaveLength(1);
    });

    it('should skip dist and build directories', () => {
      fs.mkdirSync(path.join(tmpDir, 'dist'));
      fs.mkdirSync(path.join(tmpDir, 'build'));
      fs.writeFileSync(path.join(tmpDir, 'dist', 'package.json'), JSON.stringify({ name: 'dist' }));
      fs.writeFileSync(path.join(tmpDir, 'build', 'package.json'), JSON.stringify({ name: 'build' }));
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root' }));
      const adapter = new SecurityManifestAdapter(tmpDir);
      const manifests = adapter.discoverManifests();
      expect(manifests).toHaveLength(1);
    });

    it('should discover multiple ecosystem manifests', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'js-project' }));
      fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]\nname = "rust-project"\nversion = "0.1.0"');
      fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module example.com/mymod\n\ngo 1.21');
      const adapter = new SecurityManifestAdapter(tmpDir);
      const manifests = adapter.discoverManifests();
      expect(manifests).toHaveLength(3);
    });

    it('should return empty array for empty directory', () => {
      const adapter = new SecurityManifestAdapter(tmpDir);
      const manifests = adapter.discoverManifests();
      expect(manifests).toHaveLength(0);
    });
  });

  describe('getEcosystem', () => {
    it('should return npm for package.json', () => {
      const adapter = new SecurityManifestAdapter(tmpDir);
      expect(adapter.getEcosystem('/some/path/package.json')).toBe('npm');
    });

    it('should return cargo for Cargo.toml', () => {
      const adapter = new SecurityManifestAdapter(tmpDir);
      expect(adapter.getEcosystem('/some/path/Cargo.toml')).toBe('cargo');
    });

    it('should return go for go.mod', () => {
      const adapter = new SecurityManifestAdapter(tmpDir);
      expect(adapter.getEcosystem('/some/path/go.mod')).toBe('go');
    });

    it('should return maven for pom.xml', () => {
      const adapter = new SecurityManifestAdapter(tmpDir);
      expect(adapter.getEcosystem('/some/path/pom.xml')).toBe('maven');
    });

    it('should return undefined for unknown files', () => {
      const adapter = new SecurityManifestAdapter(tmpDir);
      expect(adapter.getEcosystem('/some/path/unknown.txt')).toBeUndefined();
    });
  });

  describe('extractAll', () => {
    it('should use registered plugin for extraction', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
        name: 'test-project',
        dependencies: { express: '^4.18.0', lodash: '~4.17.21' },
        devDependencies: { vitest: '^1.0.0' },
      }));

      const adapter = new SecurityManifestAdapter(tmpDir);
      const mockDeps: ParsedDependency[] = [
        { name: 'express', declaredConstraint: '^4.18.0', scope: 'production', ecosystem: 'npm', sourceManifest: 'package.json' },
        { name: 'lodash', declaredConstraint: '~4.17.21', scope: 'production', ecosystem: 'npm', sourceManifest: 'package.json' },
        { name: 'vitest', declaredConstraint: '^1.0.0', scope: 'development', ecosystem: 'npm', sourceManifest: 'package.json' },
      ];

      const plugin: VersionExtractionPlugin = {
        ecosystem: 'npm',
        manifestFiles: ['package.json'],
        canExtract: (p) => path.basename(p) === 'package.json',
        extract: async () => mockDeps,
      };
      adapter.registerPlugin(plugin);

      const result = await adapter.extractAll();
      expect(result.dependenciesCreated).toBe(3);
      expect(result.manifestsParsed).toBe(1);
      expect(result.warnings).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should fall back to architecture parser when no plugin registered', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
        name: 'test-project',
        dependencies: { express: '^4.18.0', lodash: '~4.17.21' },
      }));

      const adapter = new SecurityManifestAdapter(tmpDir);
      const result = await adapter.extractAll();

      // Should extract deps from architecture parser (names only)
      expect(result.dependenciesCreated).toBe(2);
      expect(result.manifestsParsed).toBe(1);
      // Should warn about missing plugin
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].message).toContain('No version extraction plugin');
    });

    it('should handle plugin extraction errors gracefully', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
        name: 'test-project',
        dependencies: { express: '^4.18.0' },
      }));

      const adapter = new SecurityManifestAdapter(tmpDir);
      const plugin: VersionExtractionPlugin = {
        ecosystem: 'npm',
        manifestFiles: ['package.json'],
        canExtract: () => true,
        extract: async () => { throw new Error('Parse failed'); },
      };
      adapter.registerPlugin(plugin);

      const result = await adapter.extractAll();
      expect(result.dependenciesCreated).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe('Parse failed');
    });

    it('should handle empty project with no manifests', async () => {
      const adapter = new SecurityManifestAdapter(tmpDir);
      const result = await adapter.extractAll();
      expect(result.dependenciesCreated).toBe(0);
      expect(result.manifestsParsed).toBe(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('extractFromManifest', () => {
    it('should use plugin when available', async () => {
      const manifestPath = path.join(tmpDir, 'package.json');
      fs.writeFileSync(manifestPath, JSON.stringify({
        name: 'test',
        dependencies: { express: '^4.0.0' },
      }));

      const adapter = new SecurityManifestAdapter(tmpDir);
      const expectedDeps: ParsedDependency[] = [
        { name: 'express', declaredConstraint: '^4.0.0', scope: 'production', ecosystem: 'npm', sourceManifest: 'package.json' },
      ];

      adapter.registerPlugin({
        ecosystem: 'npm',
        manifestFiles: ['package.json'],
        canExtract: (p) => path.basename(p) === 'package.json',
        extract: async () => expectedDeps,
      });

      const deps = await adapter.extractFromManifest(manifestPath);
      expect(deps).toEqual(expectedDeps);
    });

    it('should fall back to architecture parser when no plugin', async () => {
      const manifestPath = path.join(tmpDir, 'package.json');
      fs.writeFileSync(manifestPath, JSON.stringify({
        name: 'test',
        dependencies: { express: '^4.0.0', lodash: '~4.17.0' },
      }));

      const adapter = new SecurityManifestAdapter(tmpDir);
      const deps = await adapter.extractFromManifest(manifestPath);
      expect(deps).toHaveLength(2);
      // Fallback uses '*' as constraint and 'production' as default scope
      expect(deps[0].declaredConstraint).toBe('*');
      expect(deps[0].scope).toBe('production');
    });

    it('should return empty array for unknown manifest type', async () => {
      const manifestPath = path.join(tmpDir, 'unknown.txt');
      fs.writeFileSync(manifestPath, 'some content');

      const adapter = new SecurityManifestAdapter(tmpDir);
      const deps = await adapter.extractFromManifest(manifestPath);
      expect(deps).toHaveLength(0);
    });
  });
});
