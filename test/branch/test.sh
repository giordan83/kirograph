#!/usr/bin/env bash
# test-branch.sh — testa branch list/add/remove/gc/diff/search
#
# Richiede un progetto git con almeno 2 branch.
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

echo -e "\n${BOLD}  KiroGraph Branch — test list · add · remove · gc · diff · search${RESET}"
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

# ── 2. Setup git repo con 2 branch ────────────────────────────────────────────
sep
info "Pulizia e creazione repo git mock con 2 branch..."
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR/src"

cd "$TEST_DIR"
git init -q
git config user.email "test@kirograph.local"
git config user.name  "KiroGraph Test"

cat > package.json << 'EOF'
{"name":"mock-branch","version":"1.0.0","private":true}
EOF

cat > src/service.ts << 'EOF'
export class UserService {
  findById(id: string): object | null { return null; }
  findAll(): object[] { return []; }
}
EOF

cat > src/model.ts << 'EOF'
export interface User { id: string; name: string; }
EOF

git add .
git commit -q -m "initial commit on main"

MAIN_BRANCH=$(git symbolic-ref --short HEAD)

# Create feature branch with an extra file
git checkout -q -b feature/new-api
cat > src/api.ts << 'EOF'
import { UserService } from './service';
export class ApiController {
  private svc = new UserService();
  getUser(id: string) { return this.svc.findById(id); }
  listUsers() { return this.svc.findAll(); }
}
EOF
git add .
git commit -q -m "add ApiController on feature branch"

# Return to main
git checkout -q "$MAIN_BRANCH"

ok "Repo git mock creato (branch: $MAIN_BRANCH + feature/new-api)"

# ── 3. Init + Index (on main) ─────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[1] kirograph init + index${RESET}"
$KG init 2>&1 | grep -v "^$" | sed 's/^/     /' || true
$KG index 2>&1 | grep -E "✓|file|symbol|edge|Indexed|scanning" | sed 's/^/     /' || true
[ -f ".kirograph/kirograph.db" ] && ok "kirograph.db creato (main)" || { fail "kirograph.db non trovato"; exit 1; }

# ── 4. branch list (inizialmente vuoto) ───────────────────────────────────────
sep
echo -e "  ${BOLD}[2] branch list${RESET}"
OUT=$($KG branch list 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "branch list: exit 0" || fail "branch list: exit $EXIT"
[ -n "$OUT" ] && ok "branch list: output non vuoto" || warn "branch list: output vuoto"

# ── 5. branch add ─────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[3] branch add${RESET}"
OUT=$($KG branch add feature/new-api 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "branch add feature/new-api: exit 0" || fail "branch add feature/new-api: exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "branch add: output non vuoto" || warn "branch add: output vuoto"

# ── 6. branch list (dopo add) ─────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[4] branch list dopo add${RESET}"
OUT=$($KG branch list 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "branch list: exit 0" || fail "branch list: exit $EXIT"
echo "$OUT" | grep -qE "feature[/-]new-api" \
  && ok "branch list: feature/new-api presente" \
  || fail "branch list: feature/new-api non trovato nell'output"

# ── 7. branch search ──────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[5] branch search${RESET}"
OUT=$($KG branch search feature/new-api UserService 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "branch search feature/new-api UserService: exit 0" || fail "branch search: exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "branch search: output non vuoto" || warn "branch search: output vuoto"
echo "$OUT" | grep -qi "UserService\|user\|service" \
  && ok "branch search: trova UserService nel branch feature" \
  || warn "branch search: UserService non trovato (branch non indicizzato?)"

# ── 8. branch diff ────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[6] branch diff${RESET}"
OUT=$($KG branch diff "$MAIN_BRANCH" feature/new-api 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "branch diff $MAIN_BRANCH feature/new-api: exit 0" || fail "branch diff: exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "branch diff: output non vuoto" || warn "branch diff: output vuoto (branch non popolato con sync)"

# ── 9. branch gc ──────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[7] branch gc${RESET}"
OUT=$($KG branch gc 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "branch gc: exit 0" || fail "branch gc: exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "branch gc: output non vuoto" || warn "branch gc: output vuoto"

# ── 10. branch remove ─────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[8] branch remove${RESET}"
OUT=$($KG branch remove feature/new-api 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "branch remove feature/new-api: exit 0" || fail "branch remove: exit $EXIT — $OUT"

OUT=$($KG branch list 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "branch list dopo remove: exit 0" || fail "branch list dopo remove: exit $EXIT"
echo "$OUT" | grep -qE "feature[/-]new-api" \
  && fail "branch list: feature/new-api ancora presente dopo remove" \
  || ok "branch list: feature/new-api rimosso correttamente"

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
