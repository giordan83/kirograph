# Security Module

KiroGraph-Sec extends the semantic knowledge graph with dependency vulnerability detection and reachability-aware impact analysis. Unlike traditional SCA tools that only report "vulnerable dependency present," KiroGraph-Sec leverages the existing call graph and architecture layers to determine whether vulnerable code paths are actually reachable from your application's entry points.

## Configuration

Enable the security module in `.kirograph/config.json`:

```json
{
  "enableSecurity": true,
  "securityDatabases": ["OSV"],
  "securityAutoEnrich": true
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enableSecurity` | boolean | `false` | Enable dependency scanning and vulnerability detection |
| `securityDatabases` | string[] | `["OSV"]` | Vulnerability databases to query |
| `securityAutoEnrich` | boolean | `true` | Auto-run vulnerability enrichment after manifest parsing |

**Dependency:** `enableSecurity` requires `enableArchitecture: true`. If architecture is disabled, the config validator auto-enables it with a warning.

## How It Works

The security pipeline runs **after architecture analysis** during indexing:

```
code extraction → reference resolution → architecture analysis → security analysis
```

### Pipeline Phases

1. **Manifest discovery** — Finds all supported manifest files in the project tree (respects .gitignore and SKIP_DIRS)
2. **Dependency parsing** — Extracts package names, version constraints, and scopes from each manifest
3. **Dependency graph integration** — Links dependencies to code symbols via import/reference edges, resolves transitives up to 10 levels
4. **Vulnerability enrichment** — Queries configured databases (OSV) for known CVEs affecting project dependencies
5. **Reachability analysis** — Traverses the call graph from entry points to determine if vulnerable code is actually reachable
6. **Impact analysis** — Identifies affected architectural layers, entry points, and distinct code paths

### Graph Model

Two new node kinds are added to the knowledge graph:

- **`dependency`** — Represents a third-party package declared in a manifest
- **`vulnerability`** — Represents a CVE record linked to an affected dependency

Three new edge kinds:

- **`has_vulnerability`** — Links a dependency to a vulnerability
- **`depends_on`** — Links dependencies to their transitive dependencies
- **`declared_in`** — Links a dependency to its declaring manifest file

## CLI Commands

### `kirograph security`

Show security overview: total dependencies, vulnerabilities found, verdict breakdown, stale data warnings.

```bash
kirograph security [path]
```

### `kirograph sbom`

Export CycloneDX 1.5 SBOM to stdout or file.

```bash
kirograph sbom [path]
kirograph sbom --output sbom.json
```

### `kirograph vex`

Export CycloneDX 1.5 VEX with reachability verdicts.

```bash
kirograph vex [path]
kirograph vex --output vex.json
```

### `kirograph vulns`

List vulnerabilities with filtering and management options.

```bash
kirograph vulns [path]
kirograph vulns --severity critical
kirograph vulns --verdict affected
kirograph vulns --refresh
kirograph vulns --add CVE-2024-1234 --package lodash --version 4.17.20
```

| Flag | Description |
|------|-------------|
| `--severity <level>` | Filter by severity: `critical`, `high`, `medium`, `low` |
| `--verdict <verdict>` | Filter by verdict: `affected`, `not_affected`, `under_investigation` |
| `--refresh` | Trigger fresh enrichment from configured databases before listing |
| `--add <cveId>` | Manually register a CVE (requires `--package` and `--version`) |
| `--package <name>` | Package name for manual CVE registration |
| `--version <ver>` | Package version for manual CVE registration |

### `kirograph reachability`

Analyze reachability for a specific CVE or dependency package.

```bash
kirograph reachability <target> [path]
kirograph reachability CVE-2023-12345
kirograph reachability lodash
```

Accepts either a CVE ID or a package name. Shows: verdict, reaching entry point count, call paths (up to 5), unresolved symbols if any, and full impact summary (affected layers, entry points, distinct paths) when verdict is `affected`.

## MCP Tools

All security tools require `enableSecurity: true` and `enableArchitecture: true`.

### `kirograph_security`

Security overview: vulnerability counts, verdict breakdown, stale data warnings.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectPath` | string | cwd | Project root path |

### `kirograph_vulns`

List vulnerabilities with filtering by severity and reachability verdict.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `severity` | string | - | Filter: `critical`, `high`, `medium`, `low` |
| `verdict` | string | - | Filter: `affected`, `not_affected`, `under_investigation` |
| `refresh` | boolean | false | Trigger fresh enrichment before listing |
| `projectPath` | string | cwd | Project root path |

### `kirograph_sbom`

Generate CycloneDX 1.5 SBOM JSON for the project.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectPath` | string | cwd | Project root path |

### `kirograph_vex`

Generate CycloneDX 1.5 VEX JSON with reachability-derived analysis states.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectPath` | string | cwd | Project root path |

### `kirograph_reachability`

Analyze reachability for a specific CVE or dependency — verdict, paths from entry points, and impact summary.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target` | string | required | CVE identifier (e.g. `CVE-2024-1234`) or package name (e.g. `lodash`) |
| `projectPath` | string | cwd | Project root path |

### `kirograph_vuln_add`

