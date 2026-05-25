# Integrations

## Using with Kiro

`kirograph install` or `kirograph install --target kiro` sets up four things in your Kiro workspace (all coexist, so you can switch between IDE and CLI freely):

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
        "kirograph_circular_deps", "kirograph_path", "kirograph_type_hierarchy",
        "kirograph_architecture", "kirograph_coupling", "kirograph_package",
        "kirograph_hotspots", "kirograph_surprising", "kirograph_diff",
        "kirograph_exec", "kirograph_gain",
        "kirograph_mem_search", "kirograph_mem_store",
        "kirograph_mem_timeline", "kirograph_mem_status",
        "kirograph_docs_toc", "kirograph_docs_search",
        "kirograph_docs_section", "kirograph_docs_outline", "kirograph_docs_refs",
        "kirograph_data_list", "kirograph_data_describe",
        "kirograph_data_query", "kirograph_data_aggregate", "kirograph_data_search",
        "kirograph_data_join", "kirograph_data_correlations", "kirograph_data_quality"
      ]
    }
  }
}
```

### IDE Hooks (`.kiro/hooks/`)

Up to three hooks are installed (`.kiro.hook` extension):

| Hook file | Event | Type | Behavior |
|-----------|-------|------|----------|
| `kirograph-sync-if-dirty.kiro.hook` | `agentStop` | `runCommand` | Runs `kirograph sync --quiet` when the agent stops, syncing any file changes from the session. The sync command skips unchanged files via content hashing, so it's fast even when nothing changed. |
| `kirograph-compress-hint.kiro.hook` | `preToolUse` (shell) | `askAgent` | Reminds the agent to use `kirograph_exec` for commands that benefit from token compression (git, gh, test, lint, build, docker, aws, grep). Only installed when shell compression is enabled. |
| `kirograph-mem-capture.kiro.hook` | `agentStop` | `askAgent` | Prompts the agent to store important observations (decisions, errors, patterns) in memory at the end of each session. Only installed when memory is enabled. |

The sync hook replaces the previous per-file approach (mark-dirty-on-save, mark-dirty-on-create, sync-on-delete). A single `agentStop` hook handles all file changes in one pass with zero overhead during active editing.

### CLI Agent Config (`.kiro/agents/kirograph.json`)

A custom agent for Kiro CLI that wires up the MCP server, references the steering file as a resource, and handles sync in the CLI's own hook format. The CLI has no file-watch events, so syncing is handled at session boundaries:

| Event | Action |
|-------|--------|
| `agentSpawn` | `kirograph sync-if-dirty --quiet` (catches edits made between sessions) |
| `userPromptSubmit` | `kirograph sync-if-dirty --quiet` (keeps graph fresh within a session) |
| `stop` | `kirograph sync-if-dirty --quiet` (deferred flush, mirrors IDE `agentStop`) |

> Note: The CLI agent format only supports `command` hooks (shell commands), not `askAgent` prompts. Memory capture and compression hints are handled via the steering file instructions instead.

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

---

## Other Tools (Experimental)

> **⚠️ Not fully tested, community-contributed.** The integrations below are outside the original scope of KiroGraph. They are provided as-is. Issues and PRs related to these targets are welcome, but there is no guarantee they will be supported or merged without active help from the contributor.

KiroGraph can also be installed for other MCP-capable coding agents. All targets share the same `.kirograph/` data; if the project is already initialized, installing another target only writes that tool's integration files and reuses the existing graph.

```bash
kirograph install --target claude  # wire up Claude Code MCP + project memory
kirograph install --target codex   # write Codex instructions and print MCP config
```

### Using with Claude Code

```bash
kirograph install --target claude
```

This writes:

- `.mcp.json`: project-scoped MCP server config for Claude Code
- `.kirograph/claude.md`: KiroGraph tool guidance
- `CLAUDE.md`: an import of `.kirograph/claude.md`

Claude Code prompts for project MCP approval the first time it sees `.mcp.json`.

### Using with Codex

```bash
kirograph install --target codex
```

This writes:

- `.kirograph/codex.md`: KiroGraph tool guidance
- `AGENTS.md`: a generated KiroGraph instruction block

Codex MCP configuration is user-scoped, so the installer prints the exact `codex mcp add ...` command and equivalent `~/.codex/config.toml` snippet instead of editing files outside the project.
