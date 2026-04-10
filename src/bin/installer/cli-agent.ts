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
];

const SYNC_CMD = 'kirograph sync-if-dirty --quiet 2>/dev/null || true';

const AGENT_PROMPT = `\
KiroGraph builds a semantic knowledge graph of your codebase for faster, smarter code exploration.

## When \`.kirograph/\` exists in the project

Use KiroGraph MCP tools for exploration instead of grep/glob/file reads:

| Tool | Use For |
|------|---------|
| \`kirograph_search\` | Find symbols by name (functions, classes, types) |
| \`kirograph_context\` | Get relevant code context for a task — start here |
| \`kirograph_callers\` | Find what calls a function |
| \`kirograph_callees\` | Find what a function calls |
| \`kirograph_impact\` | See what's affected by changing a symbol |
| \`kirograph_node\` | Get details + source code for a symbol |
| \`kirograph_status\` | Check index health and statistics |
| \`kirograph_files\` | List the indexed file structure |
| \`kirograph_dead_code\` | Find symbols with no incoming references |
| \`kirograph_circular_deps\` | Detect circular import dependencies |
| \`kirograph_path\` | Find the shortest path between two symbols |
| \`kirograph_type_hierarchy\` | Traverse class/interface inheritance |

### Workflow

1. Start with \`kirograph_context\` for any task — it returns entry points and related code in one call.
2. Use \`kirograph_search\` instead of grep for finding symbols.
3. Use \`kirograph_callers\`/\`kirograph_callees\` to trace code flow.
4. Use \`kirograph_impact\` before making changes to understand blast radius.
5. Use \`kirograph_files\` to explore the project structure.
6. Use \`kirograph_dead_code\` to identify unused code before refactoring.

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
