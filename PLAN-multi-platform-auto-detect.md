# Multi-Platform Auto-Detection & Config Fixes — Implementation Plan

## Overview

Add auto-detection of installed AI coding platforms so `kirograph install` (with no `--target` flag) automatically discovers and configures all detected tools. Also fix several targets that are writing to incorrect paths or not writing MCP configs at all.

---

## Target Audit: KiroGraph vs CRG (code-review-graph)

### Shared Targets — Config Path Comparison

| Target | CRG Config Path | CRG Key | KiroGraph Config Path | KiroGraph Key | Status |
|--------|----------------|---------|----------------------|---------------|--------|
| **Kiro** | `root/.kiro/settings/mcp.json` | `mcpServers` | `root/.kiro/settings/mcp.json` | `mcpServers` | ✅ Correct |
| **Claude Code** | `root/.mcp.json` | `mcpServers` | `root/.mcp.json` | `mcpServers` | ✅ Correct |
| **Cursor** | `root/.cursor/mcp.json` | `mcpServers` | `root/.cursor/mcp.json` | `mcpServers` | ✅ Correct |
| **Gemini CLI** | `root/.gemini/settings.json` | `mcpServers` | `root/.gemini/settings.json` | `mcpServers` | ✅ Correct |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` | `mcpServers` | ❌ Prints instructions only | — | ⚠️ Fix: write directly |
| **Codex** | `~/.codex/config.toml` | `mcp_servers` (TOML) | `root/.codex/hooks.json` (hooks only) | — | ⚠️ MCP not written (acceptable — uses `codex mcp add` CLI) |
| **Copilot** | `root/.vscode/mcp.json` | `servers` | `root/.github/copilot-mcp.json` | `mcpServers` | ⚠️ Wrong path & key |
| **Copilot CLI** | `~/.copilot/mcp-config.json` | `servers` | Not implemented | — | ❌ Missing target |
| **Continue** | `~/.continue/config.json` | `mcpServers` (array) | `root/.continue/mcpServers/kirograph.json` | `mcpServers` (object) | ✅ KiroGraph uses newer approach |
| **OpenCode** | `root/.opencode.json` key `mcpServers` | object | `root/.opencode.json` key `mcp` | object | ✅ KiroGraph uses correct current spec |
| **Antigravity** | `~/.gemini/antigravity/mcp_config.json` | `mcpServers` | ❌ Prints instructions only | — | ⚠️ Fix: write directly |
| **Qoder** | `root/.qoder/mcp.json` | `mcpServers` | Generic (print only) | — | ⚠️ Fix: write directly |
| **Qwen** | `~/.qwen/settings.json` | `mcpServers` | Generic (print only) | — | ⚠️ Fix: write directly |

### KiroGraph-Only Targets (not in CRG)

| Target | Config Path | Status |
|--------|-------------|--------|
| Cline | Prints `~/.cline/mcp.json` instructions | Acceptable (user-scoped) |
| Junie | JetBrains-specific | OK |
| Roo Code | `root/.roo/mcp.json` | ✅ Correct |
| Warp | `root/.warp/.mcp.json` | ✅ Correct |
| Aider | CLI flag `--mcp` | ✅ Correct (no config file) |
| Trae | `root/.trae/mcp.json` | ✅ Correct |
| Augment | — | OK |
| Kilo Code | — | OK |
| Amp | `root/.amp/config.json` | ✅ Correct |
| Devin | — | OK |
| Replit | — | OK |
| Goose | CLI `goose mcp add` | ✅ Correct (no config file) |
| OpenHands | — | OK |
| Tabnine | — | OK |

---

## Phase 1: Auto-Detection Layer

**File**: `src/bin/installer/detect.ts`

### What to build

```typescript
export interface PlatformDetector {
  target: InstallTarget;
  label: string;
  detect: (projectRoot: string) => boolean;
}

