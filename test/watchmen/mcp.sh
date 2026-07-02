#!/usr/bin/env bash
# mcp.sh — testa i tool MCP del gruppo watchmen (enableWatchmen + enableMemory):
#   kirograph_watchmen_status, kirograph_watchmen_reset,
#   kirograph_watchmen_synthesize (richiede LLM locale, saltabile con --skip-llm)
#
# Uso: ./mcp.sh [--no-build] [--skip-llm]

set -euo pipefail
NO_BUILD=false; SKIP_LLM=false
for arg in "$@"; do
  case $arg in --no-build) NO_BUILD=true ;; --skip-llm) SKIP_LLM=true ;; esac
done

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

echo -e "\n${BOLD}  KiroGraph MCP — watchmen tools (enableWatchmen + enableMemory)${RESET}"
echo -e "  ${DIM}$TEST_DIR${RESET}"
[ "$SKIP_LLM" = true ] && warn "--skip-llm: kirograph_watchmen_synthesize sarà saltato"

sep
if [ "$NO_BUILD" = false ]; then
  info "Building..."
  cd "$ROOT" && npm run build > /dev/null 2>&1 && ok "Build OK"
else
  warn "--no-build: usando dist esistente"
fi

# ── Setup mock ────────────────────────────────────────────────────────────────
sep
info "Setup mock..."
cd "$TEST_DIR"
rm -rf .kirograph .kiro
$KG init > /dev/null 2>&1
node -e "
const fs = require('fs'), p = '.kirograph/config.json';
const c = JSON.parse(fs.readFileSync(p,'utf8'));
c.enableMemory = true;
c.enableWatchmen = true;
c.watchmenThreshold = 2;
c.watchmenSynthesisMode = 'local';
c.watchmenLocalModel = 'onnx-community/gemma-4-E4B-it-ONNX';
fs.writeFileSync(p, JSON.stringify(c,null,2));
"
$KG index > /dev/null 2>&1
[ -f ".kirograph/kirograph.db" ] && ok "Mock inizializzato (enableWatchmen + enableMemory)" || { fail "kirograph.db non trovato"; exit 1; }

# seed some memory observations so watchmen threshold can trigger
$KG mem store --content "AuthService refactored to use JWT" --session mcp-wm-test > /dev/null 2>&1 || true
$KG mem store --content "UserRepository migrated to ORM" --session mcp-wm-test > /dev/null 2>&1 || true
$KG mem store --content "Database connection pool increased to 20" --session mcp-wm-test > /dev/null 2>&1 || true

# ── kirograph_watchmen_status ─────────────────────────────────────────────────
sep; echo -e "  ${BOLD}[1] kirograph_watchmen_status${RESET}"
run_mcp kirograph_watchmen_status '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ]   && ok "output non vuoto" || fail "output vuoto"
echo "$OUT" | grep -qiE "watchmen|threshold|counter|status|observation|enabled" \
  && ok "descrive stato watchmen" || warn "stato non riconosciuto"

# ── kirograph_watchmen_synthesize ─────────────────────────────────────────────
sep; echo -e "  ${BOLD}[2] kirograph_watchmen_synthesize${RESET}"
if [ "$SKIP_LLM" = true ]; then
  warn "Saltato (--skip-llm): richiede LLM locale ~2GB"
  warn "Per il test completo: bash test/watchmen/mcp.sh --no-build"
else
  MODEL_CACHE="$HOME/.kirograph/models/onnx-community/gemma-4-E4B-it-ONNX"
  [ -d "$MODEL_CACHE" ] || warn "Prima esecuzione: download modello ~3-4GB"
  run_mcp kirograph_watchmen_synthesize '{}'
  [ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
  [ -n "$OUT" ]   && ok "output non vuoto" || warn "output vuoto"
fi

# ── kirograph_watchmen_reset ──────────────────────────────────────────────────
sep; echo -e "  ${BOLD}[3] kirograph_watchmen_reset${RESET}"
run_mcp kirograph_watchmen_reset '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ]   && ok "output non vuoto" || warn "output vuoto"
echo "$OUT" | grep -qiE "reset|counter|0|watchmen" && ok "conferma reset" || warn "conferma non trovata"

# verify counter went back to 0
run_mcp kirograph_watchmen_status '{}'
[ $EXIT -eq 0 ] && ok "status dopo reset: exit 0" || fail "status dopo reset: exit $EXIT"
echo "$OUT" | grep -qiE "\b0\b|counter.*0|zero|reset" \
  && ok "counter azzerato" || warn "counter post-reset non verificabile"

# ── Fine ──────────────────────────────────────────────────────────────────────
sep
echo ""
if [ "$FAILURES" -eq 0 ]; then echo -e "  ${GREEN}${BOLD}Tutti i controlli superati.${RESET}"
else echo -e "  ${RED}${BOLD}$FAILURES controllo/i fallito/i.${RESET}"; exit 1; fi
echo ""
