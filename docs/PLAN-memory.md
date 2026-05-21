# KiroGraph Memory — Implementation Plan

## Overview

Add persistent, cross-session memory to KiroGraph. Observations are captured via hooks, optionally compressed with the caveman grammar (only if caveman mode is enabled), stored in isolated SQLite tables, embedded with the user's chosen semantic engine, and linked to code symbols in the graph. Agents retrieve memory through MCP tools — zero LLM tokens spent on write, minimal tokens on read.

Inspired by [cavemem](https://github.com/JuliusBrussee/cavemem): hooks fire at session boundaries, compress observations deterministically, store in SQLite, agents query via MCP. KiroGraph's advantage: the graph handles cross-referencing programmatically (no LLM maintenance), and the existing semantic engine handles retrieval.

All tools and CLI commands use the `kirograph_mem` prefix.

---

## Design Principles

1. **Zero LLM tokens on write** — compression is deterministic (caveman grammar, if enabled), symbol linking is programmatic (name detection in text), embedding uses the local model
2. **Minimal tokens on read** — observations are pre-compressed (when caveman is on), MCP tools return only what's relevant
3. **No regression risk** — separate `mem_*` tables, own FTS index, own vector table. Core `nodes`/`edges`/`files` untouched
4. **Opt-in** — `enableMemory: true` in config, prompted during `kirograph install`, same pattern as `enableArchitecture`
5. **Caveman compression is conditional** — only applied if the user has opted into caveman mode during install. If caveman is `off`, observations are stored as-is
6. **Reuse existing infra** — same SQLite DB, same semantic engine, same MCP dispatch pattern
7. **CLI mirrors MCP** — every MCP tool has a corresponding CLI command, same as all other KiroGraph tools

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         WRITE PATH (no LLM)                      │
│                                                                  │
│  Hook fires ──→ [caveman compress, if enabled] ──→ mem_observations│
│                                                ──→ mem_fts (FTS5) │
│                                                ──→ detect symbols │
│                                                    → mem_links   │
│                                                ──→ embed         │
│                                                    → mem_vectors │
│                                     (chosen semantic engine)     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         READ PATH (MCP + CLI)                     │
│                                                                  │
│  kirograph_mem_search ──→ FTS5 + vector hybrid search            │
│  kirograph_mem_timeline ──→ chronological session listing        │
│  kirograph_mem_store ──→ manual observation storage              │
│  kirograph_mem_status ──→ memory subsystem health                │
│  kirograph_context (enhanced) ──→ joins mem_links to surface     │
│                                   relevant observations          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Schema & Storage Layer

### 1.1 Database Schema (`src/db/memory-schema.sql`)

```sql
-- ── Memory tables (opt-in, enableMemory=true) ──────────────────────────────

CREATE TABLE IF NOT EXISTS mem_sessions (
  id TEXT PRIMARY KEY,
  ide TEXT,                          -- 'kiro', 'cursor', 'claude-code', etc.
  cwd TEXT,                          -- working directory
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_mem_sessions_started ON mem_sessions(started_at);

CREATE TABLE IF NOT EXISTS mem_observations (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES mem_sessions(id) ON DELETE SET NULL,
  content TEXT NOT NULL,             -- stored text (compressed if caveman enabled, raw otherwise)
  content_raw TEXT,                  -- original uncompressed (only stored when caveman is on)
  content_hash TEXT,                 -- SHA-256 of stored content for deduplication
  kind TEXT NOT NULL,                -- 'decision', 'error', 'pattern', 'architecture', 'summary', 'note'
  source TEXT NOT NULL DEFAULT 'hook', -- 'hook', 'manual', 'agent'
  tags TEXT,                         -- JSON array of user/auto tags
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mem_obs_hash ON mem_observations(content_hash);
CREATE INDEX IF NOT EXISTS idx_mem_obs_session ON mem_observations(session_id);
CREATE INDEX IF NOT EXISTS idx_mem_obs_kind ON mem_observations(kind);
CREATE INDEX IF NOT EXISTS idx_mem_obs_created ON mem_observations(created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS mem_fts USING fts5(
  id UNINDEXED,
  content,
  kind UNINDEXED
);

CREATE TABLE IF NOT EXISTS mem_links (
  observation_id TEXT NOT NULL REFERENCES mem_observations(id) ON DELETE CASCADE,
  qualified_name TEXT NOT NULL,      -- stable across reindex (e.g. "src/auth/service.ts::validateToken")
  relevance REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (observation_id, qualified_name)
);

CREATE INDEX IF NOT EXISTS idx_mem_links_qname ON mem_links(qualified_name);

CREATE TABLE IF NOT EXISTS mem_vectors (
  observation_id TEXT PRIMARY KEY REFERENCES mem_observations(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

Key decisions:
- **`mem_links` uses `qualified_name`** instead of `node_id` — qualified names are stable across reindex (see Decision D2). Resolved to current `node_id` at query time via JOIN.
- **`content_hash`** (SHA-256) enables deduplication — duplicate observations are silently skipped on insert (see Decision D5).
- `content_raw` is only populated when caveman compression is active — otherwise `content` already holds the original text.
- `kind` is a free-form string with suggested values, not an enum — extensible without migrations.

### 1.2 Memory Database Class (`src/memory/database.ts`)

Separate class, receives the same `db` handle from `GraphDatabase`. Methods:
- `getOrCreateSession(ide, cwd) → sessionId` — auto-creates if no active session within timeout (D6)
- `endSession(sessionId)`
- `insertObservation(obs) → id | null` — returns null if content_hash already exists (D5)
- `searchFTS(query, opts) → observations[]`
- `getBySession(sessionId, opts) → observations[]`
- `getByTimeRange(from, to, opts) → observations[]`
- `linkToSymbol(observationId, qualifiedName, relevance)` — stores qualified_name (D2)
- `getLinkedObservations(qualifiedName) → observations[]` — resolves via JOIN at query time (D2)
- `getObservationsForContext(task, limit, threshold) → observations[]` — for kirograph_context integration (D7)
- `getStats() → { sessions, observations, links, vectors, modelMismatch }` — includes model check (D4)
- `prune(olderThan) → deletedCount`
- `stripPrivate(text) → string` — removes `<private>...</private>` blocks (D9)

---

## Phase 2: Compression & Symbol Detection

### 2.1 Memory Compressor (`src/memory/compress.ts`)

Applies the caveman grammar rules programmatically as a deterministic text transform. **Only runs when `cavemanMode` is not `off` in config.** Uses the same level the user chose during install (lite/full/ultra).

```typescript
interface CompressResult {
  compressed: string;
  originalLength: number;
  compressedLength: number;
  detectedSymbols: string[];  // symbol names found in text
}

function compressObservation(text: string, mode: CavemanMode | 'off'): CompressResult;
```

Behavior by mode:
- `off` → no transformation, return text as-is
- `lite` → drop filler words, keep full sentences
- `full` → drop articles + filler, use fragments, abbreviate common terms
- `ultra` → max compression, abbreviations, → for causality

Compression rules (deterministic, no LLM):
- Drop articles (a, an, the) — full/ultra only
- Drop filler words (just, really, basically, simply, actually) — all modes except off
- Drop hedging phrases (I think, it seems, you might want to) — full/ultra
- Abbreviate common terms (database→DB, authentication→auth, request→req, response→res, function→fn, configuration→cfg, message→msg, error→err, implementation→impl, dependency→dep) — ultra only
- Preserve always: code blocks, file paths, URLs, symbol names (PascalCase/camelCase/snake_case), version numbers, numbers

### 2.2 Symbol Detector (`src/memory/symbols.ts`)

Scans text for identifiers that match indexed symbols. Returns `qualified_name` for stable linking (see Decision D2):

```typescript
function detectSymbols(text: string, db: GraphDatabase): { qualifiedName: string; name: string }[];
```

Strategy:
1. Extract candidate identifiers (camelCase, PascalCase, snake_case patterns)
2. Batch-lookup against `nodes` table by exact name
3. Return matches with their `qualified_name` (stable across reindex)

This runs at write time — cheap (single SQL query with IN clause), no LLM.

---

## Phase 3: Embedding Integration

### 3.1 Memory Vector Manager (`src/memory/vectors.ts`)

Wraps the existing `VectorManager` pattern but operates on `mem_vectors` table:

```typescript
class MemoryVectorManager {
  constructor(config: KiroGraphConfig, db: GraphDatabase);
  
  async embedObservation(obs: MemObservation): Promise<void>;
  async embedBatch(observations: MemObservation[]): Promise<void>;
  async search(query: string, limit: number): Promise<ScoredObservation[]>;
}
```

Uses the same:
- Embedding model (configured via `embeddingModel` in config)
- Semantic engine (cosine / sqlite-vec / orama / lancedb / qdrant / typesense)
- Batch size and truncation logic

The only difference: text input is the observation content instead of `nodeToText()`.

### 3.2 Hybrid Search

Combines FTS5 (keyword) + vector (semantic) with configurable alpha blend:

```typescript
async function hybridSearch(
  query: string,
  opts: { limit: number; alpha: number; kinds?: string[]; sessionId?: string }
): Promise<ScoredObservation[]>;
```

Default alpha: 0.5 (equal blend of keyword and semantic).

---

## Phase 4: MCP Tools

### 4.1 New Tools

All memory MCP tools use the `kirograph_mem_` prefix.

| MCP Tool | CLI Equivalent | Description |
|----------|---------------|-------------|
| `kirograph_mem_search` | `kirograph mem search <query>` | Hybrid search over observations |
| `kirograph_mem_store` | `kirograph mem store <content>` | Store an observation |
| `kirograph_mem_timeline` | `kirograph mem timeline` | List sessions chronologically |
| `kirograph_mem_status` | `kirograph mem status` | Memory subsystem health |

#### `kirograph_mem_search`

```json
{
  "name": "kirograph_mem_search",
  "description": "Search project memory for past decisions, errors, patterns, and context. Returns observations ranked by relevance.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Natural language search query" },
      "kind": { "type": "string", "enum": ["decision", "error", "pattern", "architecture", "summary", "note"] },
      "limit": { "type": "number", "default": 10 },
      "sessionId": { "type": "string", "description": "Filter to specific session" },
      "projectPath": { "type": "string" }
    },
    "required": ["query"]
  }
}
```

#### `kirograph_mem_store`

```json
{
  "name": "kirograph_mem_store",
  "description": "Store an observation in project memory. Content is automatically compressed (if caveman mode is on) and linked to relevant code symbols.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "content": { "type": "string", "description": "Observation text" },
      "kind": { "type": "string", "enum": ["decision", "error", "pattern", "architecture", "summary", "note"], "default": "note" },
      "projectPath": { "type": "string" }
    },
    "required": ["content"]
  }
}
```

#### `kirograph_mem_timeline`

```json
{
  "name": "kirograph_mem_timeline",
  "description": "List recent sessions and their observations chronologically.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "limit": { "type": "number", "default": 5, "description": "Number of sessions to show" },
      "sessionId": { "type": "string", "description": "Show observations for a specific session" },
      "projectPath": { "type": "string" }
    }
  }
}
```

#### `kirograph_mem_status`

```json
{
  "name": "kirograph_mem_status",
  "description": "Memory subsystem health: session count, observations, embedding coverage, storage size.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "projectPath": { "type": "string" }
    }
  }
}
```

### 4.2 Enhanced `kirograph_context`

When `enableMemory=true`, the existing `kirograph_context` tool optionally joins through `mem_links` to surface relevant observations alongside code symbols:

```
## Entry Points
- function `processPayment` — src/payments/service.ts:42
  ```
  async function processPayment(...)
  ```

