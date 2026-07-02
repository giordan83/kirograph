#!/usr/bin/env bash
# mem_store:              content, kind, topicKey
# mem_mark_reviewed:      id (not sessionId)
# mem_capture:            content (structured headings)
# mem_save_prompt:        content (single string)
# mem_suggest_topic_key:  kind + title
# mem_judge:              relationId, relation, confidence
# mem_conflicts_ignore:   relationId (singular)
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

echo -e "\n${BOLD}  KiroGraph MCP — mem tools (enableMemory)${RESET}"
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
cd "$TEST_DIR"
rm -rf .kirograph .kiro
$KG init > /dev/null 2>&1
node -e "
const fs = require('fs'), p = '.kirograph/config.json';
const c = JSON.parse(fs.readFileSync(p,'utf8'));
c.enableMemory = true;
fs.writeFileSync(p, JSON.stringify(c,null,2));
"
$KG index > /dev/null 2>&1
[ -f ".kirograph/kirograph.db" ] && ok "Mock inizializzato (enableMemory)" || { fail "kirograph.db non trovato"; exit 1; }

sep; echo -e "  ${BOLD}[1] kirograph_mem_status${RESET}"
run_mcp kirograph_mem_status '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[2] kirograph_mem_store${RESET}"
run_mcp kirograph_mem_store '{"content":"AuthService handles login via JWT tokens","kind":"note","topicKey":"architecture"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"
# capture the stored observation id for mark_reviewed
OBS_ID=$(echo "$OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || echo "")

# store a second observation
run_mcp kirograph_mem_store '{"content":"UserRepository uses direct SQL queries without ORM","kind":"note","topicKey":"database"}'

sep; echo -e "  ${BOLD}[3] kirograph_mem_search${RESET}"
run_mcp kirograph_mem_search '{"query":"authentication"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"
echo "$OUT" | grep -qi "AuthService\|JWT\|auth\|login" && ok "trova osservazione auth" || warn "osservazione non trovata"

sep; echo -e "  ${BOLD}[4] kirograph_mem_timeline${RESET}"
run_mcp kirograph_mem_timeline '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[5] kirograph_mem_review${RESET}"
run_mcp kirograph_mem_review '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[6] kirograph_mem_mark_reviewed${RESET}"
if [ -n "$OBS_ID" ]; then
  run_mcp kirograph_mem_mark_reviewed "{\"id\":\"$OBS_ID\"}"
  [ $EXIT -eq 0 ] && ok "exit 0 (id=$OBS_ID)" || fail "exit $EXIT — $OUT"
else
  warn "OBS_ID non estratto — skip mark_reviewed"
fi

sep; echo -e "  ${BOLD}[7] kirograph_mem_capture${RESET}"
run_mcp kirograph_mem_capture '{"content":"## Key Learnings\nDatabaseService uses connection pooling\n## Decisions\nChoose PostgreSQL over MySQL"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[8] kirograph_mem_save_prompt${RESET}"
run_mcp kirograph_mem_save_prompt '{"content":"Explain how authentication works in this codebase"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[9] kirograph_mem_suggest_topic_key${RESET}"
run_mcp kirograph_mem_suggest_topic_key '{"kind":"note","title":"UserRepository SQL queries"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"
echo "$OUT" | grep -qi "topic_key\|suggested\|user" && ok "suggerisce topic_key" || warn "output non riconosciuto"

sep; echo -e "  ${BOLD}[10] kirograph_mem_compare${RESET}"
# requires observationA, observationB, relation — without them returns validation error (still exit 0)
run_mcp kirograph_mem_compare '{"observationA":"id-a","observationB":"id-b","relation":"confirms"}'
[ $EXIT -lt 2 ] && ok "non-crash (exit $EXIT)" || fail "crash (exit $EXIT)"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[11] kirograph_mem_judge${RESET}"
# judges a conflict relation; if none exist it returns an error string (isError:false)
run_mcp kirograph_mem_judge '{"relationId":"nonexistent","relation":"confirms","confidence":0.9}'
[ $EXIT -lt 2 ] && ok "non-crash (exit $EXIT)" || fail "crash (exit $EXIT)"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[12] kirograph_mem_conflicts_scan${RESET}"
run_mcp kirograph_mem_conflicts_scan '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[13] kirograph_mem_conflicts_list${RESET}"
run_mcp kirograph_mem_conflicts_list '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"

sep; echo -e "  ${BOLD}[14] kirograph_mem_conflicts_ignore${RESET}"
run_mcp kirograph_mem_conflicts_ignore '{"relationId":"nonexistent-id"}'
[ $EXIT -lt 2 ] && ok "non-crash (exit $EXIT)" || fail "crash (exit $EXIT)"

sep; echo -e "  ${BOLD}[15] kirograph_mem_lint${RESET}"
run_mcp kirograph_mem_lint '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[16] kirograph_mem_prune${RESET}"
run_mcp kirograph_mem_prune '{"dryRun":true}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep
echo ""
if [ "$FAILURES" -eq 0 ]; then echo -e "  ${GREEN}${BOLD}Tutti i controlli superati.${RESET}"
else echo -e "  ${RED}${BOLD}$FAILURES controllo/i fallito/i.${RESET}"; exit 1; fi
echo ""
