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

## Quick Start

```bash
npm install -g kirograph

# In your project:
kirograph install    # wire up MCP + hooks + steering in .kiro/
kirograph init -i    # create .kirograph/ and index your code
```

Restart Kiro. It will now use KiroGraph tools automatically.

Or using the short alias:

```bash
kg install
kg init -i
kg status
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
│  ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │  search  │ │ callers  │ │ context  │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘  │
│       └────────────┼────────────┘        │
│         SQLite Graph DB (.kirograph/)    │
└───────────────────────────────────────────┘
```

Kiro hooks mark the index dirty on every file save or create, then flush on agent idle — batching changes efficiently with no overhead during active editing.

## Using with Kiro

`kirograph install` sets up three things in your Kiro workspace:

### MCP Server (`.kiro/settings/mcp.json`)

Registers the KiroGraph MCP server so Kiro can call graph tools directly:

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

### Auto-Sync Hooks (`.kiro/hooks/`)

Four hooks keep the index fresh automatically:

| Hook | Event | Action |
|------|-------|--------|
| `kirograph-mark-dirty-on-save.json` | `fileEdited` | `kirograph mark-dirty` |
| `kirograph-mark-dirty-on-create.json` | `fileCreated` | `kirograph mark-dirty` |
| `kirograph-sync-on-delete.json` | `fileDeleted` | `kirograph sync-if-dirty` |
| `kirograph-sync-if-dirty.json` | `agentStop` | `kirograph sync-if-dirty --quiet` |

File changes are batched: saves and creates write a dirty marker; the actual sync runs when the agent stops. Deletes sync immediately. This means no overhead during active editing.

Hooks fire for: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, `.cs`, `.rb`, `.php`, `.swift`, `.kt`, `.dart`

### Steering File (`.kiro/steering/kirograph.md`)

Teaches Kiro to prefer graph tools over file scanning when `.kirograph/` exists:

- Start with `kirograph_context` for any task instead of reading files
- Use `kirograph_search` instead of grep/glob
- Use `kirograph_callers` / `kirograph_callees` to trace code flow
- Use `kirograph_impact` before modifying a symbol

## MCP Tools

All 12 tools are auto-approved and available to Kiro once installed.

### `kirograph_context`

**Start here.** Comprehensive context for a task or feature — often sufficient alone without additional tool calls.

Extracts symbol tokens from the task description, finds relevant entry points via exact name lookup + semantic search + full-text search, resolves imports to definitions, and returns entry points, related symbols, and code snippets.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `task` | string | required | Task, bug, or feature description |
| `maxNodes` | number | 20 | Max symbols to include |
| `includeCode` | boolean | true | Include code snippets |
| `projectPath` | string | cwd | Project root path |

### `kirograph_search`

Quick symbol search by name. Returns locations only, no code.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | required | Symbol name or partial name |
| `kind` | string | — | Filter: `function`, `method`, `class`, `interface`, `type_alias`, `variable`, `route`, `component` |
| `limit` | number | 10 | Max results (1–100) |
| `projectPath` | string | cwd | Project root path |

### `kirograph_callers`

Find all functions/methods that call a specific symbol.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `symbol` | string | required | Symbol name |
| `limit` | number | 20 | Max results (1–100) |
| `projectPath` | string | cwd | Project root path |

### `kirograph_callees`

Find all functions/methods that a specific symbol calls.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `symbol` | string | required | Symbol name |
| `limit` | number | 20 | Max results (1–100) |
| `projectPath` | string | cwd | Project root path |

### `kirograph_impact`

Analyze what code would be affected by changing a symbol. Use before making changes.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `symbol` | string | required | Symbol name |
| `depth` | number | 2 | Traversal depth |
| `projectPath` | string | cwd | Project root path |

### `kirograph_node`

Get details about a specific symbol, optionally including source code.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `symbol` | string | required | Symbol name |
| `includeCode` | boolean | false | Include source code |
| `projectPath` | string | cwd | Project root path |

Returns: kind, name, qualified name, file location, signature, docstring, and optionally source code.

### `kirograph_type_hierarchy`

