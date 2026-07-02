#!/usr/bin/env bash
# mcp.sh — testa i tool MCP del gruppo edit (enableEditPrimitives):
#   kirograph_str_replace, kirograph_multi_str_replace, kirograph_insert_at
#
# Arg reali (da src/mcp/handlers/edit-primitives.ts):
#   str_replace:       file, old_str, new_str
#   multi_str_replace: file, pairs:[{old_str,new_str}]
#   insert_at:         file, anchor|line, content, position
#
# Uso: ./mcp.sh [--no-build]

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
MCP="node $ROOT/test/mcp-call.js"

echo -e "\n${BOLD}  KiroGraph MCP — edit tools (enableEditPrimitives)${RESET}"
echo -e "  ${DIM}$TEST_DIR${RESET}"

sep
if [ "$NO_BUILD" = false ]; then
  info "Building..."
  cd "$ROOT" && npm run build > /dev/null 2>&1 && ok "Build OK"
else
  warn "--no-build: usando dist esistente"
fi

# helper: reset target file to known state
reset_target() {
cat > "$TEST_DIR/src/target.ts" << 'EOF'
// ALPHA_SENTINEL_1
export function greet(name: string): string {
  return `Hello, ${name}`;
}
// BETA_SENTINEL_2
export function farewell(name: string): string {
  return `Goodbye, ${name}`;
}
EOF
}

# ── Setup mock ────────────────────────────────────────────────────────────────
sep
info "Setup mock..."
rm -rf "$TEST_DIR" && mkdir -p "$TEST_DIR/src"
cat > "$TEST_DIR/package.json" << 'EOF'
{"name":"mock-edit-mcp","version":"1.0.0","private":true}
EOF
reset_target

cd "$TEST_DIR"
$KG init > /dev/null 2>&1
node -e "
const fs = require('fs'), p = '.kirograph/config.json';
const c = JSON.parse(fs.readFileSync(p,'utf8'));
c.enableEditPrimitives = true;
fs.writeFileSync(p, JSON.stringify(c,null,2));
"
$KG index > /dev/null 2>&1
[ -f ".kirograph/kirograph.db" ] && ok "Mock inizializzato (enableEditPrimitives)" || { fail "kirograph.db non trovato"; exit 1; }

# ── kirograph_str_replace ─────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[1] kirograph_str_replace${RESET}"
reset_target

OUT=$($MCP "$TEST_DIR" kirograph_str_replace \
  '{"file":"src/target.ts","old_str":"Hello, ${name}","new_str":"Hi, ${name}"}' \
  2>&1) || true; EXIT=$?
[ $EXIT -eq 0 ] && ok "kirograph_str_replace: exit 0" || fail "kirograph_str_replace: exit $EXIT — $OUT"
grep -q "Hi, " "$TEST_DIR/src/target.ts" \
  && ok "kirograph_str_replace: testo sostituito nel file" \
  || fail "kirograph_str_replace: sostituzione non effettuata"
grep -q 'Hello, ' "$TEST_DIR/src/target.ts" \
  && fail "kirograph_str_replace: stringa originale ancora presente" \
  || ok "kirograph_str_replace: stringa originale rimossa"

# 0-match: file must remain unchanged
reset_target
BEFORE=$(cat "$TEST_DIR/src/target.ts")
$MCP "$TEST_DIR" kirograph_str_replace \
  '{"file":"src/target.ts","old_str":"NONEXISTENT_MARKER_XYZ","new_str":"replaced"}' \
  > /dev/null 2>&1 || true
AFTER=$(cat "$TEST_DIR/src/target.ts")
[ "$BEFORE" = "$AFTER" ] \
  && ok "kirograph_str_replace 0 match: file invariato" \
  || fail "kirograph_str_replace 0 match: file modificato inaspettatamente"

# ── kirograph_multi_str_replace ───────────────────────────────────────────────
sep
echo -e "  ${BOLD}[2] kirograph_multi_str_replace${RESET}"
reset_target

OUT=$($MCP "$TEST_DIR" kirograph_multi_str_replace \
  '{"file":"src/target.ts","pairs":[{"old_str":"// ALPHA_SENTINEL_1","new_str":"// replaced-alpha"},{"old_str":"// BETA_SENTINEL_2","new_str":"// replaced-beta"}]}' \
  2>&1) || true; EXIT=$?
[ $EXIT -eq 0 ] && ok "kirograph_multi_str_replace: exit 0" || fail "kirograph_multi_str_replace: exit $EXIT — $OUT"
grep -q "replaced-alpha" "$TEST_DIR/src/target.ts" \
  && ok "kirograph_multi_str_replace: prima sostituzione applicata" \
  || fail "kirograph_multi_str_replace: prima sostituzione non trovata"
grep -q "replaced-beta" "$TEST_DIR/src/target.ts" \
  && ok "kirograph_multi_str_replace: seconda sostituzione applicata" \
  || fail "kirograph_multi_str_replace: seconda sostituzione non trovata"

# ── kirograph_insert_at ───────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[3] kirograph_insert_at${RESET}"
reset_target

OUT=$($MCP "$TEST_DIR" kirograph_insert_at \
  '{"file":"src/target.ts","anchor":"// ALPHA_SENTINEL_1","content":"\n// inserted-line","position":"after"}' \
  2>&1) || true; EXIT=$?
[ $EXIT -eq 0 ] && ok "kirograph_insert_at: exit 0" || fail "kirograph_insert_at: exit $EXIT — $OUT"
grep -q "inserted-line" "$TEST_DIR/src/target.ts" \
  && ok "kirograph_insert_at: riga inserita nel file" \
  || fail "kirograph_insert_at: riga non trovata"

# insert before anchor
reset_target
OUT=$($MCP "$TEST_DIR" kirograph_insert_at \
  '{"file":"src/target.ts","anchor":"// BETA_SENTINEL_2","content":"// before-beta\n","position":"before"}' \
  2>&1) || true; EXIT=$?
[ $EXIT -eq 0 ] && ok "kirograph_insert_at before: exit 0" || fail "kirograph_insert_at before: exit $EXIT — $OUT"
grep -q "before-beta" "$TEST_DIR/src/target.ts" \
  && ok "kirograph_insert_at before: riga inserita prima dell'anchor" \
  || fail "kirograph_insert_at before: riga non trovata"

# insert by line number
reset_target
OUT=$($MCP "$TEST_DIR" kirograph_insert_at \
  '{"file":"src/target.ts","line":1,"content":"// top-inserted","position":"before"}' \
  2>&1) || true; EXIT=$?
[ $EXIT -eq 0 ] && ok "kirograph_insert_at line: exit 0" || fail "kirograph_insert_at line: exit $EXIT — $OUT"
grep -q "top-inserted" "$TEST_DIR/src/target.ts" \
  && ok "kirograph_insert_at line: riga inserita alla riga 1" \
  || fail "kirograph_insert_at line: riga non trovata"

# ── Fine ──────────────────────────────────────────────────────────────────────
sep
echo ""
if [ "$FAILURES" -eq 0 ]; then echo -e "  ${GREEN}${BOLD}Tutti i controlli superati.${RESET}"
else echo -e "  ${RED}${BOLD}$FAILURES controllo/i fallito/i.${RESET}"; exit 1; fi
echo ""
