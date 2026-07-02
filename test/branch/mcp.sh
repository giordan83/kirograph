#!/usr/bin/env bash
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

echo -e "\n${BOLD}  KiroGraph MCP — branch tools (enableBranch)${RESET}"
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

cat > "$TEST_DIR/package.json" << 'EOF'
{"name":"mock-branch-mcp","version":"1.0.0","private":true}
EOF
cat > "$TEST_DIR/src/core.ts" << 'EOF'
export function core(): string { return 'core'; }
EOF
git add .
git commit -q -m "feat: initial commit"

git checkout -q -b feature/new-api
cat > "$TEST_DIR/src/api.ts" << 'EOF'
export function newApi(): string { return 'new-api'; }
EOF
git add .
git commit -q -m "feat: add new API"

git checkout -q main

$KG init > /dev/null 2>&1
node -e "
const fs = require('fs'), p = '.kirograph/config.json';
const c = JSON.parse(fs.readFileSync(p,'utf8'));
c.enableBranch = true;
fs.writeFileSync(p, JSON.stringify(c,null,2));
"
$KG index > /dev/null 2>&1
$KG branch add main > /dev/null 2>&1 || true
$KG branch add feature/new-api > /dev/null 2>&1 || true

[ -f ".kirograph/kirograph.db" ] && ok "Mock inizializzato (enableBranch)" || { fail "kirograph.db non trovato"; exit 1; }

sep; echo -e "  ${BOLD}[1] kirograph_branch_list${RESET}"
run_mcp kirograph_branch_list '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || fail "output vuoto"
echo "$OUT" | grep -qiE "main|feature" && ok "elenca branch del progetto" || warn "branch non trovati"

sep; echo -e "  ${BOLD}[2] kirograph_branch_diff${RESET}"
run_mcp kirograph_branch_diff '{"branchA":"feature-new-api","branchB":"main"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"
echo "$OUT" | grep -qi "newApi\|api\|diff\|added\|change" && ok "descrive le differenze" || warn "diff non trovato"

sep; echo -e "  ${BOLD}[3] kirograph_branch_search${RESET}"
run_mcp kirograph_branch_search '{"query":"api"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"
echo "$OUT" | grep -qi "newApi\|api\|feature" && ok "trova simboli collegati ad api" || warn "simboli non trovati"

sep
echo ""
if [ "$FAILURES" -eq 0 ]; then echo -e "  ${GREEN}${BOLD}Tutti i controlli superati.${RESET}"
else echo -e "  ${RED}${BOLD}$FAILURES controllo/i fallito/i.${RESET}"; exit 1; fi
echo ""