Traverse the type hierarchy of a class or interface.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `symbol` | string | required | Class or interface name |
| `direction` | string | `both` | `up` (base types), `down` (derived types), `both` |
| `projectPath` | string | cwd | Project root path |

### `kirograph_path`

Find the shortest path between two symbols in the dependency graph.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `from` | string | required | Source symbol name |
| `to` | string | required | Target symbol name |
| `projectPath` | string | cwd | Project root path |

### `kirograph_dead_code`

Find symbols with no incoming references (potential dead code). Only unexported symbols are considered.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Max results (1–100) |
| `projectPath` | string | cwd | Project root path |

### `kirograph_circular_deps`

Find circular import dependencies in the codebase.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectPath` | string | cwd | Project root path |

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

### `kirograph_status`

Check index health and statistics: files indexed, symbol count, edge count, breakdown by kind and language, frameworks detected, database size, and semantic search status.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectPath` | string | cwd | Project root path |

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
| `semanticEngine` | string | `cosine` | Search engine: `cosine`, `sqlite-vec`, `orama`, or `pglite` (see below) |
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

This downloads the `nomic-ai/nomic-embed-text-v1.5` model (~130MB) to `~/.kirograph/models/` on first use and generates 768-dimensional vector embeddings for all functions, methods, classes, interfaces, type aliases, components, and modules. Embeddings are stored locally in the SQLite database and kept in sync automatically via Kiro hooks.

Use `kirograph install` to be guided through engine selection interactively, or set `semanticEngine` in `.kirograph/config.json` manually.

#### Engine comparison

| Engine | Quality | Speed | Extra deps | Best for |
|--------|---------|-------|------------|----------|
| `cosine` *(default)* | good | linear scan | none | small / medium projects |
| `sqlite-vec` | good | sub-linear ANN | `better-sqlite3`, `sqlite-vec` (native) | large codebases |
| `orama` | **best** | fast | `@orama/orama`, `@orama/plugin-data-persistence` (pure JS) | best result quality, no native deps |
| `pglite` | **best** | fast (HNSW) | `@electric-sql/pglite` (pure WASM) | exact results, no native deps, PostgreSQL semantics |

#### cosine (default)

In-process cosine similarity over all stored embeddings. No extra dependencies.

```json
{
  "enableEmbeddings": true,
  "semanticEngine": "cosine"
}
```

#### sqlite-vec

Approximate nearest-neighbour (ANN) index stored in `.kirograph/vec.db`. Sub-linear search time — ideal for large codebases with thousands of indexed symbols. Requires two native dependencies.

```json
{
  "enableEmbeddings": true,
  "semanticEngine": "sqlite-vec"
}
```

```bash
npm install better-sqlite3 sqlite-vec
```

If the dependencies are not installed, KiroGraph silently falls back to `cosine`.

#### orama

Hybrid search powered by [Orama](https://github.com/oramasearch/orama) — combines full-text relevance and vector similarity in a **single query**, producing higher-quality results than running the two searches separately. The index is persisted to `.kirograph/orama.json`. Pure JS, no native compilation required.

```json
{
  "enableEmbeddings": true,
  "semanticEngine": "orama"
}
```

```bash
npm install @orama/orama @orama/plugin-data-persistence
```

If the dependencies are not installed, KiroGraph silently falls back to `cosine`.

#### pglite

Hybrid search powered by [PGlite](https://github.com/electric-sql/pglite) — a WASM-compiled PostgreSQL with the [pgvector](https://github.com/pgvector/pgvector) extension. Combines exact nearest-neighbour vector search with full-text ranking (`ts_rank`) in a **single SQL query**. The database is persisted to `.kirograph/pglite/` using PostgreSQL's WAL-based storage. Pure WASM — no native compilation required.

```json
{
  "enableEmbeddings": true,
  "semanticEngine": "pglite"
}
```

```bash
npm install @electric-sql/pglite
```

Key advantages over other engines:
- **Exact** vector results (not approximate) — deterministic and reproducible
- Native SQL `ON CONFLICT` upsert — no remove+insert workaround
- HNSW index (`vector_cosine_ops`) keeps search fast as the index grows
- Single dependency, zero native binaries

If the dependency is not installed, KiroGraph silently falls back to `cosine`.

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