## Related Memory
- [decision] stripe retry logic removed — caused duplicate charges. use idempotency keys instead. (3 weeks ago)
- [error] 500 on expired token in payment webhook. fixed by adding token refresh before charge. (2 months ago)
```

This is opt-in per query (default: include if available) and adds minimal tokens since observations are concise. Capped at `memoryContextLimit` observations (default: 3) above `memoryContextThreshold` score (default: 0.3). Total memory section never exceeds ~500 tokens.

### 4.3 Enhanced `kirograph_impact`

When `enableMemory=true`, `kirograph_impact` also queries `mem_links` for the target symbol's `qualified_name`. If observations exist, a "Related Memory" section is appended after the impact list:

```
Changing `PaymentService` may affect 7 symbol(s):
- method `processRefund` — src/payments/refund.ts:18
- function `handleWebhook` — src/payments/webhook.ts:42
...

Related Memory:
- [decision] PaymentService must not retry — idempotency keys handle duplicates. (3 weeks ago)
- [architecture] PaymentService is the only entry point for Stripe API calls. (2 months ago)
```

Same cap as `kirograph_context`: max 3 observations, 500 tokens, score ≥ 0.3. This surfaces "why" alongside "what breaks" — the agent sees both the blast radius and the historical reasoning behind the current design.

---

## Phase 5: CLI Commands (mirrors MCP)

### 5.1 Command Registration (`src/bin/commands/memory.ts`)

Follows the same pattern as `context.ts`, `architecture.ts`, etc. Registered in `kirograph.ts` as `registerMemory(program)`.

```bash
# Search (mirrors kirograph_mem_search)
kirograph mem search <query>              # hybrid search
kirograph mem search <query> --kind error # filter by kind
kirograph mem search <query> --limit 5    # limit results
kirograph mem search <query> --format json

