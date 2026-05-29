/**
 * Unit tests for CycloneDX serialization utilities.
 *
 * Tests serialize/deserialize for Dependency_Nodes to/from CycloneDX JSON
 * component format, including round-trip and partial failure resilience.
 */
import { describe, it, expect } from 'vitest';
import {
  serializeDependencyToComponent,
  deserializeComponentToDependency,
  serializeAll,
  deserializeAll,
  type DependencyRow,
} from './serialization';
import type { CycloneDXComponent } from '../types';

function makeDependencyRow(overrides?: Partial<DependencyRow>): DependencyRow {
  return {
    node_id: 'dep:npm:express',
    ecosystem: 'npm',
    package_name: 'express',
    declared_constraint: '^4.18.0',
    resolved_version: '4.18.2',
    scope: 'production',
    transitive_status: 'complete',
    last_vuln_check: null,
    vuln_data_stale: 0,
    vuln_data_stale_since: null,
    source_manifests: '["package.json"]',
    ...overrides,
  };
}

describe('serializeDependencyToComponent', () => {
  it('should serialize an npm dependency to a CycloneDX component', () => {
    const dep = makeDependencyRow();
    const component = serializeDependencyToComponent(dep);

    expect(component.type).toBe('library');
    expect(component.name).toBe('express');
    expect(component.version).toBe('4.18.2');
    expect(component.purl).toBe('pkg:npm/express@4.18.2');
    expect(component.scope).toBe('required');
    expect(component.properties).toEqual([
      { name: 'kirograph:declaredConstraint', value: '^4.18.0' },
    ]);
  });

  it('should use declared_constraint as version when resolved_version is null', () => {
    const dep = makeDependencyRow({ resolved_version: null });
    const component = serializeDependencyToComponent(dep);

    expect(component.version).toBe('^4.18.0');
    expect(component.purl).toBe('pkg:npm/express@^4.18.0');
  });

  it('should map production scope to required', () => {
    const dep = makeDependencyRow({ scope: 'production' });
    const component = serializeDependencyToComponent(dep);
    expect(component.scope).toBe('required');
  });

  it('should map development scope to optional', () => {
    const dep = makeDependencyRow({ scope: 'development' });
    const component = serializeDependencyToComponent(dep);
    expect(component.scope).toBe('optional');
  });

  it('should map optional scope to optional', () => {
    const dep = makeDependencyRow({ scope: 'optional' });
    const component = serializeDependencyToComponent(dep);
    expect(component.scope).toBe('optional');
  });

  it('should correctly map maven ecosystem to purl type', () => {
    const dep = makeDependencyRow({
      node_id: 'dep:maven:log4j-core',
      ecosystem: 'maven',
      package_name: 'org.apache.logging.log4j/log4j-core',
      resolved_version: '2.17.0',
    });
    const component = serializeDependencyToComponent(dep);
    expect(component.purl).toBe('pkg:maven/org.apache.logging.log4j/log4j-core@2.17.0');
  });

  it('should correctly map go ecosystem to golang purl type', () => {
    const dep = makeDependencyRow({
      node_id: 'dep:go:github.com/gin-gonic/gin',
      ecosystem: 'go',
      package_name: 'github.com/gin-gonic/gin',
      resolved_version: '1.9.1',
    });
    const component = serializeDependencyToComponent(dep);
    expect(component.purl).toBe('pkg:golang/github.com/gin-gonic/gin@1.9.1');
  });

  it('should correctly map pypi ecosystem', () => {
    const dep = makeDependencyRow({
      node_id: 'dep:pypi:django',
      ecosystem: 'pypi',
      package_name: 'django',
      resolved_version: '4.2.0',
    });
    const component = serializeDependencyToComponent(dep);
    expect(component.purl).toBe('pkg:pypi/django@4.2.0');
  });

  it('should correctly map cargo ecosystem', () => {
    const dep = makeDependencyRow({
      node_id: 'dep:cargo:serde',
      ecosystem: 'cargo',
      package_name: 'serde',
      resolved_version: '1.0.188',
    });
    const component = serializeDependencyToComponent(dep);
    expect(component.purl).toBe('pkg:cargo/serde@1.0.188');
  });

  it('should throw for unsupported ecosystem', () => {
    const dep = makeDependencyRow({ ecosystem: 'unknown' });
    expect(() => serializeDependencyToComponent(dep)).toThrow('Unsupported ecosystem: unknown');
  });

  it('should throw when both version and constraint are empty', () => {
    const dep = makeDependencyRow({
      resolved_version: null,
      declared_constraint: '',
    });
    expect(() => serializeDependencyToComponent(dep)).toThrow(
      'No version or constraint available',
    );
  });

  it('should throw when package_name is empty', () => {
    const dep = makeDependencyRow({ package_name: '' });
    expect(() => serializeDependencyToComponent(dep)).toThrow(
      'Dependency package_name is required',
    );
  });
});

