# Changelog

## [0.13.0] - 2026-05-18

### Added

- **13 new languages** — Scala (`.scala`, `.sc`, `.sbt`), Lua (`.lua`), Zig (`.zig`, `.zon`), Bash (`.sh`, `.bash`, `.zsh`), OCaml (`.ml`, `.mli`), Elm (`.elm`), Solidity (`.sol`), Vue (`.vue`), Objective-C (`.m`), YAML (`.yaml`, `.yml`), HCL/Terraform (`.tf`, `.tfvars`), CSS (`.css`), and SCSS/Sass (`.scss`, `.sass`). YAML and CSS use pre-compiled WASM grammars from `tree-sitter-wasms`. HCL uses a WASM grammar built from [tree-sitter-grammars/tree-sitter-hcl](https://github.com/tree-sitter-grammars/tree-sitter-hcl) and SCSS from [tree-sitter-grammars/tree-sitter-scss](https://github.com/tree-sitter-grammars/tree-sitter-scss), both bundled in `src/extraction/wasm/`.
- **9 new framework resolvers:**
  - **Play (Scala)** — detects Play Framework via `build.sbt`/`plugins.sbt`. Resolves controller, service, and model references. Extracts routes from `conf/routes` and Akka HTTP / http4s DSL patterns.
  - **Nuxt / Vue** — detects Nuxt via `nuxt.config.ts` and Vue via `package.json`. Resolves composables (`useXxx`), auto-imported components (PascalCase → file lookup), and Pinia stores. Extracts file-based routes from `pages/` and server API routes from `server/api/`.
  - **Solidity** — detects Hardhat/Foundry/Truffle projects. Resolves interface references (`IERC20`, etc.), contract inheritance, and library function calls.
  - **SST** — detects SST via `sst.config.ts` or `sst` in `package.json`. Resolves Lambda handler strings to actual function symbols. Extracts API routes from `api.route()` calls and route object literals.
  - **AWS CDK** — detects CDK via `cdk.json` or `aws-cdk-lib` in dependencies. Resolves handler strings and Stack/Construct class references. Extracts API Gateway routes from `addMethod`/`addResource`/`addRoutes` patterns.
  - **Serverless Framework** — detects via `serverless.yml`/`serverless.ts`. Resolves handler strings. Extracts HTTP event routes from YAML config (`- http: GET /users`) and TypeScript config.
  - **AWS SAM** — detects via `template.yaml` with `AWS::Serverless` transform or `samconfig.toml`. Resolves handler strings. Extracts API/HttpApi event routes from SAM template YAML.
  - **Terraform / OpenTofu** — detects via `.terraform/` directory or `.tf` files. Extracts resources, data sources, modules, variables, outputs, and locals as graph nodes via regex-based parsing. Resolves cross-file resource, module, and variable references. Extracts API Gateway routes from `aws_api_gateway_resource` and `aws_api_gateway_method` blocks.
- **4 new architecture layer detectors:**
  - **Scala** — Play controllers/models/views, SBT services/repositories, Akka actors, Slick persistence.
  - **Vue / Nuxt** — pages, components, composables, stores, server/api, layouts, plugins.
  - **Solidity** — contracts (service), interfaces (api), libraries (shared), storage/migrations (data), mocks.
  - **OCaml** — bin (api), domain/service, db/repo (data), lib (shared). Dune-aware patterns.
- **3 new manifest parsers:**
  - **SBT** (`build.sbt`) — extracts project name, version, library dependencies, and multi-module sub-project detection.
  - **OCaml** (`dune-project`, `.opam`) — extracts project name, version, dependencies, and discovers sub-libraries via `dune` files.
  - **Elm** (`elm.json`) — handles both application and package types, extracts direct dependencies.
- **Language-specific AST node mappings** — added `getLanguageSpecificKind` entries for all 9 new code languages (Scala `object_definition`/`val_definition`/`type_definition`, Lua `local_function`/`local_variable_declaration`, Zig `VarDecl`/`ContainerDecl`, Bash `variable_assignment`, OCaml `let_binding`/`type_binding`/`module_binding`, Elm `function_declaration_left`/`type_alias_declaration`, Solidity `contract_declaration`/`event_definition`/`modifier_definition`/`state_variable_declaration`, Objective-C `class_interface`/`class_implementation`/`protocol_declaration`/`method_declaration`/`property_declaration`).
- **Generic KIND_MAP additions** — `trait_definition` (Scala), `struct_definition` (Zig), `module_definition` (OCaml) added to the shared node type map.
- **Manifest skip directories** — `_build`, `_opam`, `elm-stuff`, `zig-cache`, `zig-out` added to the directory exclusion list during manifest scanning.

---

## [0.12.2] - 2026-05-16

### Added

- **GitHub Pages documentation site** — full static site in `docs/` with home, docs, MCP tools reference, CLI reference, and changelog pages. Dark theme, responsive layout, left/right sidebars with scroll-spy navigation.
- **npm publication** — package published as `kirograph` on npm. Install globally with `npm install -g kirograph`.
- **`npm run docs` script** — serves the documentation site locally via `npx serve docs` for development preview.

### Changed

- README images now use absolute URLs (`raw.githubusercontent.com`) instead of relative paths, fixing broken images on npmjs.com.

---

## [0.12.1] - 2026-05-14

### Added

- **`sync --progress`** — new verbose per-file progress flag. Prints each file as it is parsed (`parse  [i/total]  path/to/file.ts`), shows exclude-cleanup removals with a distinct `exclude` prefix, and prints all errors inline with full detail instead of a suppressed count.
- **Exclude rule cleanup on sync** — `kirograph sync` now removes already-indexed files that match newly added exclude patterns (e.g. `**/.vite/**`). Previously those files stayed in the index until a full `--force` re-index. The cleanup runs at the start of every sync, before processing changed files.
- **MCP sync awareness in `kirograph_status`** — the `kirograph_status` tool now surfaces sync state. When pending unindexed files exceed a configurable threshold it warns: *"Index may be incomplete — N files pending sync. Sync is running in background. Would you like to wait before proceeding?"* This gives the agent the ability to pause rather than silently working with a stale index.
- **`syncWarningThreshold` config field** — controls the pending-file count above which `kirograph_status` emits the staleness warning. Default `10`. Set to `0` to disable.
- **Sync state in `kirograph status` CLI** — the status command now shows a `Sync` section with idle/running state and pending file count, with a yellow warning when the count exceeds the threshold.
- **`LockManager.isLocked()`** — exposes whether a sync/index is currently running in another process, used by both the MCP tool and CLI status command.
- **`KiroGraph.getPendingSyncCount()`** — returns the number of files that have changed on disk but are not yet reflected in the index. Uses `git status` first, falls back to a filesystem diff against the indexed set.
- **Large-codebase pre-flight warning** — when embeddable node count exceeds 100K, a yellow warning is printed before the embedding phase starts, advising the user to disable embeddings or use a lighter model.
- **Paginated `embedAll`** — the embedding phase now streams nodes in pages of 2,000 instead of loading all nodes into memory at once. Critical for large codebases (100K+ symbols) where a single `getAllNodes()` call could exhaust the Node.js heap or WASM linear memory.
- **`getEmbeddableNodesPaged()` and `countEmbeddableNodes()`** — new paginated DB queries for memory-efficient embedding.

### Fixed

- **WASM parser poisoning on large codebases** — when a tree-sitter WASM parser aborts (e.g. due to memory pressure), the language is now tracked as "poisoned" and remaining files of that language are skipped until `clearParserCache()` + `initGrammars()` succeeds. Previously, every subsequent file of the same language would instantly re-abort, producing hundreds of `Aborted()` messages and wasting time.
- `config-prompt.ts`: `cavemanMode` was missing from the initial `ConfigPatch` object literal, causing a TypeScript error. Default is now `'off'` (overwritten later in the prompt flow).
- `config-prompt.ts`: `CavemanMode` type was used but never defined or imported; added local type alias.

---

## [0.12.0] - 2026-05-09

### Added

- **Elixir language support** — `.ex` and `.exs` files are now indexed using the `tree-sitter-elixir` grammar (already included in `tree-sitter-wasms`). Extracts modules (`defmodule`), functions (`def`, `defp`), macros (`defmacro`, `defmacrop`), protocols (`defprotocol`), implementations (`defimpl`), and structs (`defstruct`). `defp` and `defmacrop` are marked private. `alias`, `use`, `import`, and `require` are extracted as import edges.
- **Phoenix framework detection** — auto-detected via `mix.exs` containing `:phoenix`. Resolves `Controller`, `LiveView`, and `Channel` module references by convention. Extracts HTTP routes (`get`, `post`, `put`, `patch`, `delete`), `resources`, and `live` routes from `router.ex` as `route` nodes.
- **Elixir architecture layer detection** — Phoenix-aware glob patterns for all five layers: `api` (controllers, channels, router, plugs), `service` (contexts, workers, jobs), `data` (schemas, repo, migrations), `ui` (LiveView, components, views, templates), `shared` (helpers, lib, config, mailers).
- Auto-sync hooks now fire for `.ex` and `.exs` files.

### Fixed

- **Multi-language call edge extraction** — `walkForCalls` previously only recognised `call_expression` (JS/TS/Go/Rust/…). C# (`invocation_expression`), Java (`method_invocation`), Python (`call`), Ruby (`call`), and PHP (`function_call_expression`) produced zero call edges, causing empty `kirograph_callers`, `kirograph_callees`, and `kirograph_hotspots` results. All missing call node types are now handled with per-language name extraction using tree-sitter field lookups.
- **Inheritance edge extraction for C# and Java** — `walkTree` now scans `base_list` (C# class/interface declarations) and `superclass`/`super_interfaces`/`extends_interfaces` (Java) to emit `extends` and `implements` edges. This restores `kirograph_type_hierarchy` results for C# and Java projects.
- **Namespace/package import resolution** — `_resolveImportPath` previously returned `null` for any import that didn't start with `.`. Java package imports (`import com.example.Foo`) now resolve via exact qualifiedName lookup, then name+namespace-prefix match. C# namespace imports (`using MyApp.Services`) resolve via a new namespace prefix cache (built from qualifiedNames at warm-cache time) and namespace node lookup. Wildcard imports (`import com.example.*`) resolve to any type in the namespace.

---

## [0.11.0] - 2026-04-20

### Added

- `kirograph export` is now available to render a full interactive graph dashboard.
- **Search** — live symbol search; matching nodes are highlighted, non-matching ones dim; viewport fits to results
- **Two-click path** — click any two nodes to instantly find and highlight the shortest path between them, with detail cards for both endpoints
- **Zoom to node** — clicking a node zooms in so its label is always readable
- **Cluster view** — group nodes by directory; click the cluster to expand it back to the full graph
- **Minimap** — always-visible overview of the full graph; click to pan
- **Right-click menu** — focus neighbors, start a path, copy ID or file path, highlight all nodes of the same kind
- **Heat map** — color nodes by how recently their file was modified, to spot the most active areas of the codebase
- **Analytics charts** — bar chart of the most connected symbols, donut chart of node distribution by kind, degree distribution curve

### Fixed

- FTS5 query sanitizer now strips commas — task strings with commas (e.g. `kirograph_context`) previously caused `fts5: syntax error near ","`
- `kirograph path` resolves to real symbol kinds (class, function, method…) before falling back to import/file nodes
- `findPath` BFS is now undirected — traverses edges in both directions

---

## [0.10.0] - 2026-04-18

### Added

- `kirograph_hotspots` MCP tool — finds the most-connected symbols by total edge degree (in + out, excluding `contains`); rendered with an inline bar chart showing in/out breakdown
- `kirograph_surprising` MCP tool — finds non-obvious cross-file connections scored by path distance × edge-kind weight (`calls=1.0`, `references=0.8`, `type_of=0.7`, etc.)
- `kirograph_diff` MCP tool — compares the current graph against a saved snapshot; shows added/removed symbols and edges
- `kirograph hotspots` CLI command — table output with proportional bar chart; `--limit`, `--format json`
- `kirograph surprising` CLI command — ranked list of unexpected cross-module links; `--limit`, `--format json`
- `kirograph snapshot save|list|diff` CLI commands — save lightweight graph snapshots to `.kirograph/snapshots/`, list them, and diff current graph vs any snapshot; `--format full|json`
- `kirograph dead-code` CLI command — groups unexported unreferenced symbols by file; `--limit`, `--format json`; achieves CLI parity with `kirograph_dead_code` MCP tool
- `kirograph path <from> <to>` CLI command — finds shortest path between two symbols via undirected BFS; shows resolved nodes and hop chain; `--format json`; achieves CLI parity with `kirograph_path` MCP tool
- `SnapshotManager` in `src/core/snapshot.ts` — save/load/diff logic; diffs computed as O(n) set operations on node ID and edge tuple sets
- `findHotspots()` and `findSurprisingConnections()` on `GraphDatabase`; `getAllEdges()` for snapshot capture

### Changed

- Help output reorganised into six named groups (🔧 Workspace Setup, 📦 Indexing, 🔍 Search & Exploration, 📊 Graph Insights, 🏛️ Architecture Analysis, ⚙️ Agent & Configuration) with consistent cross-group alignment
- `kirograph caveman` rendered in brown with 🪨 prefix and attribution line: _Inspired by Caveman — original idea by github.com/JuliusBrussee/caveman_
- `findPath` BFS changed from directed-only to undirected — now traverses edges in both directions, finding connections across the full graph not just directed call chains
- `path` command prefers real symbol kinds (function, class, method, etc.) over import/file nodes when resolving search results

### Fixed

- FTS5 query sanitizer now strips commas — long natural-language task descriptions containing commas (e.g. in `kirograph_context`) previously caused `fts5: syntax error near ","` errors

---

## [0.9.0] - 2026-04-16

### Added

- Caveman mode — agent communication style compression, inspired by [caveman](https://github.com/JuliusBrussee/caveman) by JuliusBrussee
- `cavemanMode` config field (`off` | `lite` | `full` | `ultra`); default `off`
- `kirograph caveman [mode]` command — reads or sets the mode; regenerates steering file and CLI agent config immediately
- Four compression levels: `lite` (compact, no filler, full sentences), `full` (fragments, no articles), `ultra` (maximum compression, abbreviations, `→` for causality)
- Rules injected into `.kiro/steering/kirograph.md` (IDE, `inclusion: always`) and inlined into `.kiro/agents/kirograph.json` prompt (kiro-cli) — no extra hook calls
- `kirograph install` interactive arrow-key prompt for caveman mode selection

### Changed

- Caveman rules no longer use a dedicated hook file (`kirograph-caveman.json`) — the steering file's `inclusion: always` makes injection hooks unnecessary for both IDE and CLI

---

## [0.8.0] - 2026-04-14

### Added

- `esbuild` + `tsx` replace `tsc` as the build pipeline — ~400ms builds vs ~5-10s
- `npm run dev` watch mode with incremental rebuilds
- `npm run typecheck` for type-only validation (`tsc --noEmit`), decoupled from the build

### Changed

- `scripts/build.ts` (TypeScript, executed via `tsx`) replaces the old `tsc && node scripts/copy-assets.js && chmod +x` chain
- Asset copy (schema.sql, wasm files) and bin chmod are now part of the build script
- `scripts/copy-assets.js` removed
- `postinstall` script removed — embedding models are downloaded lazily on first use, making the pre-download unnecessary
- Embedding model progress bar shown only during `kg install`, not on every command
- Model download progress aggregated into a single global bar (`X / Y MB`) instead of per-file
- Noisy `@huggingface/transformers` internal warnings suppressed during model download

### Fixed

- Dynamic `import()` of relative modules rewritten to `Promise.resolve().then(() => require())` at build time, fixing the double-default CJS/ESM wrapping issue
- Model cache detection updated for `@huggingface/transformers` v3 directory layout (`org/model` instead of `org--model`), preventing re-download on every command

---

## [0.7.0] - 2026-04-14

### Added

- Configurable embedding model selection: `kirograph install` now presents an arrow-key menu with four curated models plus a custom option
- `embeddingDim` config field; all vector engine constructors use it instead of a hardcoded `768`
- `VectorManager.initialize()` runs a post-load dimension check — if the model's actual output shape differs from `embeddingDim`, a warning is logged and the runtime value is corrected automatically
- Curated model presets: `nomic-ai/nomic-embed-text-v1.5` (768-dim, ~130 MB, default), `onnx-community/embeddinggemma-300m-ONNX` (768-dim, ~300 MB, Google Gemma-based, multilingual, 2048-token context), `Xenova/all-MiniLM-L6-v2` (384-dim, ~23 MB), `BAAI/bge-base-en-v1.5` (768-dim, ~110 MB), and a free-form custom entry that prompts for model ID and dimension

### Changed

- Migrated from `@xenova/transformers` (v2) to `@huggingface/transformers` (v3), enabling support for modern ONNX models (IR version 10+)
- `typesense` moved from `dependencies` to `optionalDependencies`, consistent with all other engine packages

### Fixed

- Cache-hit detection in `postinstall.js` was `replace('/', '/')` — a no-op; now correctly uses `replace('/', '--')`

### Security

- Added `axios` override (`^1.8.3`) to patch two critical CVEs in typesense's transitive dependency: [GHSA-3p68-rc4w-qgx5](https://github.com/advisories/GHSA-3p68-rc4w-qgx5) and [GHSA-fvcv-3m26-pcqx](https://github.com/advisories/GHSA-fvcv-3m26-pcqx)

---

## [0.6.0] - 2026-04-13

### Added

- `enableArchitecture` config field (default `false`) and opt-in `architectureLayers` override map
- Package detection via two strategies: manifest-based (parses `package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`/`setup.py`/`setup.cfg`, `pom.xml`, `build.gradle`/`build.gradle.kts`, `.csproj`) and directory fallback when a root manifest covers the whole repo
- Layer detection with per-language glob patterns for `api`, `service`, `data`, `ui`, and `shared` tiers; detectors for TypeScript/JS, Python, Go, Java, Ruby, Rust, and C#
- Package dependency rollup derived from existing `imports` edges — no re-parsing required
- Coupling metrics per package: afferent Ca, efferent Ce, instability `Ce / (Ca + Ce)`
- Seven new `arch_*` tables in `kirograph.db`; zero overhead when `enableArchitecture` is `false`
- MCP tools: `kirograph_architecture`, `kirograph_coupling`, `kirograph_package`
- CLI commands: `kirograph architecture`, `kirograph coupling`, `kirograph package`
- `kirograph install` prompts to enable architecture analysis
- Steering file and CLI agent config updated to teach Kiro when and how to use the architecture tools

---

## [0.5.0] - 2026-04-10

### Added

- `kirograph install` writes `.kiro/agents/kirograph.json` — a workspace custom agent with the MCP server wired up, steering instructions inlined as the system prompt, and sync hooks at `agentSpawn`, `userPromptSubmit`, and `stop`
- Support for `kiro-cli --agent kirograph` and the `/agent swap kirograph` in-session command
- CLI sync strategy for kiro-cli: `kirograph sync-if-dirty --quiet` at session boundaries (the CLI has no file-watch events)

---

## [0.4.0] - 2026-04-01

### Added

- Interactive guided installer (`kirograph install`) that wires up a Kiro workspace in one command
- Installer writes `.kiro/settings/mcp.json`, `.kiro/hooks/*.json`, `.kiro/steering/kirograph.md`, and `.kiro/agents/kirograph.json`
- Interactive prompts for all config options: embeddings on/off, embedding model, semantic engine, Typesense/Qdrant dashboard opt-in, docstring extraction, call-site tracking, and architecture analysis
- Auto-installs optional npm dependencies for the chosen engine
- Optional immediate project initialisation and indexing after configuration
- Opens Typesense or Qdrant dashboard post-index when opted in

### Fixed

- Ctrl+C shutdown crash after the Typesense dashboard starts: replaced `process.exit(0)` in the SIGINT handler with a graceful HTTP server close, eliminating a native addon mutex race condition

---

## [0.3.5] - 2026-04-07

### Added

- `typesense` engine: ANN search via auto-downloaded Typesense binary (~37 MB, cached at `~/.kirograph/bin/`); persistent daemon; local dashboard UI; requires `typesense`

---

## [0.3.4] - 2026-04-07

### Added

- `qdrant` engine: ANN search via Qdrant embedded binary (HNSW, cosine); managed child process with a persistent daemon between commands; built-in Web UI dashboard (`kirograph dashboard start`); requires `qdrant-local`

---

## [0.3.3] - 2026-04-06

### Added

- `lancedb` engine: ANN cosine search via Apache Lance columnar format; pure JS (`@lancedb/lancedb`); data stored in `.kirograph/lancedb/`

---

## [0.3.2] - 2026-04-01

### Added

- `pglite` engine: hybrid search via WASM-compiled PostgreSQL + `pgvector`; exact vector results; single dependency (`@electric-sql/pglite`), zero native binaries

---

## [0.3.1] - 2026-03-31

### Added

- `orama` engine: hybrid full-text + vector search via `@orama/orama`; pure JS, no native dependencies; index persisted to `.kirograph/orama.json`

---

## [0.3.0] - 2026-03-31

### Added

- `sqlite-vec` engine: ANN index stored in `.kirograph/vec.db`; sub-linear search time; requires `better-sqlite3` + `sqlite-vec` (native compiled)
- `semanticEngine` config field accepting `cosine | sqlite-vec | orama | pglite | lancedb | qdrant | typesense`
- Each engine is an optional dependency — only installed when chosen; absent packages fall back silently to `cosine`

### Changed

- `useVecIndex` boolean is now a deprecated alias for `semanticEngine: 'sqlite-vec'`; existing configs continue to work

---

## [0.2.0] - 2026-03-30

### Added

- MCP server (`kirograph serve --mcp`) registered in `.kiro/settings/mcp.json` with all tools auto-approved
- Four IDE hooks to keep the index fresh automatically: `fileEdited` → `kirograph mark-dirty`, `fileCreated` → `kirograph mark-dirty`, `fileDeleted` → `kirograph sync-if-dirty`, `agentStop` → `kirograph sync-if-dirty --quiet`
- Steering file `.kiro/steering/kirograph.md` that teaches the IDE agent to prefer graph tools over file scanning
- `LockManager` and dirty-marker system — changes are batched and synced at agent idle with no overhead during active editing

---

## [0.1.0] - 2026-03-27

### Added

- Initial port of [CodeGraph](https://github.com/colbymchenry/codegraph) to Kiro's MCP and hooks system
- Storage layer rebuilt with `node-sqlite3-wasm` (pure WASM SQLite, no native compilation) replacing `better-sqlite3`
- Cache directory at `~/.kirograph/`
- MCP server wired to Kiro's `.kiro/settings/mcp.json` format
- Hooks wired to Kiro's `.kiro/hooks/` format
- `@xenova/transformers` for local embedding model inference
- Cosine similarity as the default semantic engine — no extra dependencies
- Full tree-sitter AST extraction pipeline: 17 languages, 24 node kinds, 12 edge kinds
- MCP tools: `kirograph_context`, `kirograph_search`, `kirograph_callers`, `kirograph_callees`, `kirograph_impact`, `kirograph_node`, `kirograph_type_hierarchy`, `kirograph_path`, `kirograph_dead_code`, `kirograph_circular_deps`, `kirograph_files`, `kirograph_status`
- CLI: `kirograph index`, `kirograph sync`, `kirograph query`, `kirograph context`, `kirograph files`, `kirograph affected`, `kirograph status`, `kirograph unlock`

[0.13.0]: https://github.com/davide-desio-eleva/kirograph/compare/v0.12.2...v0.13.0
[0.12.2]: https://github.com/davide-desio-eleva/kirograph/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/davide-desio-eleva/kirograph/compare/v0.12.0...v0.12.1
[0.10.0]: https://github.com/davide-desio-eleva/kirograph/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/davide-desio-eleva/kirograph/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/davide-desio-eleva/kirograph/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/davide-desio-eleva/kirograph/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/davide-desio-eleva/kirograph/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/davide-desio-eleva/kirograph/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/davide-desio-eleva/kirograph/compare/v0.3.5...v0.4.0
[0.3.5]: https://github.com/davide-desio-eleva/kirograph/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/davide-desio-eleva/kirograph/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/davide-desio-eleva/kirograph/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/davide-desio-eleva/kirograph/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/davide-desio-eleva/kirograph/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/davide-desio-eleva/kirograph/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/davide-desio-eleva/kirograph/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/davide-desio-eleva/kirograph/releases/tag/v0.1.0
