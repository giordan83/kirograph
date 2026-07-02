#!/usr/bin/env bash
# kirograph_commit_context: uses staged changes (no args)
# kirograph_pr_context: requires base ref (e.g. HEAD~1)
# kirograph_changelog: requires ref1 (e.g. HEAD~1), ref2 defaults to HEAD
set -euo pipefail
NO_BUILD=false
for arg in "$@"; do case $arg in --no-build) NO_BUILD=true ;; esac; done

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
DIM='\033[2m'; RESET='\033[0m'; BOLD='\033[1m'; RED='\033[0;31m'
FAILURES=0
ok()   { echo -e "  ${GREEN}✓${RESET}  $1"; }
fail() { echo -e "  ${RED}✗${RESET}  $1"; FAILURES=$((FAILURES + 1)); }
warn() { echo -e "  ${YELLOW}⚠${RESET}  $1"; }
info() { echo -e "  ${CYAN}›${RESET}  $1"; }
sep()  { echo -e "\n${DIM}──────────────────────────────────────────────────────${RESET}"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_DIR="$SCRIPT_DIR/mock"
KG="node $ROOT/dist/bin/kirograph.js"
MCP_BIN="node $ROOT/test/mcp-call.js"
run_mcp() { local a; a="${2:-}"; [ -z "$a" ] && a="{}"; if OUT=$($MCP_BIN "$TEST_DIR" "$1" "$a" 2>&1); then EXIT=0; else EXIT=$?; fi; }

echo -e "\n${BOLD}  KiroGraph MCP — git tools (enableGitContext)${RESET}"
echo -e "  ${DIM}$TEST_DIR${RESET}"

sep
if [ "$NO_BUILD" = false ]; then
  info "Building..."
  cd "$ROOT" && npm run build > /dev/null 2>&1 && ok "Build OK"
else
  warn "--no-build: usando dist esistente"
fi

sep
info "Setup mock..."
rm -rf "$TEST_DIR" && mkdir -p "$TEST_DIR/src"
cd "$TEST_DIR"
git init -q
git config user.email "test@test.com"
git config user.name "Test"

cat > "$TEST_DIR/src/service.ts" << 'EOF'
export class Service { greet(name: string): string { return `Hello, ${name}`; } }
EOF
cat > "$TEST_DIR/package.json" << 'EOF'
{"name":"mock-git-mcp","version":"1.0.0","private":true}
EOF
git add .
git commit -q -m "feat: initial service"

cat > "$TEST_DIR/src/utils.ts" << 'EOF'
export function format(s: string): string { return s.trim(); }
EOF
git add .
git commit -q -m "feat: add utils"

# staged change for diff/commit context
cat > "$TEST_DIR/src/service.ts" << 'EOF'
export class Service {
  greet(name: string): string { return `Hello, ${name}!`; }
  farewell(name: string): string { return `Goodbye, ${name}`; }
}
EOF
git add src/service.ts

$KG init > /dev/null 2>&1
node -e "
const fs = require('fs'), p = '.kirograph/config.json';
const c = JSON.parse(fs.readFileSync(p,'utf8'));
c.enableGitContext = true;
fs.writeFileSync(p, JSON.stringify(c,null,2));
"
$KG index > /dev/null 2>&1
[ -f ".kirograph/kirograph.db" ] && ok "Mock inizializzato (enableGitContext)" || { fail "kirograph.db non trovato"; exit 1; }

# ── kirograph_diff_context ────────────────────────────────────────────────────
sep; echo -e "  ${BOLD}[1] kirograph_diff_context${RESET}"
run_mcp kirograph_diff_context '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || fail "output vuoto"
echo "$OUT" | grep -qi "farewell\|service\|diff\|staged\|change" && ok "descrive il diff staged" || warn "contenuto diff non trovato"

# ── kirograph_commit_context ─────────────────────────────────────────────────
# Takes no arguments — reads staged changes via git
sep; echo -e "  ${BOLD}[2] kirograph_commit_context${RESET}"
run_mcp kirograph_commit_context '{}'
# may return "No staged changes" or actual staged context — both are valid (exit 0)
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

# ── kirograph_pr_context ──────────────────────────────────────────────────────
# requires base ref
sep; echo -e "  ${BOLD}[3] kirograph_pr_context${RESET}"
run_mcp kirograph_pr_context '{"base":"HEAD~1"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

# ── kirograph_changelog ───────────────────────────────────────────────────────
# requires ref1
sep; echo -e "  ${BOLD}[4] kirograph_changelog${RESET}"
run_mcp kirograph_changelog '{"ref1":"HEAD~1"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"
echo "$OUT" | grep -qi "feat\|utils\|changelog\|commit" && ok "elenca commit" || warn "commit non trovati"

# full range
run_mcp kirograph_changelog '{"ref1":"HEAD~2","ref2":"HEAD"}'
[ $EXIT -eq 0 ] && ok "ref1..ref2 range: exit 0" || fail "ref1..ref2 range: exit $EXIT"

sep
echo ""
if [ "$FAILURES" -eq 0 ]; then echo -e "  ${GREEN}${BOLD}Tutti i controlli superati.${RESET}"
else echo -e "  ${RED}${BOLD}$FAILURES controllo/i fallito/i.${RESET}"; exit 1; fi
echo ""