# Store (mirrors kirograph_mem_store)
kirograph mem store "decided to use idempotency keys for payments"
kirograph mem store "auth bug: token refresh missing in webhook" --kind error
kirograph mem store --kind decision < decision.txt   # pipe from stdin

# Timeline (mirrors kirograph_mem_timeline)
kirograph mem timeline                    # last 5 sessions
kirograph mem timeline --limit 10         # more sessions
kirograph mem timeline --session <id>     # observations for specific session
kirograph mem timeline --format json

# Status (mirrors kirograph_mem_status)
kirograph mem status                      # show memory stats

# Maintenance (CLI-only, no MCP equivalent)
kirograph mem prune [--older-than 90d]    # cleanup old observations
kirograph mem export [--format jsonl|md]  # export for backup/reading
kirograph mem import <file.jsonl>         # restore from JSONL backup (deduplicates)
kirograph mem reembed                     # re-embed all observations with current model
kirograph mem reembed --batch 50          # control batch size
kirograph mem lint                        # find stale links, model mismatch, orphans
```

#### `kirograph mem lint` checks

The lint command performs the following health checks:

1. **Dead symbol links** — find `mem_links` entries where `qualified_name` no longer resolves to any node in the current graph. Report count and offer to re-run symbol detection on the parent observations to attempt re-linking.
2. **Embedding model mismatch** — detect `mem_vectors` entries whose `model` column doesn't match the current `embeddingModel` config. Report count and suggest `kirograph mem reembed`.
3. **Orphan observations** — observations with no session and no links (isolated, possibly low-value). Report for review.
4. **FTS desync** — verify `mem_fts` row count matches `mem_observations` row count. Rebuild FTS if mismatched.
5. **Stale sessions** — sessions with `started_at` but no `ended_at` older than `memorySessionTimeout`. Auto-close them.

### 5.2 Session Management (CLI-only)

```bash
kirograph mem session-start --ide kiro    # start a new session
kirograph mem session-end --session <id>  # end a session
```

These are called by hooks, not typically by users directly.

---

## Phase 6: Hooks & Session Management

### 6.1 Session Lifecycle (auto-managed)

Sessions are created and closed automatically (see Decision D6):

1. On first `kirograph_mem_store` call (or hook write), check for an active session (no `ended_at`, same `ide`, started within last 2 hours)
2. If found → attach observation to existing session
3. If not found → auto-create a new session, attach observation
4. `agentStop` hook sets `ended_at` on the active session

No explicit "session-start" hook needed. The 2-hour inactivity window is configurable via `memorySessionTimeout` (default: 7200 seconds).

CLI commands for manual/scripted use still exist but are rarely needed:
```bash
kirograph mem session-start --ide kiro    # force-start a new session
kirograph mem session-end --session <id>  # force-end a session
```

### 6.2 Observation Capture Hooks

Two capture modes:

**Automatic (hook-based):**
- `agentStop` hook (`kirograph-mem-capture.json`) → prompts the agent to review the session and store important observations via `kirograph_mem_store`. The agent decides what's worth remembering — the hook ensures it's always asked.
- `postToolUse` hook (optional, future) → could capture significant tool results (errors, decisions)

**Manual (agent-initiated):**
- Agent calls `kirograph_mem_store` at any point during the session when it encounters something worth remembering
- Steering instructions guide the agent on when to store: after fixing bugs, making decisions, discovering patterns, encountering non-obvious errors

Both modes work together: the steering encourages proactive storage during the session, and the hook catches anything the agent might have missed at session end.

---

## Phase 7: Configuration & Installer

### 7.1 Config Addition

```typescript
// In KiroGraphConfig
enableMemory: boolean;              // default: false
memorySearchAlpha: number;          // FTS/vector blend, default: 0.5
memoryKeepRaw: boolean;             // store uncompressed originals when caveman is on, default: false
memoryMaxObservations: number;      // auto-prune threshold, default: 10000
memorySessionTimeout: number;       // seconds of inactivity before auto-closing session, default: 7200
memoryContextLimit: number;         // max observations shown in kirograph_context, default: 3
memoryContextThreshold: number;     // min relevance score to include in context, default: 0.3
memoryExcludePatterns: string[];    // glob patterns for paths to never capture, default: []
```

Note: memory compression uses the existing `cavemanMode` setting. If `cavemanMode` is `off`, observations are stored uncompressed. No separate compression config needed.

### 7.2 Installer Prompt

Add to `promptConfigOptions()` in the interactive installer:

```
? Enable memory: persistent cross-session observations (yes/no)
```

If the user says yes and `cavemanMode` is `off`, observations will be stored as-is (no compression). If caveman is enabled at any level, observations are compressed at that level automatically.

### 7.3 MCP Auto-Approve

When memory is enabled, add the memory tools to the `autoApprove` list in `.kiro/settings/mcp.json`:

```json
"autoApprove": [
  "kirograph_mem_search", "kirograph_mem_store",
  "kirograph_mem_timeline", "kirograph_mem_status"
]
```

### 7.4 Steering Update

When memory is enabled, add to the generated steering file:

```markdown
## Memory