export function detectPlatforms(projectRoot: string): InstallTarget[];
```

### Detection heuristics per target

| Target | Detection Logic |
|--------|----------------|
| Kiro | `~/.kiro` exists OR `root/.kiro` exists |
| Claude Code | `claude` binary on PATH |
| Cursor | `~/.cursor` exists OR `root/.cursor` exists |
| Windsurf | `~/.codeium/windsurf` exists |
| Codex | `~/.codex` exists OR `codex` binary on PATH |
| Copilot | `~/.vscode` exists OR `root/.vscode` exists |
| Copilot CLI | `~/.copilot` exists |
| Gemini CLI | `gemini` binary on PATH OR `~/.gemini` exists |
| Cline | `root/.cline` exists OR `~/.cline` exists |
| Roo Code | `root/.roo` exists |
| Warp | `root/.warp` exists OR `warp` binary on PATH |
| Continue | `~/.continue` exists OR `root/.continue` exists |
| OpenCode | `root/.opencode.json` exists |
| Antigravity | `~/.gemini/antigravity` exists |
| Trae | `root/.trae` exists |
| Amp | `root/.amp` exists |
| Aider | `aider` binary on PATH |
| Goose | `goose` binary on PATH |
| Junie | `root/.junie` exists OR JetBrains IDE detected |
| Augment | `root/.augment` exists |

### Notes
- Use `which` / `execSync` for binary detection (wrapped in try/catch)
- Filesystem checks use `fs.existsSync`
- Return only targets where `detect()` returns true

---

## Phase 2: Update `install` Command

**File**: `src/bin/commands/install.ts`

### Changes

1. Add `--all` flag: install for all detected platforms in one pass
2. Change default behavior (no `--target`): auto-detect, show list, prompt user
3. Add `--dry-run` flag: show what would be written without writing

### New flow when no `--target` is provided

```
$ kirograph install

  Detected platforms:
    ✓ Kiro          (.kiro/ found)
    ✓ Claude Code   (claude on PATH)
    ✓ Cursor        (.cursor/ found)

  Install KiroGraph for all 3 detected platforms? [Y/n]
```

### New flow with `--all`

```
$ kirograph install --all
  # Skips prompt, installs for all detected platforms
```

### New flow with `--dry-run`

```
$ kirograph install --target cursor --dry-run
  [dry-run] Would write .cursor/mcp.json
  [dry-run] Would write .cursor/rules/kirograph.mdc
  [dry-run] Would write .cursor/hooks.json
```

---

## Phase 3: Fix Target Config Paths

### 3a. Windsurf — Write MCP directly

**File**: `src/bin/installer/targets/windsurf.ts`

Change `installWindsurfEarly` to write MCP config to `~/.codeium/windsurf/mcp_config.json`:

```typescript
export function installWindsurfEarly(projectRoot: string): void {
  const mcpPath = path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json');
  ensureDir(path.dirname(mcpPath));
  const existing = readJson(mcpPath);
  existing.mcpServers = existing.mcpServers ?? {};
  existing.mcpServers[KIROGRAPH_SERVER_NAME] = {
    command: KIROGRAPH_COMMAND,
    args: KIROGRAPH_MCP_ARGS,
  };
  writeJson(mcpPath, existing);
  console.log(`  ✓ Windsurf MCP server registered in ${mcpPath}`);
}
```

### 3b. Antigravity — Write MCP directly

**File**: `src/bin/installer/targets/antigravity.ts`

Change `installAntigravityEarly` to write MCP config to `~/.gemini/antigravity/mcp_config.json`:

```typescript
export function installAntigravityEarly(projectRoot: string): void {
  const mcpPath = path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json');
  ensureDir(path.dirname(mcpPath));
  const existing = readJson(mcpPath);
  existing.mcpServers = existing.mcpServers ?? {};
  existing.mcpServers[KIROGRAPH_SERVER_NAME] = {
    command: KIROGRAPH_COMMAND,
    args: KIROGRAPH_MCP_ARGS,
  };
  writeJson(mcpPath, existing);
  console.log(`  ✓ Antigravity MCP server registered in ${mcpPath}`);
}
```

### 3c. Copilot — Fix path and key

**File**: `src/bin/installer/targets/copilot.ts`

Write to BOTH paths for maximum compatibility:
- `root/.vscode/mcp.json` with `"servers"` key (VS Code Copilot Chat)
- `root/.github/copilot-mcp.json` with `"mcpServers"` key (GitHub Copilot agent mode)

```typescript
export function installCopilotEarly(projectRoot: string): void {
  // VS Code Copilot Chat format
  const vscodeMcpPath = path.join(projectRoot, '.vscode', 'mcp.json');
  ensureDir(path.dirname(vscodeMcpPath));
  const vscodeConfig = readJson(vscodeMcpPath);
  vscodeConfig.servers = vscodeConfig.servers ?? {};
  vscodeConfig.servers[KIROGRAPH_SERVER_NAME] = {
    type: 'stdio',
    command: KIROGRAPH_COMMAND,
    args: KIROGRAPH_MCP_ARGS,
  };
  writeJson(vscodeMcpPath, vscodeConfig);
  console.log(`  ✓ Copilot MCP registered in ${vscodeMcpPath}`);

  // GitHub Copilot agent mode format (keep for compat)
  const ghMcpPath = path.join(projectRoot, '.github', 'copilot-mcp.json');
  writeMcpServersConfig(ghMcpPath, {
    command: KIROGRAPH_COMMAND,
    args: KIROGRAPH_MCP_ARGS,
  });
  console.log(`  ✓ Copilot MCP registered in ${ghMcpPath}`);
}
```

### 3d. Qoder — Promote from generic to proper target

**File**: `src/bin/installer/targets/generic.ts` → new `src/bin/installer/targets/qoder.ts`

Write MCP to `root/.qoder/mcp.json` with `mcpServers` key.

### 3e. Qwen — Promote from generic to proper target

**File**: `src/bin/installer/targets/generic.ts` → new `src/bin/installer/targets/qwen.ts`

Write MCP to `~/.qwen/settings.json` with `mcpServers` key.

---

## Phase 4: Add Copilot CLI Target

**File**: `src/bin/installer/targets/copilot-cli.ts`

```typescript
// MCP: ~/.copilot/mcp-config.json with "servers" key
// Detection: ~/.copilot exists

