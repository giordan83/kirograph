#!/usr/bin/env bash
# data_search:   requires dataset + query
# data_join:     requires leftColumn + rightColumn (not "on")
# data_aggregate: groupBy must be array
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

echo -e "\n${BOLD}  KiroGraph MCP — data tools (enableData)${RESET}"
echo -e "  ${DIM}$TEST_DIR${RESET}"

sep
if [ "$NO_BUILD" = false ]; then
  info "Building..."
  cd "$ROOT" && npm run build > /dev/null 2>&1 && ok "Build OK"
else
  warn "--no-build: usando dist esistente"
fi

sep
info "Setup mock (re-init su mock statico con enableData)..."
cd "$TEST_DIR"
rm -rf .kirograph .kiro
$KG init > /dev/null 2>&1
node -e "
const fs = require('fs'), p = '.kirograph/config.json';
const c = JSON.parse(fs.readFileSync(p,'utf8'));
c.enableData = true;
fs.writeFileSync(p, JSON.stringify(c,null,2));
"
$KG index > /dev/null 2>&1
[ -f ".kirograph/kirograph.db" ] && ok "Mock inizializzato (enableData)" || { fail "kirograph.db non trovato"; exit 1; }

sep; echo -e "  ${BOLD}[1] kirograph_data_list${RESET}"
run_mcp kirograph_data_list '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || fail "output vuoto"
echo "$OUT" | grep -qiE "csv|jsonl|json|parquet|dataset" && ok "elenca dataset" || warn "dataset non trovati"

sep; echo -e "  ${BOLD}[2] kirograph_data_describe${RESET}"
run_mcp kirograph_data_describe '{"dataset":"data-users"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
echo "$OUT" | grep -qiE "column|row|field|name|age|email" && ok "descrive struttura" || warn "struttura non trovata"

sep; echo -e "  ${BOLD}[3] kirograph_data_query${RESET}"
run_mcp kirograph_data_query '{"dataset":"data-users","limit":3}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

run_mcp kirograph_data_query '{"dataset":"data-orders","limit":2}'
[ $EXIT -eq 0 ] && ok "data-orders: exit 0" || fail "data-orders: exit $EXIT"

sep; echo -e "  ${BOLD}[4] kirograph_data_aggregate${RESET}"
run_mcp kirograph_data_aggregate '{"dataset":"data-users","groupBy":["age"]}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[5] kirograph_data_search${RESET}"
run_mcp kirograph_data_search '{"dataset":"data-users","query":"email"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[6] kirograph_data_join${RESET}"
run_mcp kirograph_data_join '{"left":"data-users","right":"data-orders","leftColumn":"id","rightColumn":"id"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[7] kirograph_data_correlations${RESET}"
run_mcp kirograph_data_correlations '{"dataset":"data-users"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[8] kirograph_data_quality${RESET}"
run_mcp kirograph_data_quality '{"dataset":"data-users"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[9] kirograph_data_drift${RESET}"
run_mcp kirograph_data_drift '{"dataset":"data-users"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[10] kirograph_data_history${RESET}"
run_mcp kirograph_data_history '{"dataset":"data-users"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep
echo ""
if [ "$FAILURES" -eq 0 ]; then echo -e "  ${GREEN}${BOLD}Tutti i controlli superati.${RESET}"
else echo -e "  ${RED}${BOLD}$FAILURES controllo/i fallito/i.${RESET}"; exit 1; fi
echo ""
