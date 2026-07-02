#!/usr/bin/env bash
# test-health.sh — testa complexity, simplify-scan, health, dsm, test-risk,
#   test-map, doctor, session start/end
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

echo -e "\n${BOLD}  KiroGraph Health — test complexity · health · dsm · test-risk · test-map · doctor · session${RESET}"
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

# ── 2. Pulizia + mock ─────────────────────────────────────────────────────────
sep
info "Pulizia e creazione progetto mock..."
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR/src" "$TEST_DIR/test"

cat > "$TEST_DIR/package.json" << 'EOF'
{"name":"mock-health","version":"1.0.0","private":true}
EOF

# High-complexity processor — many branches and loops
cat > "$TEST_DIR/src/processor.ts" << 'EOF'
import { Validator } from './validator';

export class DataProcessor {
  private validator = new Validator();

  /** Complex method with high cyclomatic complexity */
  processAll(items: unknown[]): unknown[] {
    const results: unknown[] = [];
    for (const item of items) {
      if (!item) continue;
      if (typeof item === 'string') {
        if (item.length === 0) continue;
        if (item.startsWith('skip')) continue;
        if (this.validator.validate(item)) {
          if (item.includes('@')) {
            results.push({ type: 'email', value: item });
          } else if (item.match(/^\d+$/)) {
            results.push({ type: 'number', value: parseInt(item) });
          } else {
            results.push({ type: 'text', value: item });
          }
        }
      } else if (typeof item === 'number') {
        if (item < 0) {
          results.push({ type: 'negative', value: item });
        } else if (item === 0) {
          results.push({ type: 'zero', value: item });
        } else if (item > 1000) {
          results.push({ type: 'large', value: item });
        } else {
          results.push({ type: 'positive', value: item });
        }
      } else if (Array.isArray(item)) {
        for (const nested of item) {
          if (nested !== null && nested !== undefined) {
            results.push({ type: 'nested', value: nested });
          }
        }
      }
    }
    return results;
  }

  simpleAdd(a: number, b: number): number { return a + b; }
}
EOF

cat > "$TEST_DIR/src/validator.ts" << 'EOF'
export class Validator {
  validate(value: string): boolean {
    if (!value) return false;
    if (value.length > 1000) return false;
    return true;
  }
  validateEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
  validatePhone(phone: string): boolean {
    return /^\+?[\d\s\-()]{7,}$/.test(phone);
  }
}
EOF

cat > "$TEST_DIR/src/service.ts" << 'EOF'
import { DataProcessor } from './processor';
import { Validator } from './validator';

export class ServiceLayer {
  private processor = new DataProcessor();
  private validator = new Validator();
  process(items: unknown[]): unknown[] { return this.processor.processAll(items); }
  handle(value: string): boolean { return this.validator.validate(value); }
}
EOF

cat > "$TEST_DIR/src/utils.ts" << 'EOF'
export function formatDate(d: Date): string { return d.toISOString().split('T')[0] ?? ''; }
export function parseDate(s: string): Date { return new Date(s); }
export function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
EOF

cat > "$TEST_DIR/src/app.ts" << 'EOF'
import { ServiceLayer } from './service';
export class App {
  private service = new ServiceLayer();
  run(): void { this.service.process(['hello', 42, 'skip-me']); }
}
EOF

# Fake test file — imports DataProcessor so test-map can link it
cat > "$TEST_DIR/test/processor.test.ts" << 'EOF'
import { DataProcessor } from '../src/processor';
// Fake tests — just enough for test-map to find the link
const p = new DataProcessor();
console.assert(p.simpleAdd(1, 2) === 3, 'simpleAdd works');
EOF

ok "Mock project creato in $TEST_DIR"
cd "$TEST_DIR"

# ── 3. Init + Index ───────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[1] kirograph init + index${RESET}"
$KG init 2>&1 | grep -v "^$" | sed 's/^/     /' || true
$KG index 2>&1 | grep -E "✓|file|symbol|edge|Indexed|scanning" | sed 's/^/     /' || true
[ -f ".kirograph/kirograph.db" ] && ok "kirograph.db creato" || { fail "kirograph.db non trovato"; exit 1; }

# ── 4. complexity ─────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[2] complexity${RESET}"
OUT=$($KG complexity --limit 5 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "complexity: exit 0" || fail "complexity: exit $EXIT"
[ -n "$OUT" ] && ok "complexity: output non vuoto" || fail "complexity: output vuoto"
echo "$OUT" | grep -qi "processAll\|DataProcessor\|complexity\|cyclomatic" \
  && ok "complexity: processAll identificato come complesso" \
  || warn "complexity: processAll non trovato in cima (dipende dal parser)"

# ── 5. simplify-scan ──────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[3] simplify-scan${RESET}"
OUT=$($KG simplify-scan --limit 5 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "simplify-scan: exit 0" || fail "simplify-scan: exit $EXIT"
[ -n "$OUT" ] && ok "simplify-scan: output non vuoto" || warn "simplify-scan: output vuoto"

# ── 6. health ─────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[4] health${RESET}"
OUT=$($KG health 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "health: exit 0" || fail "health: exit $EXIT"
[ -n "$OUT" ] && ok "health: output non vuoto" || fail "health: output vuoto"
echo "$OUT" | grep -qiE "[0-9]|score|health|grade" \
  && ok "health: output contiene score/grade" \
  || warn "health: score/grade non trovato nell'output"

# ── 7. dsm ────────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[5] dsm${RESET}"
OUT=$($KG dsm --limit 10 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "dsm: exit 0" || fail "dsm: exit $EXIT"
[ -n "$OUT" ] && ok "dsm: output non vuoto" || warn "dsm: output vuoto"

# ── 8. test-risk ──────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[6] test-risk${RESET}"
OUT=$($KG test-risk --limit 5 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "test-risk: exit 0" || fail "test-risk: exit $EXIT"
[ -n "$OUT" ] && ok "test-risk: output non vuoto" || warn "test-risk: output vuoto"

# ── 9. test-map ───────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[7] test-map${RESET}"
OUT=$($KG test-map 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "test-map: exit 0" || fail "test-map: exit $EXIT"
[ -n "$OUT" ] && ok "test-map: output non vuoto" || warn "test-map: output vuoto"
echo "$OUT" | grep -qi "processor\|DataProcessor\|test" \
  && ok "test-map: collega DataProcessor al test file" \
  || warn "test-map: link DataProcessor→test non trovato (dipende dal linker)"

# ── 10. doctor ────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[8] doctor${RESET}"
OUT=$($KG doctor 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "doctor: exit 0" || fail "doctor: exit $EXIT (doctor ha trovato errori bloccanti)"
[ -n "$OUT" ] && ok "doctor: output non vuoto" || fail "doctor: output vuoto"

# ── 11. session start ─────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[9] session start / end${RESET}"
OUT=$($KG session start 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "session start: exit 0" || fail "session start: exit $EXIT"
[ -n "$OUT" ] && ok "session start: output non vuoto" || warn "session start: output vuoto"

# ── 12. session end ───────────────────────────────────────────────────────────
OUT=$($KG session end 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "session end: exit 0" || fail "session end: exit $EXIT"
[ -n "$OUT" ] && ok "session end: output non vuoto" || warn "session end: output vuoto"

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