KiroGraph has persistent memory. Use `kirograph_mem_search` to recall past decisions, 
errors, and patterns before making changes. Use `kirograph_mem_store` to save important 
observations (architecture decisions, bug root causes, patterns discovered).
```

---

## Phase 8: Testing & Validation

### 8.1 Unit Tests

- `src/memory/compress.test.ts` — compression determinism, symbol preservation, mode-dependent behavior, `off` mode passthrough
- `src/memory/symbols.test.ts` — identifier extraction, batch lookup
- `src/memory/database.test.ts` — CRUD, FTS search, link management
- `src/memory/vectors.test.ts` — embedding, hybrid search ranking

### 8.2 Integration Tests

- Full write path: text → compress (if enabled) → store → embed → link
- Full read path: query → hybrid search → return ranked results
- `kirograph_context` with memory join
- `kirograph_impact` with memory join
- Session lifecycle (auto-create → observations → agentStop closes)
- Reindex safety: verify `mem_*` tables survive `kirograph index --force`
- Caveman off: verify observations stored uncompressed, search still works
- Deduplication: verify duplicate content_hash is silently skipped
- Privacy: verify `<private>` blocks are stripped before storage
- Model mismatch: verify fallback to FTS-only when embedding model changes

### 8.3 Regression Tests

- Run existing test suite with `enableMemory: false` — zero behavior change
- Run existing test suite with `enableMemory: true` — no interference with core graph operations
- Verify `kirograph index --force` does NOT drop `mem_*` tables

---

## Phase 9: Documentation Updates (final step)

### 9.1 README.md

Add a new section after "Architecture Analysis (opt-in)" in the indexing explanation:

```markdown
### Memory (opt-in)

