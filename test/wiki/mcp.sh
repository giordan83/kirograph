#!/usr/bin/env bash
# mcp.sh — testa i tool MCP del gruppo wiki (enableWiki):
#   kirograph_wiki_init, kirograph_wiki_ingest, kirograph_wiki_list,
#   kirograph_wiki_status, kirograph_wiki_search, kirograph_wiki_page,
#   kirograph_wiki_lint, kirograph_wiki_reindex,
#   kirograph_wiki_synthesize (agent mode, saltabile con --skip-llm),
#   kirograph_wiki_apply_diff
#
# Riusa il mock statico in test/wiki/mock/
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

echo -e "\n${BOLD}  KiroGraph MCP — wiki tools (enableWiki)${RESET}"
echo -e "  ${DIM}$TEST_DIR${RESET}"
[ "$SKIP_LLM" = true ] && warn "--skip-llm: kirograph_wiki_synthesize sarà saltato"

sep
if [ "$NO_BUILD" = false ]; then
  info "Building..."
  cd "$ROOT" && npm run build > /dev/null 2>&1 && ok "Build OK"
else
  warn "--no-build: usando dist esistente"
fi

# ── Setup mock ────────────────────────────────────────────────────────────────
sep
info "Setup mock (re-init su mock statico con enableWiki)..."
cd "$TEST_DIR"
rm -rf .kirograph .kiro
$KG init > /dev/null 2>&1
node -e "
const fs = require('fs'), p = '.kirograph/config.json';
const c = JSON.parse(fs.readFileSync(p,'utf8'));
c.enableWiki = true;
c.wikiSynthesisMode = 'agent';
c.wikiAutoResolveConflicts = false;
c.wikiContextLimit = 3;
c.wikiContextThreshold = 0.1;
c.enableEmbeddings = false;
fs.writeFileSync(p, JSON.stringify(c,null,2));
"
$KG index > /dev/null 2>&1
[ -f ".kirograph/kirograph.db" ] && ok "Mock indicizzato" || { fail "kirograph.db non trovato"; exit 1; }

# ── kirograph_wiki_init ───────────────────────────────────────────────────────
sep; echo -e "  ${BOLD}[1] kirograph_wiki_init${RESET}"
run_mcp kirograph_wiki_init '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ]   && ok "output non vuoto" || warn "output vuoto"

# ── kirograph_wiki_status ─────────────────────────────────────────────────────
sep; echo -e "  ${BOLD}[2] kirograph_wiki_status${RESET}"
run_mcp kirograph_wiki_status '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ]   && ok "output non vuoto" || warn "output vuoto"
echo "$OUT" | grep -qiE "wiki|page|stale|status|enabled|initialized" \
  && ok "descrive stato wiki" || warn "stato non riconosciuto"

# ── kirograph_wiki_ingest ─────────────────────────────────────────────────────
sep; echo -e "  ${BOLD}[3] kirograph_wiki_ingest${RESET}"
run_mcp kirograph_wiki_ingest '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ]   && ok "output non vuoto" || warn "output vuoto"
echo "$OUT" | grep -qiE "ingest|page|wiki|indexed|processed" \
  && ok "descrive ingestione" || warn "conferma non trovata"

# ── kirograph_wiki_list ───────────────────────────────────────────────────────
sep; echo -e "  ${BOLD}[4] kirograph_wiki_list${RESET}"
run_mcp kirograph_wiki_list '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ]   && ok "output non vuoto" || warn "output vuoto"

# ── kirograph_wiki_search ─────────────────────────────────────────────────────
sep; echo -e "  ${BOLD}[5] kirograph_wiki_search${RESET}"
run_mcp kirograph_wiki_search '{"query":"authentication"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ]   && ok "output non vuoto" || warn "output vuoto"

# ── kirograph_wiki_page ───────────────────────────────────────────────────────
sep; echo -e "  ${BOLD}[6] kirograph_wiki_page${RESET}"
run_mcp kirograph_wiki_list '{}'
FIRST_SLUG=$(echo "$OUT" | grep -oE '[a-z][a-z0-9-]+' | head -1 || echo "")
if [ -n "$FIRST_SLUG" ]; then
  run_mcp kirograph_wiki_page "{\"slug\":\"$FIRST_SLUG\"}"
  [ $EXIT -eq 0 ] && ok "page $FIRST_SLUG: exit 0" || fail "page $FIRST_SLUG: exit $EXIT"
  [ -n "$OUT" ]   && ok "output non vuoto" || warn "output vuoto"
else
  warn "nessuna pagina disponibile per il test (wiki_list vuoto)"
fi

# ── kirograph_wiki_lint ───────────────────────────────────────────────────────
sep; echo -e "  ${BOLD}[7] kirograph_wiki_lint${RESET}"
run_mcp kirograph_wiki_lint '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ]   && ok "output non vuoto" || warn "output vuoto"

# ── kirograph_wiki_reindex ────────────────────────────────────────────────────
sep; echo -e "  ${BOLD}[8] kirograph_wiki_reindex${RESET}"
run_mcp kirograph_wiki_reindex '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ]   && ok "output non vuoto" || warn "output vuoto"

# ── kirograph_wiki_synthesize ─────────────────────────────────────────────────
sep; echo -e "  ${BOLD}[9] kirograph_wiki_synthesize${RESET}"
if [ "$SKIP_LLM" = true ]; then
  warn "Saltato (--skip-llm): richiede AI agent call"
else
  run_mcp kirograph_wiki_synthesize '{}'
  [ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
  [ -n "$OUT" ]   && ok "output non vuoto" || warn "output vuoto"
fi

# ── kirograph_wiki_apply_diff ─────────────────────────────────────────────────
sep; echo -e "  ${BOLD}[10] kirograph_wiki_apply_diff${RESET}"
# diff is a string (not array); pass empty string as a no-op test
run_mcp kirograph_wiki_apply_diff '{"diff":""}'
[ $EXIT -lt 2 ] && ok "exit $EXIT (non-crash)" || fail "crash (exit $EXIT)"
[ -n "$OUT" ]   && ok "output non vuoto" || warn "output vuoto"

# ── Fine ──────────────────────────────────────────────────────────────────────
sep
echo ""
if [ "$FAILURES" -eq 0 ]; then echo -e "  ${GREEN}${BOLD}Tutti i controlli superati.${RESET}"
else echo -e "  ${RED}${BOLD}$FAILURES controllo/i fallito/i.${RESET}"; exit 1; fi
echo ""
