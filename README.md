![KiroGraph terminal](https://raw.githubusercontent.com/davide-desio-eleva/kirograph/main/assets/logo.png)

# KiroGraph

![KiroGraph terminal](https://raw.githubusercontent.com/davide-desio-eleva/kirograph/main/assets/terminal.png)

Semantic code knowledge graph for [Kiro](https://kiro.dev): fewer tool calls, instant symbol lookups, 100% local.

Inspired by [CodeGraph](https://github.com/colbymchenry/codegraph) by [colbymchenry](https://github.com/colbymchenry) for Claude Code, rebuilt natively for Kiro's MCP and hooks system.

> **Full support is for Kiro only.** Experimental integrations for other MCP-capable tools (Claude Code, Codex) are available but not fully tested. See [Integrations](docs/guide/integrations.md) for details.

## Why KiroGraph?

When you ask Kiro to work on a complex task, it explores your codebase using file reads, grep, and glob searches. Every one of those is a tool call, and tool calls consume context and slow things down.

KiroGraph gives Kiro a semantic knowledge graph that's pre-indexed and always up to date. Instead of scanning files to understand your code, Kiro queries the graph instantly: symbol relationships, call graphs, type hierarchies, impact radius, all in a single MCP tool call.

The result is fewer tool calls, less context used, and faster responses on complex tasks.

## Features

| Feature | Description |
|---------|-------------|
| <h4>Graph & Analysis</h4> | |
| 🕸️ **Semantic Graph** | tree-sitter AST parsing across 24+ languages — functions, classes, call edges, type hierarchies, all in SQLite |
| 🎯 **Context Building** | One tool call returns entry points, related symbols, and code snippets for any task description |
| 💥 **Impact Analysis** | Blast-radius traversal before making changes — know what breaks at any depth |
| 🧬 **Type Hierarchy** | Traverse inheritance chains — base types, derived types, implementations |
| 🔄 **Circular Dependency Detection** | Find import cycles using Tarjan's SCC algorithm |
| 💀 **Dead Code Detection** | Find unexported symbols with zero incoming references |
| 🔥 **Hotspots & Surprises** | Identify most-connected symbols and unexpected cross-module coupling |
| 🧪 **Affected Tests** | Find test files impacted by source changes — useful in CI and pre-commit hooks |
| <h4>Architecture</h4> | |
| 🏛️ **Architecture Analysis** | Package graph, layer detection, coupling metrics (Ca/Ce/instability) |
| 📸 **Snapshots & Diff** | Save graph state before refactors, diff after to verify structural changes |
| 🌐 **Graph Export** | Interactive browser dashboard with search, clustering, path finding, and analytics |
| <h4>Semantic Search</h4> | |
| ⚡ **7 Semantic Engines** | Cosine, sqlite-vec, Orama, PGlite, LanceDB, Qdrant, Typesense — pick the best fit for your project |
| 🤖 **Custom Embedding Models** | Use any HuggingFace `feature-extraction` model — nomic, Gemma, MiniLM, BGE, or bring your own |
| <h4>Knowledge & Data</h4> | |
| 🧠 **Persistent Memory** | Cross-session observations — decisions, errors, patterns — auto-linked to code symbols |
| 📖 **Documentation Indexing** | Section-level retrieval from Markdown, MDX, RST, AsciiDoc, OpenAPI — 92-97% token savings |
| 📊 **Data Navigation** | Query CSV/JSON/Excel/Parquet with filters, aggregations, joins — all server-side in SQLite |
| <h4>Token Optimization</h4> | |
| 🗜️ **Shell Compression** | Token-optimized command output (git, tests, linters, docker, AWS) — 60-90% savings |
| 🪨 **Caveman Mode** 🪨 | Agent prose compression (lite → ultra) — fewer tokens on explanations without touching code |
| 📈 **Token Analytics** | Track cumulative savings from graph tools and shell compression over time |
| <h4>Integration</h4> | |
| 🔌 **Multi-tool Support** | Native Kiro integration + experimental Claude Code and Codex targets |

## Quick Start

```bash
kirograph install        # wire up Kiro MCP + hooks + steering + CLI agent
```

Or using the short alias:

```bash
kg install
```

All Kiro integration files are written to `.kiro/`. Restart Kiro IDE, or switch to the `kirograph` agent in Kiro CLI.

## Documentation

📖 **[Full documentation on GitHub Pages](https://davide-desio-eleva.github.io/kirograph/)**

| Page | Description |
|------|-------------|
| [Installation](docs/guide/installation.md) | Install from npm or source, uninstall, verify |
| [How It Works](docs/guide/how-it-works.md) | Indexing layers (structural, semantic, architecture, memory, docs, data) |
| [Integrations](docs/guide/integrations.md) | Kiro setup, Claude Code, Codex (experimental) |
| [MCP Tools](docs/guide/mcp-tools.md) | Full reference for all MCP tools |
| [CLI Reference](docs/guide/cli.md) | All CLI commands with examples |
| [Configuration](docs/guide/configuration.md) | Config fields, semantic engines, architecture analysis |
| [Languages & Frameworks](docs/guide/languages.md) | Supported languages, frameworks, and detection |
| [Changelog](CHANGELOG.md) | Release history |
| [Contributing](CONTRIBUTING.md) | How to contribute |
| [Code of Conduct](CODE_OF_CONDUCT.md) | Community guidelines |
| [Security](SECURITY.md) | Security policy |

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

## What Gets Indexed?

KiroGraph uses [tree-sitter](https://tree-sitter.github.io/tree-sitter/) to parse your source files into an AST and extract:

- **Nodes**: functions, methods, classes, interfaces, types, enums, variables, constants, routes, components, and more (24 node kinds total)
- **Edges**: calls, imports, exports, extends, implements, contains, references, instantiates, overrides, decorates, type_of, returns

Everything is stored in a local SQLite database (`.kirograph/kirograph.db`). **Nothing leaves your machine.** No API keys. No external services.

## Requirements

- Node.js >= 18
- Kiro IDE (fully supported)
- Other MCP-capable tools (experimental — see [Integrations](docs/guide/integrations.md))

## Credits

KiroGraph is inspired by [CodeGraph](https://github.com/colbymchenry/codegraph) by [Colby McHenry](https://www.linkedin.com/in/colby-mchenry/). The original concept of building a semantic code graph for AI coding agents comes from his work.

### Inspirations

- [cavemem](https://github.com/JuliusBrussee/cavemem) by [Julius Brussee](https://www.linkedin.com/in/julius-brussee/): the memory module's hook-based observation capture, deterministic compression, and SQLite storage pattern.
- [jDocMunch-MCP](https://github.com/jgravelle/jdocmunch-mcp) by [J. Gravelle](https://www.linkedin.com/in/j-gravelle-2778223/): the documentation module's section-first retrieval approach, stable section IDs, and byte-offset addressing.
- [jDataMunch-MCP](https://github.com/jgravelle/jdatamunch-mcp) by [J. Gravelle](https://www.linkedin.com/in/j-gravelle-2778223/): the data module's column profiling, streaming parsers, and server-side aggregation approach.

### Contributors

- [Alessandro Franceschi](https://www.linkedin.com/in/alessandrofranceschi/) — Claude Code and Codex integration, Elixir/Phoenix language and framework support.
- [Mauro Argo](https://www.linkedin.com/in/argomauro/) — original idea for the architecture layer analysis feature.

## Star History

<a href="https://www.star-history.com/?repos=davide-desio-eleva%2Fkirograph&type=date&legend=top-left"><picture><source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=davide-desio-eleva/kirograph&type=date&theme=dark&legend=top-left" /><source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=davide-desio-eleva/kirograph&type=date&legend=top-left" /><img alt="Star History Chart" src="https://api.star-history.com/chart?repos=davide-desio-eleva/kirograph&type=date&legend=top-left" /></picture></a>

## License

[MIT](LICENSE)

| Document | Description |
|----------|-------------|
| [License](LICENSE) | MIT License — permissions, conditions, copyright |
| [Disclaimer](DISCLAIMER.md) | Limitations of use, no professional advice, data handling |
| [Warranty Disclaimer](WARRANTY.md) | Software provided "as is", no warranties of any kind |
| [Limitation of Liability](LIABILITY.md) | Exclusion of liability for damages arising from use |
| [Terms of Use](TERMS.md) | Permitted and prohibited use, user obligations, privacy |