When `enableMemory: true` is set, KiroGraph stores persistent observations across sessions...
```

Add `kirograph_mem_*` tools to the MCP Tools section, following the same format as existing tools.

Add CLI commands to the CLI Reference section under a new "### Memory" heading.

Add `kirograph_mem_*` to the `autoApprove` list in the MCP server example.

### 9.2 CHANGELOG.md

Add entry under a new version:

```markdown
## [0.15.0] — YYYY-MM-DD

### Added
- **Memory subsystem** (`enableMemory: true`): persistent cross-session observations
  - `kirograph_mem_search`: hybrid FTS + vector search over observations
  - `kirograph_mem_store`: store observations with automatic symbol linking
  - `kirograph_mem_timeline`: chronological session and observation listing
  - `kirograph_mem_status`: memory health and statistics
  - CLI commands mirror all MCP tools: `kirograph mem {search,store,timeline,status,prune,export,lint}`
  - Observations optionally compressed with caveman grammar (uses configured level)
  - Linked to code symbols in the graph for contextual retrieval
  - `kirograph_context` enhanced to surface relevant memory alongside code
```

### 9.3 docs/mcp-tools.html

Add `kirograph_mem_*` tools to the MCP tools documentation page.

### 9.4 Steering File Template

Update `src/bin/installer/steering.ts` to include memory section when `enableMemory` is true.

### 9.5 Help Command

Update `src/bin/commands/help.ts` to include memory commands in the help output.

---

## Implementation Order

| Step | Deliverable | Depends On |
|------|-------------|------------|
| 1 | `src/db/memory-schema.sql` + migration in `GraphDatabase` | — |
| 2 | `src/memory/types.ts` — type definitions | — |
| 3 | `src/memory/database.ts` — storage layer | Steps 1-2 |
| 4 | `src/memory/compress.ts` — conditional compressor | Step 2 |
| 5 | `src/memory/symbols.ts` — symbol detector | Step 3 |
| 6 | `src/memory/vectors.ts` — embedding integration | Step 3 |
| 7 | `src/memory/index.ts` — public API (MemoryManager) | Steps 3-6 |
| 8 | Config: add `enableMemory` + installer prompt | — |
| 9 | MCP tools (`kirograph_mem_*`) in `src/mcp/tools.ts` | Steps 7-8 |
| 10 | CLI commands (`src/bin/commands/memory.ts`) — mirrors MCP | Steps 7-8 |
| 11 | Gain heuristics: `naive-cost.ts` + `tracker.ts` memory source | Step 9 |
| 12 | Enhanced `kirograph_context` with memory join | Steps 7, 9 |
| 13 | Enhanced `kirograph_impact` with memory join | Steps 7, 9 |
| 14 | Hooks + session management (auto-create) | Steps 7, 8 |
| 15 | Steering file update | Step 8 |
| 16 | Tests | All |
| 17 | Documentation: README, CHANGELOG, docs/, help | All |

---

## File Structure

```
src/memory/
├── index.ts            # MemoryManager — public API
├── database.ts         # mem_* table operations
├── compress.ts         # conditional caveman compression for observations
├── symbols.ts          # symbol detection in observation text
├── vectors.ts          # embedding + hybrid search (reuses semantic engine)
└── types.ts            # MemObservation, MemSession, SearchResult types

