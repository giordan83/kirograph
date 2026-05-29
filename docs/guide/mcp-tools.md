# MCP Tools

All tools are auto-approved in Kiro once installed. Other MCP clients can use the same tools after configuring their respective targets.

## `kirograph_context`

Comprehensive context for a task or feature, often sufficient alone without additional tool calls.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `task` | string | required | Task, bug, or feature description |
| `maxNodes` | number | 20 | Max symbols to include |
| `includeCode` | boolean | true | Include code snippets |
| `projectPath` | string | cwd | Project root path |

**How it works:** Extracts symbol tokens from the task description (CamelCase, snake_case, SCREAMING_SNAKE, dot.notation) → runs exact name lookup + FTS + **vector search** against the active semantic engine → resolves imports to their definitions → expands through the graph to related symbols → returns entry points, related nodes, edges, and code snippets. This is the only tool that uses the vector engine on every call.

## `kirograph_search`

Quick symbol search by name. Returns locations only, no code.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | required | Symbol name or partial name |
| `kind` | string | - | Filter: `function`, `method`, `class`, `interface`, `type_alias`, `variable`, `route`, `component` |
| `limit` | number | 10 | Max results (1–100) |
| `projectPath` | string | cwd | Project root path |

**How it works:** Exact name match → SQLite FTS → LIKE fallback → **vector search** only if all three return nothing. Pure graph database lookup in the common case; vector engine only as a last resort.

## `kirograph_callers`

Find all functions/methods that call a specific symbol.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `symbol` | string | required | Symbol name |
| `limit` | number | 20 | Max results (1–100) |
| `projectPath` | string | cwd | Project root path |

**How it works:** BFS traversal of incoming `call` edges in the graph database; no vector engine involved.

## `kirograph_callees`

Find all functions/methods that a specific symbol calls.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `symbol` | string | required | Symbol name |
| `limit` | number | 20 | Max results (1–100) |
| `projectPath` | string | cwd | Project root path |

**How it works:** BFS traversal of outgoing `call` edges in the graph database; no vector engine involved.

## `kirograph_impact`

Analyze what code would be affected by changing a symbol. Use before making changes.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `symbol` | string | required | Symbol name |
| `depth` | number | 2 | Traversal depth |
| `projectPath` | string | cwd | Project root path |

**How it works:** BFS traversal of all incoming edges (`call`, `import`, `reference`, etc.) up to the specified depth; no vector engine involved.

## `kirograph_node`

Get details about a specific symbol, optionally including source code.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `symbol` | string | required | Symbol name |
| `includeCode` | boolean | false | Include source code |
| `projectPath` | string | cwd | Project root path |

Returns: kind, name, qualified name, file location, signature, docstring, and optionally source code.

## `kirograph_type_hierarchy`

Traverse the type hierarchy of a class or interface.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `symbol` | string | required | Class or interface name |
| `direction` | string | `both` | `up` (base types), `down` (derived types), `both` |
| `projectPath` | string | cwd | Project root path |

## `kirograph_path`

Find the shortest path between two symbols in the dependency graph.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `from` | string | required | Source symbol name |
| `to` | string | required | Target symbol name |
| `projectPath` | string | cwd | Project root path |

## `kirograph_dead_code`

Find symbols with no incoming references (potential dead code). Only unexported symbols are considered.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Max results (1–100) |
| `projectPath` | string | cwd | Project root path |

## `kirograph_circular_deps`

