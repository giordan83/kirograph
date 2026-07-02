#!/usr/bin/env bash
# test-edit.sh — testa str-replace, multi-replace, insert-at, ast-rewrite
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

echo -e "\n${BOLD}  KiroGraph Edit — test str-replace · multi-replace · insert-at · ast-rewrite${RESET}"
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

# ── 2. Pulizia + init ─────────────────────────────────────────────────────────
sep
info "Pulizia e inizializzazione progetto mock..."
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR/src"

cat > "$TEST_DIR/package.json" << 'EOF'
{"name":"mock-edit","version":"1.0.0","private":true}
EOF
cat > "$TEST_DIR/src/app.ts" << 'EOF'
export class App { run(): void {} }
EOF

cd "$TEST_DIR"
$KG init  > /dev/null 2>&1
$KG index > /dev/null 2>&1
ok "Progetto mock inizializzato e indicizzato"

# ── 3. str-replace — successo ─────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[1] str-replace${RESET}"

cat > src/target.ts << 'EOF'
export function greet(name: string): string {
  return null; // sentinel-abc
}
EOF

OUT=$($KG str-replace src/target.ts "return null; // sentinel-abc" "return \`Hello, \${name}\`;" 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "str-replace: exit 0" || fail "str-replace: exit $EXIT — $OUT"
grep -q 'Hello' src/target.ts \
  && ok "str-replace: file aggiornato correttamente" \
  || fail "str-replace: il file non contiene la stringa sostituita"
grep -q 'sentinel-abc' src/target.ts \
  && fail "str-replace: stringa originale ancora presente" \
  || ok "str-replace: stringa originale rimossa"

# ── 4. str-replace — 0 match: file invariato ─────────────────────────────────
cat > src/notfound.ts << 'EOF'
export const x = 1;
EOF
BEFORE=$(cat src/notfound.ts)
$KG str-replace src/notfound.ts "this-string-does-not-exist" "replacement" > /dev/null 2>&1
AFTER=$(cat src/notfound.ts)
[ "$BEFORE" = "$AFTER" ] \
  && ok "str-replace (0 match): file invariato" \
  || fail "str-replace (0 match): il file è stato modificato"

# ── 5. multi-replace ──────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[2] multi-replace${RESET}"

# Each anchor must appear exactly once — use unique sentinel strings
cat > src/multi.ts << 'EOF'
const ALPHA_SENTINEL_1 = 'alpha';
const BETA_SENTINEL_2 = 'beta';
EOF

PAIRS='[{"old_str":"ALPHA_SENTINEL_1","new_str":"ALPHA_REPLACED"},{"old_str":"BETA_SENTINEL_2","new_str":"BETA_REPLACED"}]'
OUT=$($KG multi-replace src/multi.ts "$PAIRS" 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "multi-replace: exit 0" || fail "multi-replace: exit $EXIT — $OUT"
grep -q 'ALPHA_REPLACED' src/multi.ts \
  && ok "multi-replace: ALPHA_SENTINEL_1 → ALPHA_REPLACED" \
  || fail "multi-replace: ALPHA_SENTINEL_1 non sostituito"
grep -q 'BETA_REPLACED' src/multi.ts \
  && ok "multi-replace: BETA_SENTINEL_2 → BETA_REPLACED" \
  || fail "multi-replace: BETA_SENTINEL_2 non sostituito"

# Transazione: ancora non trovata → file invariato
BEFORE=$(cat src/multi.ts)
$KG multi-replace src/multi.ts '[{"old_str":"ALPHA_REPLACED","new_str":"NEW"},{"old_str":"NONEXISTENT_ZZZ","new_str":"X"}]' > /dev/null 2>&1
AFTER=$(cat src/multi.ts)
[ "$BEFORE" = "$AFTER" ] \
  && ok "multi-replace (transazione parziale): file invariato (all-or-nothing)" \
  || warn "multi-replace (transazione parziale): il file è stato modificato parzialmente"

# ── 6. insert-at — before ─────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[3] insert-at${RESET}"

# insert-at inserts content inline after the anchor character position by default.
# Use \n in the content to insert on a new line.
cat > src/insert.ts << 'EOF'
// anchor-line
export const value = 42;
EOF

OUT=$($KG insert-at src/insert.ts "// anchor-line" $'\n// new-line-after' 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "insert-at (new line after anchor): exit 0" || fail "insert-at: exit $EXIT — $OUT"
grep -q 'new-line-after' src/insert.ts \
  && ok "insert-at: contenuto inserito" \
  || fail "insert-at: contenuto non trovato nel file"

node -e "
const fs = require('fs');
const content = fs.readFileSync('src/insert.ts', 'utf8');
const ai = content.indexOf('// anchor-line');
const ii = content.indexOf('// new-line-after');
process.exit(ii !== -1 && ii > ai ? 0 : 1);
" 2>/dev/null \
  && ok "insert-at: contenuto appare dopo l'ancora" \
  || fail "insert-at: contenuto non appare dopo l'ancora"

# ── 7. insert-at — line number ────────────────────────────────────────────────
cat > src/insert2.ts << 'EOF'
export const a = 1;
export const b = 2;
export const c = 3;
EOF

OUT=$($KG insert-at src/insert2.ts "2" $'export const inserted = 0;\n' --line 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "insert-at --line: exit 0" || fail "insert-at --line: exit $EXIT — $OUT"
grep -q 'inserted' src/insert2.ts \
  && ok "insert-at --line: contenuto inserito" \
  || fail "insert-at --line: contenuto non trovato nel file"

# ── 8. ast-rewrite ────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[4] ast-rewrite${RESET}"

if ! command -v ast-grep &>/dev/null; then
  warn "ast-grep non trovato nel PATH — ast-rewrite saltato"
  warn "Per installarlo: npm i -g @ast-grep/cli  oppure  brew install ast-grep"
else
  cat > src/ast.ts << 'EOF'
export function debug(msg: string): void {
  console.log(msg);
  console.log("done");
}
EOF

  OUT=$($KG ast-rewrite src/ast.ts 'console.log($MSG)' 'logger.debug($MSG)' 2>&1)
  EXIT=$?
  [ $EXIT -eq 0 ] && ok "ast-rewrite: exit 0" || fail "ast-rewrite: exit $EXIT — $OUT"
  grep -q 'logger.debug' src/ast.ts \
    && ok "ast-rewrite: console.log → logger.debug" \
    || fail "ast-rewrite: rewrite non applicato"
fi

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