src/db/
├── schema.sql          # existing (unchanged)
└── memory-schema.sql   # new memory tables

src/bin/commands/
└── memory.ts           # CLI: kirograph mem {search,store,timeline,status,prune,export,lint}
```

---

## Naming Convention

All public-facing references use `kirograph_mem` (MCP) or `kirograph mem` (CLI):

| Layer | Naming |
|-------|--------|
| MCP tools | `kirograph_mem_search`, `kirograph_mem_store`, `kirograph_mem_timeline`, `kirograph_mem_status` |
| CLI commands | `kirograph mem search`, `kirograph mem store`, `kirograph mem timeline`, `kirograph mem status`, `kirograph mem prune`, `kirograph mem export`, `kirograph mem lint` |
| Config key | `enableMemory` |
| DB tables | `mem_sessions`, `mem_observations`, `mem_fts`, `mem_links`, `mem_vectors` |
| Internal module | `src/memory/` |

---

## Token Budget Analysis

**Write path (per observation):**
- Caveman compression: 0 LLM tokens (deterministic, or skipped if off)
- Symbol detection: 0 LLM tokens (SQL lookup)
- Embedding: 0 LLM tokens (local model, same as code embeddings)
- Total: **0 LLM tokens**

**Read path (per search):**
- MCP tool call overhead: ~50 tokens (tool name + args)
- Result: ~100-300 tokens (10 observations × 10-30 tokens each)
- Total: **~150-350 tokens per search**

**Comparison without memory:**
- Agent re-discovers context by reading files: ~2000-5000 tokens
- Agent re-asks user for context: variable, disruptive
- **Memory saves ~1700-4700 tokens per context retrieval**

---

## Gain Heuristics (Token Savings Estimation)

Integrate memory tools into the existing `kirograph_gain` tracking system. Add naive cost estimates to `src/compression/naive-cost.ts` following the same pattern as other graph tools.

### Heuristic Rationale

Without memory, the agent must re-discover context from scratch each session. The naive cost estimates what the agent *would have spent* doing the same work without `kirograph_mem`:

| Tool | What the agent would do manually | Estimated naive cost |
|------|----------------------------------|---------------------|
| `kirograph_mem_search` | Re-read 3-5 files to recall past decisions + grep for related context + possibly ask the user | ~5,000-7,500 tokens |
| `kirograph_mem_store` | No direct equivalent (knowledge is lost). Savings come from future retrievals. | 0 (savings tracked on read) |
| `kirograph_mem_timeline` | Ask user what happened in previous sessions, or re-read chat history | ~2,000 tokens |
| `kirograph_mem_status` | Not applicable (no manual equivalent) | ~500 tokens |

### Implementation in `naive-cost.ts`

```typescript
case 'kirograph_mem_search': {
  // Without memory, agent would re-read files to rediscover past decisions.
  // Typically 3-5 files + grep for related context.
  const limit = (args?.limit as number) || 10;
  const filesEstimate = Math.min(Math.ceil(limit / 2), 5);
  return filesEstimate * AVG_FILE_TOKENS + AVG_GREP_TOKENS;
}