export function installCopilotCliEarly(): void {
  const mcpPath = path.join(os.homedir(), '.copilot', 'mcp-config.json');
  ensureDir(path.dirname(mcpPath));
  const config = readJson(mcpPath);
  config.servers = config.servers ?? {};
  config.servers[KIROGRAPH_SERVER_NAME] = {
    type: 'stdio',
    command: KIROGRAPH_COMMAND,
    args: KIROGRAPH_MCP_ARGS,
  };
  writeJson(mcpPath, config);
}
```

Also:
- Add `'copilot-cli'` to `InstallTarget` type
- Add to `INSTALL_TARGETS` array in `install.ts`
- Add to `getTargetInstaller()` in `targets/index.ts`
- Add detection in `detect.ts`

---

## Phase 5: Add `--dry-run` Flag

**Files**: `src/bin/commands/install.ts`, `src/bin/installer/index.ts`, all targets

### Changes

1. Add `dryRun: boolean` parameter to `installEarly` and `installLate` interfaces
2. When `dryRun` is true, print what would be written but don't write
3. Add `--dry-run` flag to the `install` command

### Implementation approach

Add a `dryRun` option to the installer context rather than changing every target signature:

```typescript
// In installer/index.ts
let DRY_RUN = false;
export function setDryRun(v: boolean) { DRY_RUN = v; }
export function isDryRun() { return DRY_RUN; }
```

Then wrap `writeJson`, `writeMcpServersConfig`, `fs.writeFileSync` calls in targets with a dry-run check.

---

## Phase 6: Update Documentation

### 6a. README.md

**Changes**:
- Update the integration note at the top to mention auto-detection:
  > `kirograph install` auto-detects your AI coding tools and configures them all. Or use `--target <name>` for a specific platform.
- Add an "Auto-Detection" section under Quick Start showing the new flow
- Update the supported platforms count
- Add a table of all 33 supported targets with their config paths

### 6b. docs/index.html (landing page)

**Changes**:
- Update the hero/feature section to highlight multi-platform support
- Add a "Supported Platforms" visual grid or badge row showing all supported tools
- Update the Quick Start code block to show `kirograph install` with auto-detection output
- Add a note about `--target` for single-platform installs

### 6c. docs/docs.html (full docs page)

**Changes**:
- Add an "Auto-Detection" section in the Installation/Getting Started area
- Document the detection heuristics (what KiroGraph looks for per platform)
- Document the `--all` and `--dry-run` flags
- Update the Integrations section with the full target list and their config paths
- Add troubleshooting notes for platforms where MCP is user-scoped vs workspace-scoped

---

## Phase 7: Additional Improvements (Nice-to-Haves)

### 7a. `kirograph install --target all` as alias for auto-detect-and-install-all

Currently `--all` is proposed as a separate flag. Consider also accepting `--target all` as a synonym (CRG uses `--platform all`). This is a one-liner in `install.ts`.

### 7b. Uninit support for user-scoped configs

Currently `uninit` only cleans workspace-level files. For targets where we now write user-scoped configs (Windsurf at `~/.codeium/windsurf/`, Antigravity at `~/.gemini/antigravity/`, Copilot CLI at `~/.copilot/`), the `uninit()` function should also remove the kirograph entry from those files.

### 7c. Idempotent re-install (skip if already configured)

CRG checks if the server entry already exists before writing and prints "already configured" instead of overwriting. KiroGraph should do the same — check if `kirograph` key already exists in the target config and skip with a message. Most targets already do this for hooks (dedup check), but not all do it for MCP config.

### 7d. `kirograph status --integrations` subcommand

Show which platforms are currently configured in this workspace:

```
$ kirograph status --integrations
  Configured:
    ✓ Kiro          .kiro/settings/mcp.json
    ✓ Cursor        .cursor/mcp.json
    ✓ Claude Code   .mcp.json
  Detected but not configured:
    ○ Windsurf      ~/.codeium/windsurf/mcp_config.json
    ○ Copilot       .vscode/mcp.json
