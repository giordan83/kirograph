# KiroGraph

![KiroGraph terminal](assets/kirograph.png)

Semantic code knowledge graph for [Kiro](https://kiro.dev): fewer tool calls, instant symbol lookups, 100% local.

Inspired by [CodeGraph](https://github.com/colbymchenry/codegraph) by [colbymchenry](https://github.com/colbymchenry) for Claude Code, rebuilt natively for Kiro's MCP and hooks system.

## Why KiroGraph?

When you ask Kiro to work on a complex task, it explores your codebase using file reads, grep, and glob searches. Every one of those is a tool call, and tool calls consume context and slow things down.

KiroGraph gives Kiro a semantic knowledge graph that's pre-indexed and always up to date. Instead of scanning files to understand your code, Kiro queries the graph instantly: symbol relationships, call graphs, type hierarchies, impact radius — all in a single MCP tool call.

The result is fewer tool calls, less context used, and faster responses on complex tasks.

## What Gets Indexed?

KiroGraph uses [tree-sitter](https://tree-sitter.github.io/tree-sitter/) to parse your source files into an AST and extract:

- **Nodes** — functions, methods, classes, interfaces, types, enums, variables, constants, routes, components, and more (24 node kinds total)
- **Edges** — calls, imports, exports, extends, implements, contains, references, instantiates, overrides, decorates, type_of, returns

Everything is stored in a local SQLite database (`.kirograph/kirograph.db`). **Nothing leaves your machine.** No API keys. No external services.

The index is kept fresh automatically via Kiro hooks — no background watcher process needed.

## How Indexing Works

Indexing has two layers: **structural** (always on) and **semantic** (opt-in).

### Structural indexing

tree-sitter parses every source file into an AST. Nodes and edges are extracted and written to `kirograph.db`. This is what powers all graph traversal tools (`kirograph_callers`, `kirograph_impact`, `kirograph_path`, etc.) and exact/FTS symbol search.

This layer has no extra dependencies and runs on every `kirograph index` or `kirograph sync`.

### Semantic indexing (opt-in)

When `enableEmbeddings: true` is set, KiroGraph additionally generates 768-dimensional vector embeddings for every embeddable symbol (`function`, `method`, `class`, `interface`, `type_alias`, `component`, `module`) using the `nomic-ai/nomic-embed-text-v1.5` model (~130MB, downloaded once to `~/.kirograph/models/`).

These embeddings power natural-language search in `kirograph_context` and act as a fallback in `kirograph_search`. The embeddings are stored in the **semantic engine** of your choice:

| Engine | Store | Search type | Extra deps |
|--------|-------|-------------|------------|
| `cosine` *(default)* | `kirograph.db` (`vectors` table) | Exact cosine, linear scan | none |
| `sqlite-vec` | `.kirograph/vec.db` | ANN (approximate), sub-linear | `better-sqlite3`, `sqlite-vec` (native) |
| `orama` | `.kirograph/orama.json` | Hybrid (full-text + vector) | `@orama/orama`, `@orama/plugin-data-persistence` |
| `pglite` | `.kirograph/pglite/` | Hybrid (full-text + vector), exact | `@electric-sql/pglite` (WASM) |
| `lancedb` | `.kirograph/lancedb/` | ANN (approximate), sub-linear | `@lancedb/lancedb` (pure JS) |
| `qdrant` | `.kirograph/qdrant/` | ANN (HNSW), sub-linear | `qdrant-local` (embedded binary) |
| `typesense` | `.kirograph/typesense/` | ANN (HNSW), sub-linear | `typesense` (auto-downloaded binary) |

Each engine owns its embedding store exclusively — nothing is written to the SQLite `vectors` table when a non-cosine engine is active. If an engine's optional dependency is not installed, KiroGraph silently falls back to `cosine`.

Enable and configure via `kirograph install` (interactive arrow-key menu) or directly in `.kirograph/config.json`:

```json
{
  "enableEmbeddings": true,
  "semanticEngine": "pglite"
}
```

## Installation

### From npm (recommended)

```bash
npm install -g kirograph
```

### From source

```bash
git clone https://github.com/davide-desio-eleva/kirograph.git
cd kirograph
npm install
npm run build
sudo npm install -g .
```

After building, the `kirograph` and `kg` commands are available globally.

### Verify

```bash
kirograph --version
```

## Quick Start

```bash
# In your project:
kirograph install    # wire up MCP + hooks + steering + CLI agent in .kiro/
```

Restart Kiro IDE, or switch to the `kirograph` agent in Kiro CLI. It will now use KiroGraph tools automatically.

Or using the short alias:

```bash
kg install
```

## How It Works

```
┌─────────────────────────────────────────┐
│                  Kiro                   │
│                                         │
│  "Fix the auth bug"                     │
│           │                             │
│           ▼                             │
│  kirograph_context("auth bug")          │
│           │                             │
└───────────┼─────────────────────────────┘
            ▼
┌───────────────────────────────────────────┐
│         KiroGraph MCP Server              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │  search  │ │ callers  │ │ context  │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘   │
│       └────────────┼────────────┘         │
│         SQLite Graph DB (.kirograph/)     │
└───────────────────────────────────────────┘
```

Kiro hooks mark the index dirty on every file save or create, then flush on agent idle — batching changes efficiently with no overhead during active editing.

## Using with Kiro

`kirograph install` sets up four things in your Kiro workspace — all coexist, so you can switch between IDE and CLI freely:

### MCP Server (`.kiro/settings/mcp.json`)

Registers the KiroGraph MCP server. Used by both the IDE and the CLI agent:

```json
{
  "mcpServers": {
    "kirograph": {
      "command": "kirograph",
      "args": ["serve", "--mcp"],
      "autoApprove": [
        "kirograph_search", "kirograph_context", "kirograph_callers",
        "kirograph_callees", "kirograph_impact", "kirograph_node",
        "kirograph_status", "kirograph_files", "kirograph_dead_code",
        "kirograph_circular_deps", "kirograph_path", "kirograph_type_hierarchy"
      ]
    }
  }
}
```

### IDE Auto-Sync Hooks (`.kiro/hooks/`)

Four hooks keep the index fresh automatically in the Kiro IDE:

| Hook | Event | Action |
|------|-------|--------|
| `kirograph-mark-dirty-on-save.json` | `fileEdited` | `kirograph mark-dirty` |
| `kirograph-mark-dirty-on-create.json` | `fileCreated` | `kirograph mark-dirty` |
| `kirograph-sync-on-delete.json` | `fileDeleted` | `kirograph sync-if-dirty` |
| `kirograph-sync-if-dirty.json` | `agentStop` | `kirograph sync-if-dirty --quiet` |

File changes are batched: saves and creates write a dirty marker; the actual sync runs when the agent stops. Deletes sync immediately. This means no overhead during active editing.

Hooks fire for: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, `.cs`, `.rb`, `.php`, `.swift`, `.kt`, `.dart`

### CLI Agent Config (`.kiro/agents/kirograph.json`)

A custom agent for Kiro CLI that wires up the MCP server, inlines the steering instructions as a prompt, and handles sync in the CLI's own hook format. The CLI has no file-watch events, so syncing is handled at session boundaries instead:

| Hook | Event | Action |
|------|-------|--------|
| `agentSpawn` | Agent starts | `kirograph sync-if-dirty --quiet` — catches edits made between sessions |
| `userPromptSubmit` | Each prompt | `kirograph sync-if-dirty --quiet` — keeps graph fresh within a session |
| `stop` | End of each turn | `kirograph sync-if-dirty --quiet` — deferred flush, mirrors IDE `agentStop` |

Use it with:

```bash
kiro-cli --agent kirograph
```

Or swap to it inside an active session:

```
/agent swap kirograph
```

> Note: restart `kiro-cli` after running `kirograph install` for the agent to be picked up.

### Steering File (`.kiro/steering/kirograph.md`)

Teaches the Kiro IDE to prefer graph tools over file scanning when `.kirograph/` exists. The CLI agent has the same instructions inlined directly in its `prompt` field.

## MCP Tools

All 12 tools are auto-approved and available to Kiro once installed.

### `kirograph_context`

Comprehensive context for a task or feature — often sufficient alone without additional tool calls.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `task` | string | required | Task, bug, or feature description |
| `maxNodes` | number | 20 | Max symbols to include |
| `includeCode` | boolean | true | Include code snippets |
| `projectPath` | string | cwd | Project root path |

**How it works:** Extracts symbol tokens from the task description (CamelCase, snake_case, SCREAMING_SNAKE, dot.notation) → runs exact name lookup + FTS + **vector search** against the active semantic engine → resolves imports to their definitions → expands through the graph to related symbols → returns entry points, related nodes, edges, and code snippets. This is the only tool that uses the vector engine on every call.

### `kirograph_search`

Quick symbol search by name. Returns locations only, no code.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | required | Symbol name or partial name |
| `kind` | string | — | Filter: `function`, `method`, `class`, `interface`, `type_alias`, `variable`, `route`, `component` |
| `limit` | number | 10 | Max results (1–100) |
| `projectPath` | string | cwd | Project root path |

**How it works:** Exact name match → SQLite FTS → LIKE fallback → **vector search** only if all three return nothing. Pure graph database lookup in the common case; vector engine only as a last resort.

### `kirograph_callers`

Find all functions/methods that call a specific symbol.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `symbol` | string | required | Symbol name |
| `limit` | number | 20 | Max results (1–100) |
| `projectPath` | string | cwd | Project root path |

**How it works:** BFS traversal of incoming `call` edges in the graph database. No vector engine involved.

### `kirograph_callees`

Find all functions/methods that a specific symbol calls.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `symbol` | string | required | Symbol name |
| `limit` | number | 20 | Max results (1–100) |
| `projectPath` | string | cwd | Project root path |

**How it works:** BFS traversal of outgoing `call` edges in the graph database. No vector engine involved.

### `kirograph_impact`

Analyze what code would be affected by changing a symbol. Use before making changes.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `symbol` | string | required | Symbol name |
| `depth` | number | 2 | Traversal depth |
| `projectPath` | string | cwd | Project root path |

**How it works:** BFS traversal of all incoming edges (`call`, `import`, `reference`, etc.) up to the specified depth. No vector engine involved.

### `kirograph_node`

Get details about a specific symbol, optionally including source code.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `symbol` | string | required | Symbol name |
| `includeCode` | boolean | false | Include source code |
| `projectPath` | string | cwd | Project root path |

Returns: kind, name, qualified name, file location, signature, docstring, and optionally source code.

**How it works:** Single row lookup by symbol name in the graph database. If `includeCode` is true, reads the relevant lines directly from the source file on disk. No vector engine involved.

### `kirograph_type_hierarchy`

Traverse the type hierarchy of a class or interface.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `symbol` | string | required | Class or interface name |
| `direction` | string | `both` | `up` (base types), `down` (derived types), `both` |
| `projectPath` | string | cwd | Project root path |

**How it works:** Recursive traversal of `extends` and `implements` edges in the graph database. No vector engine involved.

### `kirograph_path`

Find the shortest path between two symbols in the dependency graph.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `from` | string | required | Source symbol name |
| `to` | string | required | Target symbol name |
| `projectPath` | string | cwd | Project root path |

**How it works:** BFS shortest-path search across all edge types in the graph database. No vector engine involved.

### `kirograph_dead_code`

Find symbols with no incoming references (potential dead code). Only unexported symbols are considered.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Max results (1–100) |
| `projectPath` | string | cwd | Project root path |

**How it works:** Queries the graph database for nodes with zero incoming edges, filtered to non-exported symbols. No vector engine involved.

### `kirograph_circular_deps`

Find circular import dependencies in the codebase.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectPath` | string | cwd | Project root path |

**How it works:** Tarjan's strongly connected components algorithm over `import` edges in the graph database. No vector engine involved.

### `kirograph_files`

List the indexed file structure with filtering and format options.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `filterPath` | string | — | Filter by directory prefix (e.g., `src/`) |
| `pattern` | string | — | Filter by glob pattern (e.g., `**/*.ts`) |
| `maxDepth` | number | — | Limit tree depth |
| `format` | string | `tree` | `tree`, `flat`, or `grouped` |
| `includeMetadata` | boolean | true | Include language and symbol counts |
| `projectPath` | string | cwd | Project root path |

**How it works:** Reads file records from the graph database and builds a tree structure in memory. Filtering is applied before tree construction. No vector engine involved.

### `kirograph_status`

Check index health and statistics: files indexed, symbol count, edge count, breakdown by kind and language, frameworks detected, database size, and semantic search status.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectPath` | string | cwd | Project root path |

**How it works:** Reads aggregate counts from the graph database + calls `count()` on the active vector engine to report embedding coverage. No graph traversal, no vector search.

## CLI Reference

### Setup

```bash
kirograph install                 # Wire up MCP + hooks + steering in .kiro/
kirograph init [path]             # Initialize .kirograph/ in a project
kirograph init --index            # Initialize and index immediately
kirograph uninit [path]           # Remove .kirograph/, hooks, and steering file
kirograph uninit --force          # Skip confirmation prompt
```

### Indexing

```bash
kirograph index [path]            # Full re-index of the project
kirograph index --force           # Force re-index all files (ignore hash cache)
kirograph sync [path]             # Incremental sync of changed files
kirograph sync --files a.ts b.ts  # Sync specific files only
kirograph sync-if-dirty [path]    # Sync only if a dirty marker is present
kirograph mark-dirty [path]       # Write a dirty marker for deferred sync
```

### Status & Maintenance

```bash
kirograph status [path]           # Show index stats (files, symbols, edges, frameworks)
kirograph unlock [path]           # Force-release a stale lock file
```

### Search & Exploration

```bash
kirograph query <term>                    # Search symbols by name
kirograph query <term> --kind class       # Filter by kind
kirograph query <term> --limit 20         # Limit results (default: 10)
```

Supported kinds: `function`, `method`, `class`, `struct`, `interface`, `trait`, `protocol`, `enum`, `type_alias`, `property`, `field`, `variable`, `constant`, `enum_member`, `parameter`, `import`, `export`, `route`, `component`, `file`, `module`, `namespace`

### File Structure

```bash
kirograph files [path]                     # Show indexed file tree
kirograph files --format flat              # Flat list of all files
kirograph files --format grouped           # Files grouped by language
kirograph files --filter src/components    # Filter by directory prefix
kirograph files --pattern "**/*.test.ts"   # Filter by glob pattern
kirograph files --max-depth 2              # Limit tree depth
kirograph files --no-metadata              # Hide language/symbol counts
kirograph files --json                     # Output as JSON
```

### Context Building

```bash
kirograph context "fix checkout bug"
kirograph context "add user authentication" --format json
kirograph context "refactor payment service" --max-nodes 30
kirograph context "validate token" --no-code
```

Extracts symbol tokens from the task description (CamelCase, snake_case, SCREAMING_SNAKE, dot.notation), finds relevant entry points, expands through the graph, and outputs structured markdown or JSON.

### Affected Tests

Find test files that depend on changed source files — useful in CI or pre-commit hooks.

```bash
kirograph affected src/utils.ts src/api.ts           # Pass files as arguments
git diff --name-only | kirograph affected --stdin     # Pipe from git diff
kirograph affected --stdin --json < changed.txt       # JSON output
kirograph affected src/auth.ts --filter "e2e/**"      # Custom test file glob
kirograph affected src/lib.ts --depth 3 --quiet       # Paths only, shallow traversal
```

| Option | Description | Default |
|--------|-------------|---------|
| `--stdin` | Read file list from stdin, one per line | false |
| `-d, --depth <n>` | Max dependency traversal depth | 5 |
| `-f, --filter <glob>` | Custom glob to identify test files | auto-detect |
| `-j, --json` | Output as JSON | false |
| `-q, --quiet` | Output file paths only | false |
| `-p, --path <path>` | Project path | cwd |

Example CI integration:

```bash
#!/usr/bin/env bash
AFFECTED=$(git diff --name-only HEAD | kirograph affected --stdin --quiet)
if [ -n "$AFFECTED" ]; then
  npx vitest run $AFFECTED
fi
```

### Dashboard

When `semanticEngine` is set to `qdrant` or `typesense`, use these commands to manage the background server and its dashboard UI.

```bash
kirograph dashboard start [path]   # Start server (if not running) and open dashboard
kirograph dashboard stop [path]    # Stop the running engine server
```

**`dashboard start`**

Reads `semanticEngine` from `.kirograph/config.json` and dispatches accordingly:

- **qdrant**: Downloads the [Qdrant Web UI](https://github.com/qdrant/qdrant-web-ui) on first use (cached at `.kirograph/qdrant/dashboard/`), spawns the Qdrant server with `QDRANT__SERVICE__STATIC_CONTENT_DIR` set so the dashboard is served natively, and opens `http://127.0.0.1:<port>/dashboard` in your browser. If the server is already running with the dashboard, reconnects instead of restarting.
- **typesense**: Downloads the [Typesense Dashboard](https://github.com/bfritscher/typesense-dashboard) static UI on first use (cached at `.kirograph/typesense/dashboard/`), starts the Typesense server if not already running, serves the dashboard locally via a Node HTTP server, and opens it in your browser. Press Ctrl+C to stop the dashboard server — the Typesense server keeps running as a background daemon.

Both servers run as persistent daemons. The state file (`.kirograph/qdrant-server.json` or `.kirograph/typesense-server.json`) tracks the PID and port for reconnection across `kg` commands.

**`dashboard stop`**

Reads `semanticEngine` from config and sends SIGTERM to the running background process, then removes the state file. Does nothing if no server is running.

### MCP Server

```bash
kirograph serve --mcp                      # Start MCP server (used by Kiro)
kirograph serve --mcp --path /my/project   # Specify project path
```

## Configuration

KiroGraph stores its config in `.kirograph/config.json`. You can edit it directly.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `languages` | string[] | `[]` | Limit indexing to specific languages (empty = all) |
| `include` | string[] | `[]` | Glob patterns to include (empty = include everything not excluded) |
| `exclude` | string[] | see below | Glob patterns to exclude |
| `maxFileSize` | number | `1048576` | Skip files larger than this (bytes) |
| `extractDocstrings` | boolean | `true` | Extract JSDoc, docstrings, and comments |
| `trackCallSites` | boolean | `true` | Record line/column for call edges |
| `enableEmbeddings` | boolean | `false` | Generate semantic embeddings (opt-in, ~130MB model) |
| `embeddingModel` | string | `nomic-ai/nomic-embed-text-v1.5` | HuggingFace model for embeddings |
| `semanticEngine` | string | `cosine` | Search engine: `cosine`, `sqlite-vec`, `orama`, `pglite`, `lancedb`, `qdrant`, or `typesense` (see below) |
| `useVecIndex` | boolean | `false` | Deprecated alias for `semanticEngine: "sqlite-vec"` |
| `minLogLevel` | string | `warn` | Log level: `debug`, `info`, `warn`, `error` |
| `fuzzyResolutionThreshold` | number | `0.5` | Name matching threshold for cross-file resolution (0.0–1.0) |

Default exclude patterns: `node_modules/**`, `dist/**`, `build/**`, `.git/**`, `*.min.js`, `.kirograph/**`

### Semantic Search (Optional)

By default, KiroGraph uses exact name lookup and full-text search. Enable semantic search for natural-language queries:

```json
{
  "enableEmbeddings": true
}
```

This downloads the `nomic-ai/nomic-embed-text-v1.5` model (~130MB) to `~/.kirograph/models/` on first use and generates 768-dimensional vector embeddings for all functions, methods, classes, interfaces, type aliases, components, and modules. Embeddings are kept in sync automatically via Kiro hooks — on every file save, create, or delete.

Run `kirograph install` to be guided through engine selection interactively with an arrow-key menu, or set `semanticEngine` in `.kirograph/config.json` manually.

#### Storage architecture

Each engine owns its embedding store exclusively — there is no redundant write to the main graph database:

| Engine | Graph store | Vector store |
|--------|-------------|--------------|
| `cosine` | `kirograph.db` (SQLite) | `kirograph.db` (`vectors` table) |
| `sqlite-vec` | `kirograph.db` (SQLite) | `.kirograph/vec.db` (sqlite-vec) |
| `orama` | `kirograph.db` (SQLite) | `.kirograph/orama.json` (Orama) |
| `pglite` | `kirograph.db` (SQLite) | `.kirograph/pglite/` (PGlite+pgvector) |
| `lancedb` | `kirograph.db` (SQLite) | `.kirograph/lancedb/` (Apache Lance) |
| `qdrant` | `kirograph.db` (SQLite) | `.kirograph/qdrant/` (Qdrant embedded) |
| `typesense` | `kirograph.db` (SQLite) | `.kirograph/typesense/` (Typesense embedded) |

The graph store (`kirograph.db`) always holds nodes, edges, files, and all structural data regardless of which engine is active.

#### Engine comparison

| Engine | Search type | Extra deps | Native? | Best for |
|--------|-------------|------------|---------|----------|
| `cosine` *(default)* | Exact cosine, linear scan | none | — | Small / medium projects, zero setup |
| `sqlite-vec` | ANN (approximate), sub-linear | `better-sqlite3`, `sqlite-vec` | yes | Large codebases, fast ANN search |
| `orama` | Hybrid (full-text + vector) | `@orama/orama`, `@orama/plugin-data-persistence` | no (pure JS) | Best result quality, no native deps |
| `pglite` | Hybrid (full-text + vector), exact | `@electric-sql/pglite` | no (pure WASM) | Exact results, no native deps, PostgreSQL semantics |
| `lancedb` | ANN (approximate), sub-linear | `@lancedb/lancedb` | no (pure JS) | Fast ANN search, no native compilation required |
| `qdrant` | ANN (HNSW), sub-linear | `qdrant-local` | yes (binary) | Full Qdrant feature set, HNSW index, embedded binary |
| `typesense` | ANN (HNSW), sub-linear | `typesense` | yes (binary) | Fast ANN search, auto-downloaded binary, no manual install |

All non-cosine engines fall back silently to `cosine` if their optional dependencies are not installed.

#### cosine (default)

In-process cosine similarity over all stored embeddings. No extra dependencies. Embeddings are stored in the `vectors` table inside `kirograph.db`.

```json
{
  "enableEmbeddings": true,
  "semanticEngine": "cosine"
}
```

#### sqlite-vec

Approximate nearest-neighbour (ANN) index stored in `.kirograph/vec.db`. Sub-linear search time — ideal for large codebases with thousands of indexed symbols. The SQLite `vectors` table is not written to; `vec.db` is the sole embedding store.

```json
{
  "enableEmbeddings": true,
  "semanticEngine": "sqlite-vec"
}
```

```bash
npm install better-sqlite3 sqlite-vec
```

Requires two native dependencies (compiled C extensions). If not installed, falls back to `cosine`.

#### orama

Hybrid search powered by [Orama](https://github.com/oramasearch/orama) — combines full-text relevance and vector similarity in a **single query**, producing higher-quality results than running the two searches separately. The index is persisted to `.kirograph/orama.json` and is the sole embedding store. Pure JS, no native compilation required.

```json
{
  "enableEmbeddings": true,
  "semanticEngine": "orama"
}
```

```bash
npm install @orama/orama @orama/plugin-data-persistence
```

If not installed, falls back to `cosine`.

#### pglite

Hybrid search powered by [PGlite](https://github.com/electric-sql/pglite) — a WASM-compiled PostgreSQL with the [pgvector](https://github.com/pgvector/pgvector) extension. Combines **exact** nearest-neighbour vector search with full-text ranking (`ts_rank`) in a single SQL query. The database is persisted to `.kirograph/pglite/` using PostgreSQL's WAL-based storage and is the sole embedding store. Pure WASM — no native compilation required.

```json
{
  "enableEmbeddings": true,
  "semanticEngine": "pglite"
}
```

```bash
npm install @electric-sql/pglite
```

Key advantages:
- **Exact** vector results (not approximate) — deterministic and reproducible
- Native SQL `ON CONFLICT` upsert — no remove+insert workaround
- HNSW index (`vector_cosine_ops`) keeps search fast as the index grows
- Single dependency, zero native binaries

If not installed, falls back to `cosine`.

#### LanceDB

ANN vector search powered by [LanceDB](https://github.com/lancedb/lancedb) — stores embeddings in Apache Lance columnar format at `.kirograph/lancedb/`. Sub-linear search time using cosine distance. Pure JS, no native compilation required.

```json
{
  "enableEmbeddings": true,
  "semanticEngine": "lancedb"
}
```

```bash
npm install @lancedb/lancedb
```

Key characteristics:
- **Columnar storage** (Apache Lance format) — efficient for batch reads and writes
- **ANN cosine search** — fast, sub-linear query time
- Pure JS — no native binaries or WASM required

If not installed, falls back to `cosine`.

#### qdrant

ANN vector search powered by [Qdrant](https://github.com/qdrant/qdrant) running in embedded mode. The engine spawns the Qdrant binary as a managed child process, persisting data to `.kirograph/qdrant/`. Uses [`@qdrant/qdrant-js`](https://github.com/qdrant/qdrant-js) as the REST client.

```json
{
  "enableEmbeddings": true,
  "semanticEngine": "qdrant"
}
```

```bash
npm install qdrant-local
```

Key characteristics:
- **HNSW index** — high-quality ANN search with Qdrant's native indexing
- **Embedded binary** — no separate server setup; the process is spawned and managed automatically
- **Persistent daemon** — the server stays running between `kg` commands; state tracked in `.kirograph/qdrant-server.json`
- **Built-in dashboard** — run `kg dashboard start` to download the [Qdrant Web UI](https://github.com/qdrant/qdrant-web-ui) and open it (cached at `.kirograph/qdrant/dashboard/`, served via Qdrant's built-in static content feature)
- **Async startup** — polls `/readyz` instead of blocking with a fixed sleep
- **Cosine distance** metric
- Data persists across restarts in `.kirograph/qdrant/`

Manage the server:

```bash
kirograph dashboard start   # start server + open dashboard
kirograph dashboard stop    # stop server
```

If not installed, falls back to `cosine`.

#### typesense

ANN vector search powered by [Typesense](https://github.com/typesense/typesense) running in embedded mode. The engine automatically downloads the Typesense server binary (~37 MB, cached at `~/.kirograph/bin/`) on first use and spawns it as a managed child process. Uses the official [`typesense`](https://www.npmjs.com/package/typesense) Node.js client.

```json
{
  "enableEmbeddings": true,
  "semanticEngine": "typesense"
}
```

```bash
npm install typesense
```

Key characteristics:
- **HNSW index** — high-quality ANN search with Typesense's native indexing
- **Auto-downloaded binary** — no manual server setup; the binary is fetched and cached at `~/.kirograph/bin/` on first run
- **Persistent daemon** — the server stays running between `kg` commands; state tracked in `.kirograph/typesense-server.json`
- **Local dashboard** — run `kg dashboard start` to open the built-in Typesense Dashboard UI (served locally, cached at `.kirograph/typesense/dashboard/`)
- **Async startup** — polls `/health` instead of blocking with a fixed sleep
- **Cosine distance** metric
- Data persists across restarts in `.kirograph/typesense/`

Manage the server:

```bash
kirograph dashboard start   # start server + open dashboard
kirograph dashboard stop    # stop server
```

If not installed (or binary download fails), falls back to `cosine`.

## Supported Languages

| Language | Extensions |
|----------|-----------|
| TypeScript | `.ts` |
| JavaScript | `.js` |
| TSX | `.tsx` |
| JSX | `.jsx` |
| Python | `.py` |
| Go | `.go` |
| Rust | `.rs` |
| Java | `.java` |
| C | `.c`, `.h` |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp` |
| C# | `.cs` |
| PHP | `.php` |
| Ruby | `.rb` |
| Swift | `.swift` |
| Kotlin | `.kt` |
| Dart | `.dart` |
| Svelte | `.svelte` |

## Framework Detection

KiroGraph automatically detects frameworks and enriches the graph with framework-specific semantics (routes, components, lifecycle methods):

**JavaScript / TypeScript:** React, Next.js, React Native, Svelte, SvelteKit, Express, Fastify, Koa

**Python:** Django, Flask, FastAPI

**Ruby:** Rails

**Java:** Spring, Spring Boot, Spring MVC

**Go:** generic Go resolver

**Rust:** generic Rust resolver

**C#:** ASP.NET Core

**Swift:** SwiftUI, UIKit, Vapor

**PHP:** Laravel

Detected frameworks are stored in config and used to improve symbol extraction and resolution.

## Requirements

- Node.js >= 18
- Kiro IDE

## License

MIT
