# Changelog

## [0.9.0] - 2026-04-14

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