```

This uses the same detection logic from Phase 1 plus a check for whether the kirograph entry exists in each config file.

### 7e. Cline MCP — Write directly instead of print-only

CRG doesn't support Cline, but the MCP config path is known: workspace-level `.cline/mcp_settings.json` (not user-scoped as currently documented in KiroGraph). Consider writing it directly:

```typescript
// .cline/mcp_settings.json
{
  "mcpServers": {
    "kirograph": {
      "command": "kirograph",
      "args": ["serve", "--mcp"],
      "disabled": false
    }
  }
}
```

---

## Execution Order

| # | Phase | Depends On | Effort |
|---|-------|-----------|--------|
| 1 | Phase 1: Auto-Detection Layer | — | Medium |
| 2 | Phase 3: Fix Target Config Paths | — | Medium |
| 3 | Phase 2: Update Install Command | Phase 1 | Medium |
| 4 | Phase 4: Copilot CLI Target | — | Small |
| 5 | Phase 5: Dry-Run Flag | Phase 2 | Small |
| 6 | Phase 6: Update Documentation | All above | Medium |
| 7 | Phase 7a: `--target all` alias | Phase 2 | Tiny |
| 8 | Phase 7b: Uninit for user-scoped configs | Phase 3 | Small |
| 9 | Phase 7c: Idempotent re-install | Phase 3 | Small |
| 10 | Phase 7d: `status --integrations` | Phase 1 | Medium |
| 11 | Phase 7e: Cline MCP write | — | Small |

Phases 1, 2 (fix paths), and 4 can be done in parallel since they're independent.
Phase 3 (install command) depends on Phase 1 (detection).
Phase 6 (docs) should be done last after all code changes are stable.
Phase 7 items are independent nice-to-haves that can be cherry-picked.

---

## Out of Scope (but worth noting for future)

These are things CRG does that KiroGraph doesn't, but aren't part of this plan:

| Feature | CRG Approach | Notes |
|---------|-------------|-------|
| **Serve command detection** | Detects Poetry/uv/uvx/pip and generates the right launch command per environment | KiroGraph always uses `kirograph` binary (simpler since it's npm-installed globally). Not needed unless you add `npx kirograph` support. |
| **TOML config writing** | Custom TOML serializer for Codex `~/.codex/config.toml` | Low priority — the `codex mcp add` CLI command approach is cleaner. |
| **JSONC parsing** | Strips comments and trailing commas before parsing (for Zed) | Add if you ever support Zed as a target. |
| **Git pre-commit hook** | Installs `.git/hooks/pre-commit` that runs detect-changes | KiroGraph uses agent-level hooks instead. Could be a future addition for CI. |
| **Skills/prompts generation** | Generates platform-native skill files (Claude skills, Gemini skills) | KiroGraph uses steering files and instructions instead. Different approach, both valid. |

---

## Files to Create

- `src/bin/installer/detect.ts` — Platform detection logic
- `src/bin/installer/targets/copilot-cli.ts` — New Copilot CLI target
- `src/bin/installer/targets/qoder.ts` — Promoted from generic
- `src/bin/installer/targets/qwen.ts` — Promoted from generic

## Files to Modify

- `src/bin/commands/install.ts` — Add `--all`, `--dry-run`, default auto-detect
- `src/bin/installer/index.ts` — Support multi-target install loop
- `src/bin/installer/common.ts` — Add `InstallTarget` entries, dry-run helpers
- `src/bin/installer/targets/index.ts` — Register new targets
- `src/bin/installer/targets/windsurf.ts` — Write MCP directly
- `src/bin/installer/targets/antigravity.ts` — Write MCP directly
- `src/bin/installer/targets/copilot.ts` — Fix path + key, write both formats
- `src/bin/installer/targets/generic.ts` — Remove qoder/qwen (promoted)
- `README.md` — Update integration section, add auto-detect docs
- `docs/index.html` — Update hero, add platform grid
- `docs/docs.html` — Add auto-detection docs, update integrations section