case 'kirograph_mem_store': {
  // Storing has no direct naive equivalent — the knowledge would simply be lost.
  // We don't count savings on store; savings are realized on future searches.
  return null;
}

case 'kirograph_mem_timeline': {
  // Agent would ask user or re-read previous session context.
  return AVG_FILE_TOKENS + AVG_GREP_TOKENS;
}

case 'kirograph_mem_status': {
  // Lightweight status check, minimal naive cost.
  return 500;
}
```

### Gain Output Enhancement

Update `kirograph_gain` output to include memory as a source category alongside "Graph tools" and "Compression":

```
Token Savings (session):
  Total calls: 47
  Tokens without KiroGraph: ~142,000
  Tokens with KiroGraph:    ~38,000
  Saved: 104,000 tokens (73%)

By source:
  Graph tools:  32 calls, ~68,000 tokens saved (vs file reads/grep)
  Compression:  12 calls, ~31,000 tokens saved (vs raw output)
  Memory:        3 calls, ~5,000 tokens saved (vs re-discovering context)
```

### Tracking in `TokenTracker`

Add a new source type `'memory'` alongside existing `'exec'` and `'graph'`:

```typescript
// In tracker.ts
type SavingSource = 'exec' | 'graph' | 'memory';
```

Memory tool calls are tracked with `source: 'memory'` so they appear in their own category in the gain breakdown. The `bySource` stats object gets a new `memory` field:

```typescript
bySource: {
  exec: { count: number; saved: number };
  graph: { count: number; saved: number };
  memory: { count: number; saved: number };
}
```

### README Savings Table Update

Add memory tools to the savings heuristics table in the README:

```markdown
| `kirograph_mem_search` | Re-read 3-5 files to recall past decisions + grep | ~5,800 tokens |
| `kirograph_mem_timeline` | Ask user or re-read session history | ~2,300 tokens |
```

---

## Design Decisions

### D1. Memory survival during `kirograph uninit`

**Decision:** Prompt separately — same pattern as existing uninit behavior.

`kirograph uninit` already prompts "Remove integration files?" and "Remove .kirograph/ data?" separately. Memory lives inside `.kirograph/` (same DB), so it's covered by the existing data prompt. However, add a third prompt when memory has observations:

```
? Remove memory observations? (12 observations across 5 sessions) (yes/no)
```

If the user says no, `mem_*` tables are preserved even if the rest of `.kirograph/` is wiped. This is implemented by running `DELETE FROM` on non-memory tables rather than deleting the entire DB file when memory is retained.

With `--force`, everything goes (consistent with current behavior).

---

### D2. Stale symbol links after reindex

**Decision:** Use `qualified_name` as the link key, resolve to `node_id` at query time.

The schema changes:

```sql
CREATE TABLE IF NOT EXISTS mem_links (
  observation_id TEXT NOT NULL REFERENCES mem_observations(id) ON DELETE CASCADE,
  qualified_name TEXT NOT NULL,      -- stable across reindex (e.g. "src/auth/service.ts::validateToken")
  relevance REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (observation_id, qualified_name)
);

