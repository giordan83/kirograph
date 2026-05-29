/**
 * Unit tests for ManifestParser orchestrator
 */
import { describe, it, expect } from 'vitest';
import { compareVersions, deduplicateDependencies } from './parser';
import type { ParsedDependency } from '../types';

describe('compareVersions', () => {
  it('should compare simple semver versions', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('should compare versions with different patch levels', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compareVersions('1.2.10', '1.2.9')).toBeGreaterThan(0);
  });

  it('should compare versions with different minor levels', () => {
    expect(compareVersions('1.1.0', '1.2.0')).toBeLessThan(0);
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
  });

  it('should handle versions with leading v', () => {
    expect(compareVersions('v1.2.3', 'v1.2.4')).toBeLessThan(0);
    expect(compareVersions('v2.0.0', '1.0.0')).toBeGreaterThan(0);
  });

  it('should handle constraint prefixes (^, ~, >=)', () => {
    expect(compareVersions('^1.2.3', '^1.2.4')).toBeLessThan(0);
    expect(compareVersions('~2.0.0', '~1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('>=1.0.0', '>=2.0.0')).toBeLessThan(0);
  });

  it('should handle versions with different segment counts', () => {
    expect(compareVersions('1.2', '1.2.1')).toBeLessThan(0);
    expect(compareVersions('1.2.0', '1.2')).toBe(0);
  });

  it('should handle wildcard constraint as lowest', () => {
    // '*' is not numeric, so it falls to lexicographic comparison
    // but in practice we compare effective versions
    expect(compareVersions('1.0.0', '*')).toBeGreaterThan(0);
  });
});

describe('deduplicateDependencies', () => {
  it('should return unique dependencies when no duplicates exist', () => {
    const deps: ParsedDependency[] = [
      { name: 'express', declaredConstraint: '^4.18.0', resolvedVersion: '4.18.2', scope: 'production', ecosystem: 'npm', sourceManifest: 'package.json' },
      { name: 'lodash', declaredConstraint: '^4.17.0', resolvedVersion: '4.17.21', scope: 'production', ecosystem: 'npm', sourceManifest: 'package.json' },
    ];

    const result = deduplicateDependencies(deps);
    expect(result).toHaveLength(2);
  });

  it('should deduplicate same (name, ecosystem) keeping highest version', () => {
    const deps: ParsedDependency[] = [
      { name: 'express', declaredConstraint: '^4.17.0', resolvedVersion: '4.17.1', scope: 'production', ecosystem: 'npm', sourceManifest: 'packages/a/package.json' },
      { name: 'express', declaredConstraint: '^4.18.0', resolvedVersion: '4.18.2', scope: 'production', ecosystem: 'npm', sourceManifest: 'packages/b/package.json' },
    ];

    const result = deduplicateDependencies(deps);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('express');
    expect(result[0].resolvedVersion).toBe('4.18.2');
    expect(result[0].declaredConstraint).toBe('^4.18.0');
    expect(result[0].sourceManifests).toEqual(['packages/a/package.json', 'packages/b/package.json']);
  });

  it('should keep both when same name but different ecosystems', () => {
    const deps: ParsedDependency[] = [
      { name: 'serde', declaredConstraint: '1.0.0', resolvedVersion: '1.0.0', scope: 'production', ecosystem: 'cargo', sourceManifest: 'Cargo.toml' },
      { name: 'serde', declaredConstraint: '1.0.0', resolvedVersion: '1.0.0', scope: 'production', ecosystem: 'npm', sourceManifest: 'package.json' },
    ];

    const result = deduplicateDependencies(deps);
    expect(result).toHaveLength(2);
  });

  it('should collect all source manifests for duplicates', () => {
    const deps: ParsedDependency[] = [
      { name: 'lodash', declaredConstraint: '^4.17.0', resolvedVersion: '4.17.21', scope: 'production', ecosystem: 'npm', sourceManifest: 'package.json' },
      { name: 'lodash', declaredConstraint: '^4.17.0', resolvedVersion: '4.17.21', scope: 'development', ecosystem: 'npm', sourceManifest: 'packages/lib/package.json' },
      { name: 'lodash', declaredConstraint: '^4.17.0', resolvedVersion: '4.17.21', scope: 'production', ecosystem: 'npm', sourceManifest: 'packages/app/package.json' },
    ];

    const result = deduplicateDependencies(deps);
    expect(result).toHaveLength(1);
    expect(result[0].sourceManifests).toHaveLength(3);
    expect(result[0].sourceManifests).toContain('package.json');
    expect(result[0].sourceManifests).toContain('packages/lib/package.json');
    expect(result[0].sourceManifests).toContain('packages/app/package.json');
  });

  it('should not duplicate source manifests when same manifest appears twice', () => {
    const deps: ParsedDependency[] = [
      { name: 'express', declaredConstraint: '^4.17.0', scope: 'production', ecosystem: 'npm', sourceManifest: 'package.json' },
      { name: 'express', declaredConstraint: '^4.18.0', scope: 'production', ecosystem: 'npm', sourceManifest: 'package.json' },
    ];

    const result = deduplicateDependencies(deps);
    expect(result).toHaveLength(1);
    expect(result[0].sourceManifests).toEqual(['package.json']);
  });

  it('should use declaredConstraint for comparison when resolvedVersion is missing', () => {
    const deps: ParsedDependency[] = [
      { name: 'django', declaredConstraint: '3.2.0', scope: 'production', ecosystem: 'python', sourceManifest: 'requirements.txt' },
      { name: 'django', declaredConstraint: '4.2.0', scope: 'production', ecosystem: 'python', sourceManifest: 'packages/api/requirements.txt' },
    ];

    const result = deduplicateDependencies(deps);
    expect(result).toHaveLength(1);
    expect(result[0].declaredConstraint).toBe('4.2.0');
  });

  it('should handle empty input', () => {
    const result = deduplicateDependencies([]);
    expect(result).toHaveLength(0);
  });

  it('should prefer resolvedVersion over declaredConstraint for comparison', () => {
    const deps: ParsedDependency[] = [
      { name: 'express', declaredConstraint: '^4.0.0', resolvedVersion: '4.18.2', scope: 'production', ecosystem: 'npm', sourceManifest: 'a/package.json' },
      { name: 'express', declaredConstraint: '^5.0.0', resolvedVersion: '5.0.0', scope: 'production', ecosystem: 'npm', sourceManifest: 'b/package.json' },
    ];

    const result = deduplicateDependencies(deps);
    expect(result).toHaveLength(1);
    expect(result[0].resolvedVersion).toBe('5.0.0');
    expect(result[0].declaredConstraint).toBe('^5.0.0');
  });
});