Find circular import dependencies in the codebase.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectPath` | string | cwd | Project root path |

## `kirograph_files`

List the indexed file structure with filtering and format options.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `filterPath` | string | - | Filter by directory prefix (e.g., `src/`) |
| `pattern` | string | - | Filter by glob pattern (e.g., `**/*.ts`) |
| `maxDepth` | number | - | Limit tree depth |
| `format` | string | `tree` | `tree`, `flat`, or `grouped` |
| `includeMetadata` | boolean | true | Include language and symbol counts |
| `projectPath` | string | cwd | Project root path |

## `kirograph_status`

Check index health and statistics: files indexed, symbol count, edge count, breakdown by kind and language, frameworks detected, database size, and semantic search status.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectPath` | string | cwd | Project root path |

## `kirograph_hotspots`

Find the most-connected symbols by total edge degree (incoming + outgoing). Excludes structural `contains` edges.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 20 | Max results (1–100) |
| `projectPath` | string | cwd | Project root path |

## `kirograph_surprising`

Find non-obvious cross-file connections: direct edges between symbols in structurally distant files.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 20 | Max results (1–100) |
| `projectPath` | string | cwd | Project root path |

**How it works:** Queries all cross-file edges (excluding `contains` and `import`). Scores each by path distance between source and target files × edge-kind weight (`calls=1.0`, `references=0.8`, `type_of=0.7`, etc.). Returns the highest-scoring unique pairs.

## `kirograph_diff`

Compare the current graph state against a saved snapshot. Shows added/removed symbols and edges.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `snapshot` | string | latest | Snapshot label. Omit to use the most recent saved snapshot. |
| `projectPath` | string | cwd | Project root path |

## `kirograph_exec`

Run a shell command and return token-optimized output. Automatically filters noise from git, test runners, linters, build tools, docker, and package managers.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `command` | string | required | Shell command to execute |
| `cwd` | string | project root | Working directory |
| `level` | string | `normal` | Compression level: `normal`, `aggressive`, `ultra` |
| `timeout` | number | 60 | Timeout in seconds |
| `projectPath` | string | cwd | Project root path |

## `kirograph_gain`

Show token savings statistics from compressed command outputs.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `period` | string | `session` | Time period: `session`, `today`, `week`, `all` |
| `projectPath` | string | cwd | Project root path |

---

## Architecture Tools *(require `enableArchitecture: true`)*

### `kirograph_architecture`

Get the full architecture overview: detected packages, layers, and the dependency graph between them.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `level` | string | `both` | `packages`, `layers`, or `both` |
| `includeFiles` | boolean | false | Include per-file package/layer assignments |
| `projectPath` | string | cwd | Project root path |

### `kirograph_coupling`

Get coupling metrics for all packages or a specific one.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sortBy` | string | `instability` | Sort: `instability`, `afferent`, `efferent` |
| `limit` | number | 20 | Max results |
| `projectPath` | string | cwd | Project root path |

Returns per-package: **Ca** (afferent), **Ce** (efferent), and **instability** (`Ce / (Ca + Ce)`).

### `kirograph_package`

Inspect the files and dependencies of a specific package.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `package` | string | required | Package name or path (partial match accepted) |
| `includeFiles` | boolean | true | List files in the package |
| `projectPath` | string | cwd | Project root path |

---

## Memory Tools *(require `enableMemory: true`)*

### `kirograph_mem_search`

Search project memory for past decisions, errors, patterns, and context.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | required | Natural language search query |
| `kind` | string | - | Filter: `decision`, `error`, `pattern`, `architecture`, `summary`, `note` |
| `limit` | number | 10 | Max results |
| `sessionId` | string | - | Filter to specific session |
| `projectPath` | string | cwd | Project root path |

### `kirograph_mem_store`

Store an observation in project memory.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `content` | string | required | Observation text |
| `kind` | string | `note` | `decision`, `error`, `pattern`, `architecture`, `summary`, `note` |
| `projectPath` | string | cwd | Project root path |

### `kirograph_mem_timeline`

List recent sessions and their observations chronologically.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 5 | Number of sessions to show |
| `sessionId` | string | - | Show observations for a specific session |
| `projectPath` | string | cwd | Project root path |

### `kirograph_mem_status`

Memory subsystem health: session count, observations, embedding coverage, model mismatch detection.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectPath` | string | cwd | Project root path |

---

## Documentation Tools *(require `enableDocs: true`)*

### `kirograph_docs_toc`

Get table of contents for a documentation file or the whole project.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `file` | string | - | Filter to a specific doc file. Omit for project-wide TOC. |
| `tree` | boolean | false | Return nested tree structure |
| `projectPath` | string | cwd | Project root path |

### `kirograph_docs_search`

Search documentation sections by query.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | required | Search query (natural language or keywords) |
| `file` | string | - | Narrow search to a specific doc file |
| `limit` | number | 10 | Max results |
| `projectPath` | string | cwd | Project root path |

### `kirograph_docs_section`

Retrieve full content of a documentation section by its stable ID.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `id` | string | required | Section ID (from `kirograph_docs_toc` or `kirograph_docs_search`) |
| `context` | boolean | false | Include ancestor heading chain and child summaries |
| `projectPath` | string | cwd | Project root path |

### `kirograph_docs_outline`

Get the heading hierarchy for a single documentation file.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `file` | string | required | Relative path to the doc file |
| `projectPath` | string | cwd | Project root path |

### `kirograph_docs_refs`

Find code symbols referenced by a doc section, or doc sections that reference a code symbol.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sectionId` | string | - | Doc section ID (find code symbols it references) |
| `nodeId` | string | - | Code symbol qualified name (find doc sections that reference it) |
| `projectPath` | string | cwd | Project root path |

---

## Data Tools *(require `enableData: true`)*

### `kirograph_data_list`

List all indexed datasets with row counts, column counts, and file sizes.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectPath` | string | cwd | Project root path |

### `kirograph_data_describe`

Full schema profile for a dataset: column names, inferred types, cardinality, null percentages, min/max values, and sample values.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `dataset` | string | required | Dataset ID (from `kirograph_data_list`) |
| `column` | string | - | Deep dive on a single column |
| `projectPath` | string | cwd | Project root path |

### `kirograph_data_query`

Filtered row retrieval with structured operators. Multiple filters are ANDed.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `dataset` | string | required | Dataset ID |
| `filters` | Filter[] | - | Array of `{column, op, value}`. Ops: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `in`, `is_null`, `between` |
| `columns` | string[] | all | Column projection |
| `limit` | number | 500 | Max rows (hard cap: 500) |
| `offset` | number | 0 | Pagination offset |
| `projectPath` | string | cwd | Project root path |

### `kirograph_data_aggregate`

Server-side GROUP BY aggregation. Computation happens in SQLite; only results enter the context window.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `dataset` | string | required | Dataset ID |
| `groupBy` | string[] | required | Columns to group by |
| `metrics` | Metric[] | required | Array of `{column, op}`. Ops: `count`, `sum`, `avg`, `min`, `max`, `count_distinct` |
| `filters` | Filter[] | - | Pre-aggregation filters |
| `projectPath` | string | cwd | Project root path |

### `kirograph_data_search`

Search column names and sample values by keyword within a dataset.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `dataset` | string | required | Dataset ID |
| `query` | string | required | Search keyword |
| `projectPath` | string | cwd | Project root path |

### `kirograph_data_join`

SQL JOIN across two indexed datasets.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `left` | string | required | Left dataset ID |
| `right` | string | required | Right dataset ID |
| `leftColumn` | string | required | Join column from left dataset |
| `rightColumn` | string | required | Join column from right dataset |
| `type` | string | `inner` | Join type: `inner`, `left`, `right` |
| `columns` | string[] | all | Column projection (prefix with dataset ID) |
| `limit` | number | 100 | Max rows (hard cap: 500) |
| `projectPath` | string | cwd | Project root path |

### `kirograph_data_correlations`

Pairwise Pearson correlations between numeric columns.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `dataset` | string | required | Dataset ID |
| `threshold` | number | 0.3 | Min absolute correlation to include |
| `projectPath` | string | cwd | Project root path |

### `kirograph_data_quality`

Data quality triage: rank columns by composite risk score (null rate, cardinality anomalies, type issues).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `dataset` | string | required | Dataset ID |
| `projectPath` | string | cwd | Project root path |

---

## Security Tools *(require `enableSecurity: true` and `enableArchitecture: true`)*

### `kirograph_security`

Security overview: total dependencies, vulnerability counts, verdict breakdown (affected/not_affected/under_investigation), and stale data warnings.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectPath` | string | cwd | Project root path |

### `kirograph_vulns`

List vulnerabilities with filtering by severity and reachability verdict. Includes fix suggestions when a fixed version is available.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `severity` | string | - | Filter: `critical`, `high`, `medium`, `low` |
| `verdict` | string | - | Filter: `affected`, `not_affected`, `under_investigation` |
| `limit` | number | 20 | Max results |
| `refresh` | boolean | false | Trigger fresh enrichment from configured databases before listing |
| `projectPath` | string | cwd | Project root path |

**Example response:**

```
CVE-2023-44270 (7.5 HIGH) — postcss
  Verdict: affected
  Paths: 2 entry points reach this dependency
  Layers: api, service
  💡 Fix: npm install postcss@8.4.31
```

### `kirograph_sbom`

Generate a CycloneDX 1.5 SBOM JSON document containing all project dependencies as components with purl identifiers, scope classification, and dependency relationships.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectPath` | string | cwd | Project root path |

### `kirograph_vex`

Generate a CycloneDX 1.5 VEX JSON document with reachability-derived analysis states. Maps graph verdicts to CycloneDX VEX states: `affected` → "affected", `not_affected` → "not_affected" (justification: "code_not_reachable"), `under_investigation` → "under_investigation".

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectPath` | string | cwd | Project root path |

### `kirograph_reachability`

Analyze reachability for a specific CVE or dependency. Returns the verdict, shortest paths from each reaching entry point, unresolved symbols (if any), and impact summary (affected layers, entry points, distinct path count).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target` | string | required | CVE identifier (e.g. `CVE-2024-1234`) or package name (e.g. `lodash`) |
| `projectPath` | string | cwd | Project root path |

**Example response:**

```
CVE-2024-1234 — lodash@4.17.20
  Verdict: affected
  Reaching entry points: 3
  Paths:
    POST /api/users → UserService.create → validateInput → lodash
    GET /api/users → UserService.list → formatResponse → lodash
    POST /api/auth → AuthController.login → sanitize → lodash
  Affected layers: api, service
  Distinct paths: 5
```

### `kirograph_vuln_add`

Manually register a CVE against a dependency. Creates a Vulnerability_Node linked to the matching Dependency_Node. Useful for private/internal advisories not in public databases.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cveId` | string | required | CVE identifier (e.g. `CVE-2024-9999`) |
| `package` | string | required | Package name (must match an existing indexed dependency) |
| `severity` | number | - | CVSS v3.1 base score (0.0–10.0) |
| `summary` | string | - | Human-readable description (truncated to 500 chars) |
| `fixedVersion` | string | - | Version that fixes the vulnerability |
| `projectPath` | string | cwd | Project root path |
