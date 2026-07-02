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

echo -e "\n${BOLD}  KiroGraph MCP — security tools (enableSecurity + enablePatterns)${RESET}"
echo -e "  ${DIM}$TEST_DIR${RESET}"

sep
if [ "$NO_BUILD" = false ]; then
  info "Building..."
  cd "$ROOT" && npm run build > /dev/null 2>&1 && ok "Build OK"
else
  warn "--no-build: usando dist esistente"
fi

sep
info "Setup mock (re-init su mock statico con enableSecurity + enablePatterns)..."
cd "$TEST_DIR"
rm -rf .kirograph
$KG init > /dev/null 2>&1
node -e "
const fs = require('fs'), p = '.kirograph/config.json';
const c = JSON.parse(fs.readFileSync(p,'utf8'));
c.enableSecurity = true;
c.enableArchitecture = true;
c.enablePatterns = true;
c.enableNavigation = true;
c.securityAutoEnrich = false;
fs.writeFileSync(p, JSON.stringify(c,null,2));
"
$KG index > /dev/null 2>&1
[ -f ".kirograph/kirograph.db" ] && ok "Mock inizializzato (enableSecurity + enablePatterns)" || { fail "kirograph.db non trovato"; exit 1; }

sep; echo -e "  ${BOLD}[1] kirograph_security${RESET}"
run_mcp kirograph_security '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[2] kirograph_vulns${RESET}"
run_mcp kirograph_vulns '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
run_mcp kirograph_vulns '{"sort":"risk"}'
[ $EXIT -eq 0 ] && ok "sort=risk: exit 0" || fail "sort=risk: exit $EXIT"

sep; echo -e "  ${BOLD}[3] kirograph_sbom${RESET}"
run_mcp kirograph_sbom '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
run_mcp kirograph_sbom '{"format":"spdx"}'
[ $EXIT -eq 0 ] && ok "format=spdx: exit 0" || fail "format=spdx: exit $EXIT"

sep; echo -e "  ${BOLD}[4] kirograph_vex${RESET}"
run_mcp kirograph_vex '{}'
[ $EXIT -lt 2 ] && ok "non-crash (exit $EXIT)" || fail "crash (exit $EXIT)"

sep; echo -e "  ${BOLD}[5] kirograph_reachability${RESET}"
run_mcp kirograph_reachability '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[6] kirograph_staleness${RESET}"
run_mcp kirograph_staleness '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
run_mcp kirograph_staleness '{"format":"json"}'
[ $EXIT -eq 0 ] && ok "format=json: exit 0" || fail "format=json: exit $EXIT"

sep; echo -e "  ${BOLD}[7] kirograph_licenses${RESET}"
run_mcp kirograph_licenses '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
run_mcp kirograph_licenses '{"format":"json"}'
[ $EXIT -eq 0 ] && ok "format=json: exit 0" || fail "format=json: exit $EXIT"

sep; echo -e "  ${BOLD}[8] kirograph_attack_surface${RESET}"
run_mcp kirograph_attack_surface '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[9] kirograph_secrets${RESET}"
run_mcp kirograph_secrets '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[10] kirograph_security_flows${RESET}"
run_mcp kirograph_security_flows '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[11] kirograph_supply_chain${RESET}"
run_mcp kirograph_supply_chain '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[12] kirograph_dep_confusion${RESET}"
run_mcp kirograph_dep_confusion '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[13] kirograph_remediation${RESET}"
run_mcp kirograph_remediation '{}'
[ $EXIT -lt 2 ] && ok "non-crash (exit $EXIT)" || fail "crash (exit $EXIT)"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[14] kirograph_pattern_coverage${RESET}"
run_mcp kirograph_pattern_coverage '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || fail "output vuoto"

sep; echo -e "  ${BOLD}[15] kirograph_pattern_save_baseline${RESET}"
run_mcp kirograph_pattern_save_baseline '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[16] kirograph_pattern_diff${RESET}"
run_mcp kirograph_pattern_diff '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep
echo ""
if [ "$FAILURES" -eq 0 ]; then echo -e "  ${GREEN}${BOLD}Tutti i controlli superati.${RESET}"
else echo -e "  ${RED}${BOLD}$FAILURES controllo/i fallito/i.${RESET}"; exit 1; fi
echo ""
