# Installation

## From npm (not yet available on npm registry)

```bash
npm install -g kirograph
```

## From source

```bash
git clone https://github.com/davide-desio-eleva/kirograph.git
cd kirograph
npm install
npm run build
sudo npm install -g .
```

After building, the `kirograph` and `kg` commands are available globally.

## Verify

```bash
kirograph --version
```

## Uninstallation

### Remove from a project

```bash
kirograph uninit [path]                  # Prompts to remove Kiro integration files and .kirograph/ data separately
kirograph uninit --force                 # Remove Kiro integration files + .kirograph/ data without confirmation
kirograph uninit --target all --force    # Remove all integration files (Kiro + Claude + Codex) + .kirograph/ data
```

`kirograph uninstall` is an alias for `kirograph uninit`.

Without `--force`, KiroGraph asks separately whether to remove the selected tool integration files and whether to remove the shared `.kirograph/` data. With `--force`, both are removed unconditionally.

This can remove:
- `.kirograph/`: index database, snapshots, and export directory
- Kiro target: `.kiro/hooks/kirograph-*.json`, `.kiro/steering/kirograph.md`, `.kiro/agents/kirograph.json`
- Claude target (experimental): `kirograph` from `.mcp.json`, plus the KiroGraph import from `CLAUDE.md`
- Codex target (experimental): the generated KiroGraph block from `AGENTS.md`

### Remove the CLI globally

If installed from npm:

```bash
npm uninstall -g kirograph
```

If installed from source:

```bash
cd kirograph
npm uninstall -g .
```