CREATE INDEX IF NOT EXISTS idx_mem_links_qname ON mem_links(qualified_name);
```

Why `qualified_name` over `node_id`:
- `node_id` is content-hashed from file+name+line — changes on reindex if the symbol moves even one line
- `qualified_name` (e.g. `src/auth/service.ts::validateToken`) is stable as long as the symbol exists in the same file with the same name
- If a symbol is renamed or deleted, the link becomes stale — cleaned up by `kirograph mem lint`

At query time, resolve `qualified_name` → current `node_id` via a JOIN on `nodes.qualified_name`. Unresolvable links are silently skipped (not an error — the symbol may have been deleted).

---

### D3. Context window pressure from `kirograph_context` + memory

**Decision:** Cap memory section at 500 tokens, show top 3 observations max.

When `kirograph_context` includes memory:
- Run `kirograph_mem_search` internally with the same task query
- Take top 3 results by score (above a relevance threshold of 0.3)
- Truncate each observation to ~150 tokens if needed
- Total memory section never exceeds ~500 tokens

This keeps `kirograph_context` output predictable. If the user wants more memory, they call `kirograph_mem_search` directly.

Config option `memoryContextLimit` (default: 3) controls how many observations are included.

---

### D4. Embedding model mismatch

**Decision:** Check `model` column on search, fall back to FTS-only if mismatched. Provide `kirograph mem reembed` command.

On every vector search:
1. Check if `mem_vectors` entries match the current `embeddingModel` from config
2. If all match → normal hybrid search
3. If mismatch → FTS-only search (skip vector component), log a warning in `kirograph mem status`

The `kirograph mem reembed` CLI command re-embeds all observations with the current model:

```bash
kirograph mem reembed              # re-embed all observations with current model
kirograph mem reembed --batch 50   # control batch size
```

This is also triggered automatically during `kirograph mem lint` if model mismatch is detected.

---

### D5. Concurrency: MCP server + CLI writing simultaneously

**Decision:** Rely on existing WAL mode + busy_timeout. Add content-hash deduplication.

SQLite WAL mode with `busy_timeout=120000` (already configured in `GraphDatabase`) handles concurrent writes safely. Multiple readers are always fine.

For the edge case of duplicate writes (two processes storing the same observation), add a `content_hash` column:

```sql
ALTER TABLE mem_observations ADD COLUMN content_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mem_obs_hash ON mem_observations(content_hash);
```

Before inserting, compute SHA-256 of the stored content. If the hash already exists, skip the insert (idempotent). This also solves the deduplication question from the original open questions.

---

### D6. Session boundaries

**Decision:** Auto-create on first write, auto-close on inactivity or `agentStop`.

No explicit "session-start" hook needed. The flow:

1. Agent calls `kirograph_mem_store` or hook fires
2. Check if an active session exists (no `ended_at`, same `ide`, started within last 2 hours)
3. If yes → attach observation to existing session
4. If no → auto-create a new session, attach observation
5. `agentStop` hook sets `ended_at` on the active session

The 2-hour inactivity window prevents a forgotten session from accumulating days of observations. Configurable via `memorySessionTimeout` (default: 7200 seconds).

This eliminates the need for `kirograph mem session-start` as a hook — sessions are implicit. The CLI command still exists for manual/scripted use but is rarely needed.

---

### D7. Memory in `kirograph_context`: when to search?

**Decision:** Always search when memory exists, but only include results above relevance threshold.

When `enableMemory=true` and `mem_observations` has rows:
1. `kirograph_context` runs its normal code graph logic
2. Additionally runs a memory search using the same `task` string
3. Only includes observations with score ≥ 0.3 (configurable via `memoryContextThreshold`)
4. If no observations pass the threshold → no "Related Memory" section appears

This means the agent never needs to make a separate `kirograph_mem_search` call for basic context — memory surfaces automatically through the tool it already uses. The agent only calls `kirograph_mem_search` directly when it wants to dig deeper or filter by kind/session.

---

### D8. Export format for portability

**Decision:** Support both JSONL (machine) and Markdown (human), with round-trip import.

```bash
kirograph mem export --format jsonl > memory.jsonl    # machine-readable, importable
kirograph mem export --format md > memory.md          # human-readable, not importable
kirograph mem import memory.jsonl                     # restore from backup
```

JSONL format (one observation per line):
```json
{"id":"...","content":"...","content_raw":"...","kind":"decision","tags":["auth"],"created_at":1234567890,"session_id":"...","links":["src/auth.ts::validateToken"]}
```

Markdown format (for reading):
```markdown
## Session 2024-03-15 (kiro)

### [decision] 14:32
stripe retry logic removed — caused duplicate charges. use idempotency keys instead.
Links: `validateToken`, `processPayment`

### [error] 15:01
500 on expired token in payment webhook. fixed by adding token refresh before charge.
Links: `handleWebhook`
```

Import skips observations whose `content_hash` already exists (deduplication).

---

### D9. Privacy controls

**Decision:** Strip `<private>...</private>` blocks at write boundary + support path exclusion patterns.

At write time (before compression, before storage):
1. Strip any content between `<private>` and `</private>` tags (inclusive)
2. Check observation text against `memoryExcludePatterns` (glob array in config) — if any file path in the text matches, skip the entire observation

Config:
```json
{
  "memoryExcludePatterns": [".env", "secrets/**", "*.key"]
}
```

This matches cavemem's privacy model. Content inside `<private>` tags never reaches disk.