describe('deserializeComponentToDependency', () => {
  it('should deserialize a CycloneDX component to a dependency row', () => {
    const component: CycloneDXComponent = {
      type: 'library',
      name: 'express',
      version: '4.18.2',
      purl: 'pkg:npm/express@4.18.2',
      scope: 'required',
      properties: [{ name: 'kirograph:declaredConstraint', value: '^4.18.0' }],
    };

    const dep = deserializeComponentToDependency(component);

    expect(dep.ecosystem).toBe('npm');
    expect(dep.package_name).toBe('express');
    expect(dep.resolved_version).toBe('4.18.2');
    expect(dep.declared_constraint).toBe('^4.18.0');
    expect(dep.scope).toBe('production');
    expect(dep.node_id).toBe('dep:npm:express');
  });

  it('should use version as declared_constraint when property is missing', () => {
    const component: CycloneDXComponent = {
      type: 'library',
      name: 'express',
      version: '4.18.2',
      purl: 'pkg:npm/express@4.18.2',
    };

    const dep = deserializeComponentToDependency(component);
    expect(dep.declared_constraint).toBe('4.18.2');
  });

  it('should map optional scope back to optional', () => {
    const component: CycloneDXComponent = {
      type: 'library',
      name: 'jest',
      version: '29.0.0',
      purl: 'pkg:npm/jest@29.0.0',
      scope: 'optional',
    };

    const dep = deserializeComponentToDependency(component);
    expect(dep.scope).toBe('optional');
  });

  it('should map required scope back to production', () => {
    const component: CycloneDXComponent = {
      type: 'library',
      name: 'express',
      version: '4.18.2',
      purl: 'pkg:npm/express@4.18.2',
      scope: 'required',
    };

    const dep = deserializeComponentToDependency(component);
    expect(dep.scope).toBe('production');
  });

  it('should map golang purl type back to go ecosystem', () => {
    const component: CycloneDXComponent = {
      type: 'library',
      name: 'github.com/gin-gonic/gin',
      version: '1.9.1',
      purl: 'pkg:golang/github.com/gin-gonic/gin@1.9.1',
    };

    const dep = deserializeComponentToDependency(component);
    expect(dep.ecosystem).toBe('go');
    expect(dep.package_name).toBe('github.com/gin-gonic/gin');
  });

  it('should throw for missing purl', () => {
    const component = {
      type: 'library',
      name: 'express',
      version: '4.18.2',
      purl: '',
    } as CycloneDXComponent;

    expect(() => deserializeComponentToDependency(component)).toThrow('missing purl');
  });

  it('should throw for invalid purl format', () => {
    const component: CycloneDXComponent = {
      type: 'library',
      name: 'express',
      version: '4.18.2',
      purl: 'invalid-purl',
    };

    expect(() => deserializeComponentToDependency(component)).toThrow('Invalid purl format');
  });

  it('should throw for unsupported purl type', () => {
    const component: CycloneDXComponent = {
      type: 'library',
      name: 'something',
      version: '1.0.0',
      purl: 'pkg:nuget/something@1.0.0',
    };

    expect(() => deserializeComponentToDependency(component)).toThrow('Unsupported purl type');
  });

  it('should set default values for non-serialized fields', () => {
    const component: CycloneDXComponent = {
      type: 'library',
      name: 'express',
      version: '4.18.2',
      purl: 'pkg:npm/express@4.18.2',
    };

    const dep = deserializeComponentToDependency(component);
    expect(dep.transitive_status).toBe('complete');
    expect(dep.last_vuln_check).toBeNull();
    expect(dep.vuln_data_stale).toBe(0);
    expect(dep.vuln_data_stale_since).toBeNull();
    expect(dep.source_manifests).toBe('[]');
  });
});

