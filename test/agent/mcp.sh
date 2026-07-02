#!/usr/bin/env bash
# kirograph_read:     args.path (file path)
# kirograph_retrieve: args.path (file path, returns cached prev content)
# kirograph_gain:     args.period (session|today|week|all)
# kirograph_budget:   args.reset (bool, optional)
# kirograph_compress: args.text (string)
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

echo -e "\n${BOLD}  KiroGraph MCP — agent tools (enableAgentUtils + enableGeneralCompression)${RESET}"
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
{"name":"mock-agent-mcp","version":"1.0.0","private":true}
EOF
cat > "$TEST_DIR/src/service.ts" << 'EOF'
/** Main application service */
export class AgentService {
  run(): void { console.log('running'); }
  stop(): void { console.log('stopped'); }
}
EOF
cat > "$TEST_DIR/src/utils.ts" << 'EOF'
export function format(s: string): string { return s.trim(); }
export function parse(s: string): string[] { return s.split(','); }
EOF

cd "$TEST_DIR"
$KG init > /dev/null 2>&1
node -e "
const fs = require('fs'), p = '.kirograph/config.json';
const c = JSON.parse(fs.readFileSync(p,'utf8'));
c.enableAgentUtils = true;
c.enableGeneralCompression = true;
fs.writeFileSync(p, JSON.stringify(c,null,2));
"
$KG index > /dev/null 2>&1
[ -f ".kirograph/kirograph.db" ] && ok "Mock inizializzato (enableAgentUtils)" || { fail "kirograph.db non trovato"; exit 1; }

sep; echo -e "  ${BOLD}[1] kirograph_read${RESET}"
run_mcp kirograph_read '{"path":"src/service.ts"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || fail "output vuoto"
echo "$OUT" | grep -qi "AgentService\|run\|stop" && ok "contenuto del file restituito" || warn "contenuto atteso non trovato"

sep; echo -e "  ${BOLD}[2] kirograph_retrieve${RESET}"
# retrieve returns cached content; first read it via kirograph_read to populate cache
run_mcp kirograph_read '{"path":"src/utils.ts"}' > /dev/null 2>&1 || true
run_mcp kirograph_retrieve '{"path":"src/utils.ts"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"
echo "$OUT" | grep -qi "format\|parse\|utils" && ok "contenuto utils.ts restituito" || warn "contenuto non trovato"

sep; echo -e "  ${BOLD}[3] kirograph_gain${RESET}"
run_mcp kirograph_gain '{"period":"session"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

run_mcp kirograph_gain '{"period":"all"}'
[ $EXIT -eq 0 ] && ok "period=all: exit 0" || fail "period=all: exit $EXIT"

sep; echo -e "  ${BOLD}[4] kirograph_budget${RESET}"
run_mcp kirograph_budget '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

run_mcp kirograph_budget '{"reset":true}'
[ $EXIT -eq 0 ] && ok "reset=true: exit 0" || fail "reset=true: exit $EXIT"

sep; echo -e "  ${BOLD}[5] kirograph_compress${RESET}"
run_mcp kirograph_compress '{"text":"The AgentService class provides run and stop lifecycle methods for the application."}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || fail "output vuoto"

sep
echo ""
if [ "$FAILURES" -eq 0 ]; then echo -e "  ${GREEN}${BOLD}Tutti i controlli superati.${RESET}"
else echo -e "  ${RED}${BOLD}$FAILURES controllo/i fallito/i.${RESET}"; exit 1; fi
echo ""
