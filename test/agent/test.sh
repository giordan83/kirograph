#!/usr/bin/env bash
# test-agent.sh — testa i comandi agente: caveman, compression, bench, cost
#
# Uso:
#   ./test.sh            # test completo (build inclusa)
#   ./test.sh --no-build # salta la compilazione TypeScript

set -euo pipefail

NO_BUILD=false
for arg in "$@"; do
  case $arg in
    --no-build) NO_BUILD=true ;;
  esac
done

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
DIM='\033[2m'; RESET='\033[0m'; BOLD='\033[1m'; RED='\033[0;31m'
FAILURES=0

ok()   { echo -e "  ${GREEN}✓${RESET}  $1"; }
fail() { echo -e "  ${RED}✗${RESET}  $1"; FAILURES=$((FAILURES + 1)); }
info() { echo -e "  ${CYAN}›${RESET}  $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET}  $1"; }
sep()  { echo -e "\n${DIM}──────────────────────────────────────────────────────${RESET}"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_DIR="$SCRIPT_DIR/mock"
KG="node $ROOT/dist/bin/kirograph.js"

echo -e "\n${BOLD}  KiroGraph Agent — test caveman · compression · bench · cost${RESET}"
echo -e "  ${DIM}$TEST_DIR${RESET}"

# ── 1. Build ──────────────────────────────────────────────────────────────────
sep
if [ "$NO_BUILD" = false ]; then
  info "Building..."
  cd "$ROOT" && npm run build > /dev/null 2>&1
  ok "Build OK  (v$(node "$ROOT/dist/bin/kirograph.js" --version 2>/dev/null || echo '?'))"
else
  warn "--no-build: usando dist esistente"
fi

# ── 2. Setup mock project ─────────────────────────────────────────────────────
sep
info "Pulizia e creazione progetto mock..."
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR/src"

cat > "$TEST_DIR/package.json" << 'EOF'
{"name":"mock-agent","version":"1.0.0","private":true}
EOF

cat > "$TEST_DIR/src/service.ts" << 'EOF'
export class AgentService {
  run(): void { console.log('running'); }
  stop(): void { console.log('stopped'); }
}
EOF

cat > "$TEST_DIR/src/app.ts" << 'EOF'
import { AgentService } from './service';
const svc = new AgentService();
svc.run();
EOF

ok "Mock project creato in $TEST_DIR"
cd "$TEST_DIR"

# ── 3. Init + Index ───────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[1] kirograph init + index${RESET}"
$KG init 2>&1 | grep -v "^$" | sed 's/^/     /' || true
$KG index 2>&1 | grep -E "✓|file|symbol|edge|Indexed|scanning" | sed 's/^/     /' || true
[ -f ".kirograph/kirograph.db" ] && ok "kirograph.db creato" || { fail "kirograph.db non trovato"; exit 1; }

# ── 4. caveman — show current (no arg) ────────────────────────────────────────
sep
echo -e "  ${BOLD}[2] caveman${RESET}"
OUT=$($KG caveman 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "caveman (show mode): exit 0" || fail "caveman (show mode): exit $EXIT"
[ -n "$OUT" ] && ok "caveman: output non vuoto" || fail "caveman: output vuoto"
echo "$OUT" | grep -qi "off\|lite\|full\|ultra\|mode\|caveman" \
  && ok "caveman: mostra la modalità corrente" \
  || warn "caveman: modalità non riconosciuta nell'output"

# caveman set lite
OUT=$($KG caveman lite 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "caveman lite: exit 0" || fail "caveman lite: exit $EXIT"
[ -n "$OUT" ] && ok "caveman lite: output non vuoto" || warn "caveman lite: output vuoto"

# caveman set full
OUT=$($KG caveman full 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "caveman full: exit 0" || fail "caveman full: exit $EXIT"

# caveman set ultra
OUT=$($KG caveman ultra 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "caveman ultra: exit 0" || fail "caveman ultra: exit $EXIT"

# caveman reset to off
OUT=$($KG caveman off 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "caveman off: exit 0" || fail "caveman off: exit $EXIT"
echo "$OUT" | grep -qi "off\|disable\|normal\|reset" \
  && ok "caveman off: conferma disattivazione" \
  || warn "caveman off: conferma non trovata nell'output"

# ── 5. compression — show current ─────────────────────────────────────────────
sep
echo -e "  ${BOLD}[3] compression${RESET}"
OUT=$($KG compression 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "compression (show level): exit 0" || fail "compression (show level): exit $EXIT"
[ -n "$OUT" ] && ok "compression: output non vuoto" || fail "compression: output vuoto"
echo "$OUT" | grep -qi "off\|normal\|aggressive\|ultra\|compression" \
  && ok "compression: mostra il livello corrente" \
  || warn "compression: livello non riconosciuto nell'output"

# compression set normal
OUT=$($KG compression normal 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "compression normal: exit 0" || fail "compression normal: exit $EXIT"

# compression set aggressive
OUT=$($KG compression aggressive 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "compression aggressive: exit 0" || fail "compression aggressive: exit $EXIT"

# compression set ultra
OUT=$($KG compression ultra 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "compression ultra: exit 0" || fail "compression ultra: exit $EXIT"

# compression reset to off
OUT=$($KG compression off 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "compression off: exit 0" || fail "compression off: exit $EXIT"

# ── 6. bench ──────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[4] bench${RESET}"
OUT=$($KG bench 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "bench: exit 0" || fail "bench: exit $EXIT"
[ -n "$OUT" ] && ok "bench: output non vuoto" || fail "bench: output vuoto"
echo "$OUT" | grep -qiE "token|file|bench|naive|KiroGraph" \
  && ok "bench: output contiene statistiche benchmark" \
  || warn "bench: statistiche benchmark non trovate nell'output"

OUT=$($KG bench --quiet 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "bench --quiet: exit 0" || fail "bench --quiet: exit $EXIT"

# ── 7. cost ───────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[5] cost${RESET}"

# Create an empty sessions dir to avoid reading real session data
SESSIONS_DIR="$TEST_DIR/.sessions"
mkdir -p "$SESSIONS_DIR"

OUT=$($KG cost "$SESSIONS_DIR" 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "cost (empty sessions dir): exit 0" || fail "cost: exit $EXIT"
[ -n "$OUT" ] && ok "cost: output non vuoto" || warn "cost: output vuoto"
echo "$OUT" | grep -qiE "call|tool|kirograph|cost|session|0" \
  && ok "cost: output contiene statistiche (0 session files)" \
  || warn "cost: statistiche non trovate nell'output"

# ── Fine ──────────────────────────────────────────────────────────────────────
sep
echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo -e "  ${GREEN}${BOLD}Tutti i controlli superati.${RESET}"
else
  echo -e "  ${RED}${BOLD}$FAILURES controllo/i fallito/i.${RESET}"
  exit 1
fi
echo ""