describe('serializeDependencyToComponent → deserializeComponentToDependency round-trip', () => {
  it('should preserve key fields through round-trip', () => {
    const original = makeDependencyRow();
    const component = serializeDependencyToComponent(original);
    const restored = deserializeComponentToDependency(component);

    expect(restored.package_name).toBe(original.package_name);
    expect(restored.resolved_version).toBe(original.resolved_version);
    expect(restored.ecosystem).toBe(original.ecosystem);
    expect(restored.scope).toBe(original.scope);
    expect(restored.declared_constraint).toBe(original.declared_constraint);
  });

  it('should preserve constraint when resolved_version is null', () => {
    const original = makeDependencyRow({ resolved_version: null });
    const component = serializeDependencyToComponent(original);
    const restored = deserializeComponentToDependency(component);

    expect(restored.declared_constraint).toBe(original.declared_constraint);
    // When no resolved version, the version in purl is the constraint
    expect(restored.resolved_version).toBe(original.declared_constraint);
  });
});

describe('serializeAll', () => {
  it('should serialize all valid dependencies', () => {
    const deps = [
      makeDependencyRow({ package_name: 'express', node_id: 'dep:npm:express' }),
      makeDependencyRow({ package_name: 'lodash', node_id: 'dep:npm:lodash' }),
    ];

    const result = serializeAll(deps);
    expect(result.components).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('should collect errors for failing nodes and continue with remaining', () => {
    const deps = [
      makeDependencyRow({ package_name: 'express' }),
      makeDependencyRow({ package_name: 'bad-dep', ecosystem: 'unsupported' }),
      makeDependencyRow({ package_name: 'lodash' }),
    ];

    const result = serializeAll(deps);
    expect(result.components).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].name).toBe('bad-dep');
    expect(result.errors[0].reason).toContain('Unsupported ecosystem');
  });

  it('should handle empty input', () => {
    const result = serializeAll([]);
    expect(result.components).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should handle all failures gracefully', () => {
    const deps = [
      makeDependencyRow({ ecosystem: 'unknown1', package_name: 'a' }),
      makeDependencyRow({ ecosystem: 'unknown2', package_name: 'b' }),
    ];

    const result = serializeAll(deps);
    expect(result.components).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
  });
});

describe('deserializeAll', () => {
  it('should deserialize all valid components', () => {
    const components: CycloneDXComponent[] = [
      { type: 'library', name: 'express', version: '4.18.2', purl: 'pkg:npm/express@4.18.2' },
      { type: 'library', name: 'lodash', version: '4.17.21', purl: 'pkg:npm/lodash@4.17.21' },
    ];

    const result = deserializeAll(components);
    expect(result.deps).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('should collect errors for failing components and continue with remaining', () => {
    const components: CycloneDXComponent[] = [
      { type: 'library', name: 'express', version: '4.18.2', purl: 'pkg:npm/express@4.18.2' },
      { type: 'library', name: 'bad', version: '1.0.0', purl: 'invalid-purl' },
      { type: 'library', name: 'lodash', version: '4.17.21', purl: 'pkg:npm/lodash@4.17.21' },
    ];

    const result = deserializeAll(components);
    expect(result.deps).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].name).toBe('bad');
    expect(result.errors[0].reason).toContain('Invalid purl format');
  });

  it('should handle empty input', () => {
    const result = deserializeAll([]);
    expect(result.deps).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should handle all failures gracefully', () => {
    const components: CycloneDXComponent[] = [
      { type: 'library', name: 'a', version: '1.0', purl: 'bad1' },
      { type: 'library', name: 'b', version: '2.0', purl: 'bad2' },
    ];

    const result = deserializeAll(components);
    expect(result.deps).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
  });
});
