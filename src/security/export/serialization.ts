/**
 * CycloneDX serialization utilities for Dependency_Nodes.
 *
 * Provides serialize/deserialize between DependencyRow (sec_dependencies table)
 * and CycloneDX JSON component format, with partial failure resilience.
 *
 * Requirements: 8.2, 8.3, 8.4
 */
import type { CycloneDXComponent } from '../types';

// ── Interfaces ────────────────────────────────────────────────────────────────

/**
 * Represents a row from the sec_dependencies table.
 */
export interface DependencyRow {
  node_id: string;
  ecosystem: string;
  package_name: string;
  declared_constraint: string;
  resolved_version: string | null;
  scope: 'production' | 'development' | 'optional';
  transitive_status: 'complete' | 'incomplete';
  last_vuln_check: number | null;
  vuln_data_stale: number;
  vuln_data_stale_since: number | null;
  source_manifests: string; // JSON array of manifest paths
}

/**
 * Error reported when a single node fails serialization/deserialization.
 */
export interface SerializationError {
  name: string;
  reason: string;
}

// ── Ecosystem ↔ purl type mapping ─────────────────────────────────────────────

const ECOSYSTEM_TO_PURL: Record<string, string> = {
  npm: 'npm',
  maven: 'maven',
  go: 'golang',
  pypi: 'pypi',
  cargo: 'cargo',
};

const PURL_TO_ECOSYSTEM: Record<string, string> = {
  npm: 'npm',
  maven: 'maven',
  golang: 'go',
  pypi: 'pypi',
  cargo: 'cargo',
};

// ── Single-item serialization ─────────────────────────────────────────────────

/**
 * Converts a dependency database row to a CycloneDX component object.
 * Stores the declared constraint in a `properties` array entry with
 * name "kirograph:declaredConstraint".
 *
 * The purl format is: pkg:<ecosystem>/<name>@<version>
 */
export function serializeDependencyToComponent(dep: DependencyRow): CycloneDXComponent {
  const purlType = ECOSYSTEM_TO_PURL[dep.ecosystem];
  if (!purlType) {
    throw new Error(`Unsupported ecosystem: ${dep.ecosystem}`);
  }

  const version = dep.resolved_version ?? dep.declared_constraint;
  if (!version) {
    throw new Error(`No version or constraint available for dependency: ${dep.package_name}`);
  }

  if (!dep.package_name) {
    throw new Error('Dependency package_name is required');
  }

  const purl = `pkg:${purlType}/${dep.package_name}@${version}`;

  const scope: 'required' | 'optional' =
    dep.scope === 'production' ? 'required' : 'optional';

  const component: CycloneDXComponent = {
    type: 'library',
    name: dep.package_name,
    version,
    purl,
    scope,
    properties: [
      { name: 'kirograph:declaredConstraint', value: dep.declared_constraint },
    ],
  };

  return component;
}

// ── Single-item deserialization ───────────────────────────────────────────────

/**
 * Converts a CycloneDX component back to a dependency row.
 * Extracts the constraint from the properties array.
 */
export function deserializeComponentToDependency(component: CycloneDXComponent): DependencyRow {
  if (!component.purl) {
    throw new Error(`Component "${component.name}" is missing purl`);
  }

  if (!component.name) {
    throw new Error('Component name is required');
  }

  // Parse purl: pkg:<type>/<name>@<version>
  const purlMatch = component.purl.match(/^pkg:([^/]+)\/(.+)@(.+)$/);
  if (!purlMatch) {
    throw new Error(`Invalid purl format: ${component.purl}`);
  }

  const [, purlType, purlName, purlVersion] = purlMatch;

  const ecosystem = PURL_TO_ECOSYSTEM[purlType];
  if (!ecosystem) {
    throw new Error(`Unsupported purl type: ${purlType}`);
  }

  // Extract declared constraint from properties
  const constraintProp = component.properties?.find(
    (p) => p.name === 'kirograph:declaredConstraint',
  );
  const declaredConstraint = constraintProp?.value ?? component.version;

  // Map CycloneDX scope back to dependency scope
  const scope: 'production' | 'development' | 'optional' =
    component.scope === 'optional' ? 'optional' : 'production';

  const row: DependencyRow = {
    node_id: `dep:${ecosystem}:${purlName}`,
    ecosystem,
    package_name: purlName,
    declared_constraint: declaredConstraint,
    resolved_version: purlVersion,
    scope,
    transitive_status: 'complete',
    last_vuln_check: null,
    vuln_data_stale: 0,
    vuln_data_stale_since: null,
    source_manifests: '[]',
  };

  return row;
}

// ── Batch serialization with partial failure resilience ───────────────────────

/**
 * Serializes all dependencies, collecting errors for any that fail
 * without aborting the batch.
 */
export function serializeAll(deps: DependencyRow[]): {
  components: CycloneDXComponent[];
  errors: SerializationError[];
} {
  const components: CycloneDXComponent[] = [];
  const errors: SerializationError[] = [];

  for (const dep of deps) {
    try {
      const component = serializeDependencyToComponent(dep);
      components.push(component);
    } catch (err) {
      errors.push({
        name: dep.package_name || dep.node_id || 'unknown',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { components, errors };
}

/**
 * Deserializes all components back to dependency rows,
 * collecting errors for any that fail without aborting the batch.
 */
export function deserializeAll(components: CycloneDXComponent[]): {
  deps: DependencyRow[];
  errors: SerializationError[];
} {
  const deps: DependencyRow[] = [];
  const errors: SerializationError[] = [];

  for (const component of components) {
    try {
      const dep = deserializeComponentToDependency(component);
      deps.push(dep);
    } catch (err) {
      errors.push({
        name: component.name || 'unknown',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { deps, errors };
}
