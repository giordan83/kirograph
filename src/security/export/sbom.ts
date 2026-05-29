/**
 * SBOMExporter — CycloneDX 1.5 SBOM Generation
 *
 * Generates a CycloneDX 1.5 JSON Software Bill of Materials from the
 * Dependency_Graph stored in the KiroGraph database. Each Dependency_Node
 * becomes a component of type "library" with purl, scope, and
 * direct/transitive classification.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */
import type { GraphDatabase } from '../../db/database';
import type {
  CycloneDXSBOM,
  CycloneDXComponent,
  CycloneDXDependencyEntry,
  SBOMMetadata,
} from '../types';
import * as fs from 'fs';
import * as path from 'path';

// ── Ecosystem → purl type mapping ────────────────────────────────────────────

const ECOSYSTEM_PURL_MAP: Record<string, string> = {
  npm: 'npm',
  maven: 'maven',
  go: 'golang',
  pypi: 'pypi',
  python: 'pypi',
  cargo: 'cargo',
};

/**
 * Build a Package URL (purl) for a dependency.
 * Format: pkg:<type>/<name>@<version>
 */
function buildPurl(ecosystem: string, name: string, version: string): string {
  const purlType = ECOSYSTEM_PURL_MAP[ecosystem] ?? ecosystem;
  return `pkg:${purlType}/${name}@${version}`;
}

// ── Metadata helpers ─────────────────────────────────────────────────────────

const TOOL_NAME = 'kirograph-sec';

/**
 * Read the tool version from package.json, falling back to "0.1.0".
 */
function getToolVersion(): string {
  try {
    // Walk up from this file to find the project root package.json
    let dir = __dirname;
    for (let i = 0; i < 5; i++) {
      const pkgPath = path.join(dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.version) return pkg.version;
      }
      dir = path.dirname(dir);
    }
  } catch {
    // Ignore errors — fall back to default
  }
  return '0.1.0';
}

/**
 * Detect the project name from the root manifest file.
 * Checks package.json, Cargo.toml, go.mod, pom.xml in order.
 */
function getProjectName(projectRoot: string): string {
  try {
    const pkgJsonPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      if (pkg.name) return pkg.name;
    }
  } catch { /* ignore */ }

  try {
    const cargoPath = path.join(projectRoot, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
      const content = fs.readFileSync(cargoPath, 'utf-8');
      const match = content.match(/^\s*name\s*=\s*"([^"]+)"/m);
      if (match) return match[1];
    }
  } catch { /* ignore */ }

  try {
    const goModPath = path.join(projectRoot, 'go.mod');
    if (fs.existsSync(goModPath)) {
      const content = fs.readFileSync(goModPath, 'utf-8');
      const match = content.match(/^module\s+(\S+)/m);
      if (match) return match[1];
    }
  } catch { /* ignore */ }

  try {
    const pomPath = path.join(projectRoot, 'pom.xml');
    if (fs.existsSync(pomPath)) {
      const content = fs.readFileSync(pomPath, 'utf-8');
      const match = content.match(/<artifactId>([^<]+)<\/artifactId>/);
      if (match) return match[1];
    }
  } catch { /* ignore */ }

  // Fallback: use the directory name
  return path.basename(projectRoot);
}

// ── Database row types ───────────────────────────────────────────────────────

interface SecDependencyRow {
  node_id: string;
  ecosystem: string;
  package_name: string;
  declared_constraint: string;
  resolved_version: string | null;
  scope: string;
  source_manifests: string;
}

interface EdgeRow {
  source: string;
  target: string;
  kind: string;
}

// ── SBOMExporter ─────────────────────────────────────────────────────────────

/**
 * Generates CycloneDX 1.5 SBOM documents from the dependency graph.
 */
export class SBOMExporter {
  private readonly db: GraphDatabase;
  private readonly projectRoot: string;

  constructor(db: GraphDatabase, projectRoot: string) {
    this.db = db;
    this.projectRoot = projectRoot;
  }

