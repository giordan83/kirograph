/**
 * KiroGraph Installer — Kiro CLI agent config
 *
 * Writes .kiro/agents/kirograph.json — a workspace custom agent that wires up:
 *  - MCP server (kirograph tools)
 *  - steering instructions inlined as prompt
 *  - hooks: sync on agentSpawn, userPromptSubmit, stop
 *
 * Sync strategy (CLI has no file-watch events unlike the IDE):
 *  - agentSpawn:       sync-if-dirty — catches edits made between sessions
 *  - userPromptSubmit: sync-if-dirty — keeps graph fresh within a session
 *  - stop:             sync-if-dirty --quiet — deferred flush, mirrors IDE agentStop
 */

import * as fs from 'fs';
import * as path from 'path';

const KIROGRAPH_TOOLS = [
  '@kirograph/kirograph_search',
  '@kirograph/kirograph_context',
  '@kirograph/kirograph_callers',
  '@kirograph/kirograph_callees',
  '@kirograph/kirograph_impact',
  '@kirograph/kirograph_node',
  '@kirograph/kirograph_status',
  '@kirograph/kirograph_files',
  '@kirograph/kirograph_dead_code',
  '@kirograph/kirograph_circular_deps',
  '@kirograph/kirograph_path',
  '@kirograph/kirograph_type_hierarchy',
  '@kirograph/kirograph_architecture',
  '@kirograph/kirograph_package',
  '@kirograph/kirograph_coupling',
];

const SYNC_CMD = 'kirograph sync-if-dirty --quiet 2>/dev/null || true';

const AGENT_PROMPT = `\
KiroGraph builds a semantic knowledge graph of your codebase for faster, smarter code exploration.

## When \`.kirograph/\` exists in the project

Use KiroGraph MCP tools for exploration instead of grep/glob/file reads:

### Symbol-level tools (always available)

| Tool | Use For |
|------|---------|
| \`kirograph_context\` | Get relevant code context for a task — start here |
| \`kirograph_search\` | Find symbols by name (functions, classes, types) |
| \`kirograph_callers\` | Find what calls a function |
| \`kirograph_callees\` | Find what a function calls |
| \`kirograph_impact\` | See what's affected by changing a symbol |
| \`kirograph_node\` | Get details + source code for a symbol |
| \`kirograph_path\` | Find the shortest path between two symbols |
| \`kirograph_type_hierarchy\` | Traverse class/interface inheritance |
| \`kirograph_dead_code\` | Find symbols with no incoming references |
| \`kirograph_circular_deps\` | Detect circular import dependencies |
| \`kirograph_files\` | List the indexed file structure |
| \`kirograph_status\` | Check index health and statistics |

### Architecture tools (available when enableArchitecture=true in .kirograph/config.json)

| Tool | Use For |
|------|---------|
| \`kirograph_architecture\` | Get the full package graph and layer map — start here for architectural questions |
| \`kirograph_package\` | Inspect one package: files it contains, what it depends on, what depends on it |
| \`kirograph_coupling\` | Coupling metrics (Ca, Ce, instability) — identify risky change points |

### Workflow

**For code tasks (bug fixes, features, refactors):**
1. Start with \`kirograph_context\` — returns entry points and related symbols in one call.
2. Use \`kirograph_search\` instead of grep for finding symbols.
3. Use \`kirograph_callers\`/\`kirograph_callees\` to trace code flow.
4. Use \`kirograph_impact\` before making changes to understand blast radius.

**For architectural questions** ("where does X live?", "what depends on Y?", "is this a safe place to change?"):
1. Start with \`kirograph_architecture\` to get the package and layer map.
2. Use \`kirograph_package\` to drill into a specific module's dependencies.
3. Use \`kirograph_coupling\` to identify stable vs. volatile packages.
   - High Ca + low instability = load-bearing, safe to depend on, risky to change interface
   - High Ce + high instability = depends on many things, safe to refactor internals

**Architecture tools answer questions symbol search cannot:**
- "Which module is safest to refactor?" → kirograph_coupling (find lowest instability)
- "Why is this change rippling everywhere?" → kirograph_package (check Ca of changed package)
- "Does the UI layer import from the data layer?" → kirograph_architecture (check layer deps)
- "What does the auth module expose?" → kirograph_package auth

## If \`.kirograph/\` does NOT exist

Tell the user: "This project doesn't have KiroGraph initialized. Run \`kirograph init --index\` to build a code knowledge graph for faster exploration."
`;

const AGENT_CONFIG = {
  name: 'kirograph',
  description: 'KiroGraph-aware agent — uses the semantic code graph for faster, smarter exploration.',
  prompt: AGENT_PROMPT,
  tools: ['*'],
  allowedTools: KIROGRAPH_TOOLS,
  includeMcpJson: true,
  hooks: {
    agentSpawn: [{ command: SYNC_CMD }],
    userPromptSubmit: [{ command: SYNC_CMD }],
    stop: [{ command: SYNC_CMD }],
  },
};

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(p: string, data: unknown): void {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

export function writeCliAgent(kiroDir: string): void {
  const agentsDir = path.join(kiroDir, 'agents');
  ensureDir(agentsDir);
  const agentPath = path.join(agentsDir, 'kirograph.json');
  writeJson(agentPath, AGENT_CONFIG);
  console.log(`  ✓ CLI agent config written to ${agentPath}`);
}
