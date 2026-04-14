/**
 * KiroGraph Installer — Kiro steering file
 */

import * as fs from 'fs';
import * as path from 'path';

const STEERING_CONTENT = `---
inclusion: always
---

# KiroGraph

KiroGraph builds a semantic knowledge graph of your codebase for faster, smarter code exploration.

## When \`.kirograph/\` exists in the project

Use KiroGraph MCP tools for exploration instead of grep/glob/file reads:

### Symbol-level tools (always available)

| Tool | Use For |
|------|---------|
| \`kirograph_context\` | Get relevant code context for a task — **start here** |
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

### Architecture tools (available when \`enableArchitecture: true\` in config)

| Tool | Use For |
|------|---------|
| \`kirograph_architecture\` | Get the full package graph and layer map — **start here for architectural questions** |
| \`kirograph_package\` | Inspect one package: files it contains, what it depends on, what depends on it |
| \`kirograph_coupling\` | Coupling metrics (Ca, Ce, instability) across all packages — identify risky change points |

### Workflow

**For code tasks (bug fixes, features, refactors):**
1. Start with \`kirograph_context\` — returns entry points and related symbols in one call.
2. Use \`kirograph_search\` instead of grep for finding symbols.
3. Use \`kirograph_callers\`/\`kirograph_callees\` to trace code flow.
4. Use \`kirograph_impact\` before making changes to understand blast radius.

**For architectural questions** ("where does X live?", "what depends on Y?", "is this a safe place to change?"):
1. Start with \`kirograph_architecture\` to get the package and layer map.
2. Use \`kirograph_package\` to drill into a specific module's dependencies.
3. Use \`kirograph_coupling\` to identify which packages are most stable (high Ca, low instability) vs. most volatile (high Ce, high instability). High-instability packages are risky to change — many outgoing deps. High-Ca packages are load-bearing — many things depend on them.

**Architecture tools answer questions that symbol search cannot:**
- "Which module is the safest to refactor?" → \`kirograph_coupling\` (find lowest instability)
- "Why is this change rippling across the codebase?" → \`kirograph_package\` (check Ca of the changed package)
- "Does the UI layer import from the data layer?" → \`kirograph_architecture\` (check layer deps)
- "What does the auth package expose?" → \`kirograph_package auth\`

### If \`.kirograph/\` does NOT exist

Ask the user: "This project doesn't have KiroGraph initialized. Run \`kirograph init -i\` to build a code knowledge graph for faster exploration?"
`;

export function writeSteering(kiroDir: string): void {
  const steeringDir = path.join(kiroDir, 'steering');
  fs.mkdirSync(steeringDir, { recursive: true });
  const steeringPath = path.join(steeringDir, 'kirograph.md');
  fs.writeFileSync(steeringPath, STEERING_CONTENT);
  console.log(`  ✓ Steering file written to ${steeringPath}`);
}