Manually register a CVE against a dependency. Useful for private/internal advisories not in public databases.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cveId` | string | required | CVE identifier (e.g. `CVE-2024-9999`) |
| `package` | string | required | Package name (must match an indexed dependency) |
| `severity` | number | - | CVSS v3.1 base score (0.0–10.0) |
| `summary` | string | - | Human-readable description (truncated to 500 chars) |
| `fixedVersion` | string | - | Version that fixes the vulnerability |
| `projectPath` | string | cwd | Project root path |

## CycloneDX Output Format

### SBOM

The SBOM exporter produces CycloneDX 1.5 JSON with:

- **Metadata**: tool name, version, ISO 8601 UTC timestamp, project identifier
- **Components**: each dependency as a `library` component with:
  - Package name and version (or declared constraint)
  - Package URL (purl): `pkg:<ecosystem>/<name>@<version>`
  - Scope: `required` (direct) or `optional` (transitive)
- **Dependencies**: relationships reflecting `depends_on` edges in the graph

Example purl formats:
- `pkg:npm/express@4.18.2`
- `pkg:maven/org.apache.logging.log4j/log4j-core@2.17.0`
- `pkg:golang/github.com/gin-gonic/gin@1.9.1`
- `pkg:pypi/django@4.2.0`
- `pkg:cargo/serde@1.0.188`

### VEX

The VEX exporter produces CycloneDX 1.5 VEX JSON with one entry per vulnerability:

| Reachability Verdict | VEX Analysis State | Justification | Detail |
|---------------------|-------------------|---------------|--------|
| `affected` | `affected` | — | Entry points, layers traversed, path length |
| `not_affected` | `not_affected` | `code_not_reachable` | No reachable path from any entry point |
| `under_investigation` | `under_investigation` | — | Unresolved symbols or pending analysis |

## Reachability Verdicts

KiroGraph-Sec classifies each vulnerability using BFS traversal from application entry points:

### `affected`

At least one path exists from an entry point to the vulnerable dependency through call, import, or reference edges. The shortest path from each reaching entry point is recorded.

### `not_affected`

No path exists from any entry point to the vulnerable dependency, and no unresolved imports were encountered during traversal. This is the strongest signal that the vulnerability is not exploitable in your deployment.

### `under_investigation`

The traversal encountered at least one unresolved import or symbol whose outgoing edges could not be determined. The vulnerability *might* be reachable through the unresolved path. Up to 50 unresolved symbol identifiers are listed.

## Supported Ecosystems

| Ecosystem | Manifest | Lock File | OSV Ecosystem | Purl Prefix |
|-----------|----------|-----------|---------------|-------------|
| npm | `package.json` | `package-lock.json`, `yarn.lock` | `npm` | `pkg:npm/` |
| Maven | `pom.xml` | — | `Maven` | `pkg:maven/` |
| Gradle | `build.gradle`, `build.gradle.kts` | `gradle.lockfile` | `Maven` | `pkg:maven/` |
| Go | `go.mod` | `go.sum` | `Go` | `pkg:golang/` |
| pip | `requirements.txt` | — | `PyPI` | `pkg:pypi/` |
| Cargo | `Cargo.toml` | `Cargo.lock` | `crates.io` | `pkg:cargo/` |
| NuGet | `*.csproj`, `packages.config` | `packages.lock.json` | `NuGet` | `pkg:nuget/` |
| RubyGems | `Gemfile` | `Gemfile.lock` | `RubyGems` | `pkg:gem/` |
| Composer | `composer.json` | `composer.lock` | `Packagist` | `pkg:composer/` |
| Swift PM | `Package.swift` | `Package.resolved` | `SwiftURL` | `pkg:swift/` |
| Dart/Flutter | `pubspec.yaml` | `pubspec.lock` | `Pub` | `pkg:pub/` |
| Elixir/Hex | `mix.exs` | `mix.lock` | `Hex` | `pkg:hex/` |

### Scope Mapping

| Ecosystem | Production | Development | Optional |
|-----------|-----------|-------------|----------|
| npm | `dependencies` | `devDependencies` | `optionalDependencies` |
| Maven | `compile`, `runtime` | `test` | `provided`, `system` |
| Gradle | `implementation`, `api`, etc. | `testImplementation`, `testApi` | — |
| Go | `require` | — | — |
| pip | default | — | — |
| Cargo | `[dependencies]` | `[dev-dependencies]`, `[build-dependencies]` | — |
| NuGet | default | `PrivateAssets="all"` | — |
| RubyGems | default | `group :development`, `group :test` | — |
| Composer | `require` | `require-dev` | — |
| Swift PM | all (no dev-dep concept) | — | — |
| Dart/Flutter | `dependencies` | `dev_dependencies` | — |
| Elixir/Hex | default | `only: :dev`, `only: :test` | — |

## Limitations

- **Reachability is conservative**: If the call graph has unresolved symbols (dynamic dispatch, reflection, eval), the verdict defaults to `under_investigation` rather than `not_affected`.
- **Transitive depth**: Transitive dependencies are resolved up to 10 levels. Deeper chains are marked `incomplete`.
- **Lock file dependency**: Resolved versions require a lock file. Without one, the declared constraint is used and transitive resolution is incomplete.
- **OSV coverage**: The OSV database is comprehensive but may not cover all ecosystems equally. Private/internal vulnerabilities must be registered manually via `kirograph vulns --add` or `kirograph_vuln_add`.
- **Performance**: Reachability analysis completes within 5 seconds for projects with up to 50,000 graph nodes. Larger projects may experience longer analysis times.
- **Vulnerability database timeout**: Each dependency query has a 30-second timeout. Unreachable databases result in stale data (clearly marked).
- **Architecture dependency**: The security module requires `enableArchitecture: true`. Without it, layer classification is omitted from impact summaries but reachability analysis still works using call graph edges.