  /**
   * Generate a CycloneDX 1.5 SBOM object.
   */
  export(): CycloneDXSBOM {
    const rawDb = this.db.getRawDb();

    // Query all dependency nodes
    const depRows: SecDependencyRow[] = rawDb.all(
      'SELECT node_id, ecosystem, package_name, declared_constraint, resolved_version, scope, source_manifests FROM sec_dependencies',
    );

    // Determine which dependencies are direct (have a declared_in edge)
    const directNodeIds = new Set<string>();
    if (depRows.length > 0) {
      const declaredInEdges: EdgeRow[] = rawDb.all(
        `SELECT source, target, kind FROM edges WHERE kind = 'declared_in'`,
      );
      for (const edge of declaredInEdges) {
        directNodeIds.add(edge.source);
      }
    }

    // Build components
    const components: CycloneDXComponent[] = depRows.map((row) => {
      const version = row.resolved_version ?? row.declared_constraint;
      const purl = buildPurl(row.ecosystem, row.package_name, version);
      const isDirect = directNodeIds.has(row.node_id);

      const component: CycloneDXComponent = {
        type: 'library',
        name: row.package_name,
        version,
        purl,
        scope: isDirect ? 'required' : 'optional',
        properties: [
          { name: 'kirograph:classification', value: isDirect ? 'direct' : 'transitive' },
          { name: 'kirograph:ecosystem', value: row.ecosystem },
        ],
      };

      return component;
    });

    // Build dependency relationships from depends_on edges
    const dependencies: CycloneDXDependencyEntry[] = [];

    if (depRows.length > 0) {
      const dependsOnEdges: EdgeRow[] = rawDb.all(
        `SELECT source, target, kind FROM edges WHERE kind = 'depends_on'`,
      );

      // Group depends_on edges by source
      const depNodeIds = new Set(depRows.map((r) => r.node_id));
      const depsMap = new Map<string, string[]>();

      for (const edge of dependsOnEdges) {
        // Only include edges where both source and target are dependency nodes
        if (depNodeIds.has(edge.source) && depNodeIds.has(edge.target)) {
          const existing = depsMap.get(edge.source);
          if (existing) {
            existing.push(edge.target);
          } else {
            depsMap.set(edge.source, [edge.target]);
          }
        }
      }

      // Create an entry for each dependency node
      for (const row of depRows) {
        const version = row.resolved_version ?? row.declared_constraint;
        const ref = buildPurl(row.ecosystem, row.package_name, version);
        const deps = depsMap.get(row.node_id);

        const entry: CycloneDXDependencyEntry = { ref };
        if (deps && deps.length > 0) {
          // Resolve target node_ids to purls
          entry.dependsOn = deps.map((targetId) => {
            const targetRow = depRows.find((r) => r.node_id === targetId);
            if (targetRow) {
              const targetVersion = targetRow.resolved_version ?? targetRow.declared_constraint;
              return buildPurl(targetRow.ecosystem, targetRow.package_name, targetVersion);
            }
            return targetId; // fallback to node_id if not found
          });
        }

        dependencies.push(entry);
      }
    }

    // Build metadata
    const metadata = this.buildMetadata();

    const sbom: CycloneDXSBOM = {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      version: 1,
      metadata,
      components,
      dependencies,
    };

    return sbom;
  }

  /**
   * Export the SBOM as a pretty-printed JSON string.
   */
  exportJSON(): string {
    const sbom = this.export();
    return JSON.stringify(sbom, null, 2);
  }

  /**
   * Build CycloneDX metadata section.
   */
  private buildMetadata(): Record<string, unknown> {
    const toolVersion = getToolVersion();
    const projectName = getProjectName(this.projectRoot);
    const timestamp = new Date().toISOString();

    const meta: SBOMMetadata = {
      toolName: TOOL_NAME,
      toolVersion,
      timestamp,
      projectName,
    };

    return {
      timestamp: meta.timestamp,
      tools: {
        components: [
          {
            type: 'application',
            name: meta.toolName,
            version: meta.toolVersion,
          },
        ],
      },
      component: {
        type: 'application',
        name: meta.projectName,
        version: '',
      },
    };
  }
}
