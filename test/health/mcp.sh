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

echo -e "\n${BOLD}  KiroGraph MCP — health tools (enableComplexity)${RESET}"
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
cat > "$TEST_DIR/package.json" << 'EOF'
{"name":"mock-health-mcp","version":"1.0.0","private":true}
EOF
cat > "$TEST_DIR/src/processor.ts" << 'EOF'
export class DataProcessor {
  processAll(items: unknown[]): unknown[] {
    const results: unknown[] = [];
    for (const item of items) {
      if (!item) continue;
      if (typeof item === 'string') {
        if (item.length === 0) continue;
        if (item.startsWith('skip')) continue;
        if (item.includes('@')) { results.push({ type: 'email', value: item }); }
        else if (item.match(/^\d+$/)) { results.push({ type: 'number', value: parseInt(item) }); }
        else { results.push({ type: 'text', value: item }); }
      } else if (typeof item === 'number') {
        if (item < 0) results.push({ type: 'neg', value: item });
        else if (item === 0) results.push({ type: 'zero', value: item });
        else if (item > 1000) results.push({ type: 'large', value: item });
        else results.push({ type: 'pos', value: item });
      } else if (Array.isArray(item)) {
        for (const n of item) { if (n != null) results.push({ type: 'nested', value: n }); }
      }
    }
    return results;
  }
  simpleAdd(a: number, b: number): number { return a + b; }
}
EOF
cat > "$TEST_DIR/src/service.ts" << 'EOF'
import { DataProcessor } from './processor';
export class Service {
  private p = new DataProcessor();
  run(items: unknown[]): unknown[] { return this.p.processAll(items); }
}
EOF

cd "$TEST_DIR"
$KG init > /dev/null 2>&1
node -e "
const fs = require('fs'), p = '.kirograph/config.json';
const c = JSON.parse(fs.readFileSync(p,'utf8'));
c.enableComplexity = true; c.trackCallSites = true;
fs.writeFileSync(p, JSON.stringify(c,null,2));
"
$KG index > /dev/null 2>&1
[ -f ".kirograph/kirograph.db" ] && ok "Mock inizializzato (enableComplexity)" || { fail "kirograph.db non trovato"; exit 1; }

sep; echo -e "  ${BOLD}[1] kirograph_complexity${RESET}"
run_mcp kirograph_complexity '{"limit":5}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || fail "output vuoto"
echo "$OUT" | grep -qi "processAll\|DataProcessor\|complexity\|cyclomatic" && ok "identifica processAll come complessa" || warn "processAll non trovata"

sep; echo -e "  ${BOLD}[2] kirograph_health${RESET}"
run_mcp kirograph_health '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || fail "output vuoto"
echo "$OUT" | grep -qiE "[0-9]|score|health|grade|Excellent|Good|Fair|Poor|Critical" && ok "output contiene score/grade" || warn "score non trovato"

sep; echo -e "  ${BOLD}[3] kirograph_dsm${RESET}"
run_mcp kirograph_dsm '{"limit":10}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[4] kirograph_test_risk${RESET}"
run_mcp kirograph_test_risk '{"limit":5}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[5] kirograph_simplify_scan${RESET}"
run_mcp kirograph_simplify_scan '{"limit":5}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep
echo ""
if [ "$FAILURES" -eq 0 ]; then echo -e "  ${GREEN}${BOLD}Tutti i controlli superati.${RESET}"
else echo -e "  ${RED}${BOLD}$FAILURES controllo/i fallito/i.${RESET}"; exit 1; fi
echo ""
