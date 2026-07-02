#!/usr/bin/env bash
# test-git.sh — testa diff-context, commit-context, pr-context, changelog
#
# Richiede un progetto git con almeno 2 commit e modifiche staged.
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

echo -e "\n${BOLD}  KiroGraph Git — test diff-context · commit-context · pr-context · changelog${RESET}"
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

# ── 2. Pulizia + mock git repo ────────────────────────────────────────────────
sep
info "Pulizia e creazione repo git mock..."
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR/src"

cd "$TEST_DIR"
git init -q
git config user.email "test@kirograph.local"
git config user.name  "KiroGraph Test"

cat > "$TEST_DIR/package.json" << 'EOF'
{"name":"mock-git","version":"1.0.0","private":true}
EOF

# Commit 1: initial files
cat > "$TEST_DIR/src/model.ts" << 'EOF'
export interface User { id: string; email: string; }
export interface Order { id: string; userId: string; total: number; }
EOF

cat > "$TEST_DIR/src/service.ts" << 'EOF'
import { User } from './model';
export class UserService {
  findById(id: string): User | null { return null; }
  findAll(): User[] { return []; }
}
EOF

git add .
git commit -q -m "initial commit: model and service"

# Commit 2: add controller
cat > "$TEST_DIR/src/controller.ts" << 'EOF'
import { UserService } from './service';
export class UserController {
  private svc = new UserService();
  getUser(id: string) { return this.svc.findById(id); }
  listUsers() { return this.svc.findAll(); }
}
EOF

# Modify service
cat >> "$TEST_DIR/src/service.ts" << 'EOF'

export class OrderService {
  findByUser(userId: string): import('./model').Order[] { return []; }
}
EOF

git add .
git commit -q -m "add controller and OrderService"

# Stage a change (but don't commit) — for diff-context --staged and commit-context
cat >> "$TEST_DIR/src/model.ts" << 'EOF'

export interface Product { id: string; name: string; price: number; }
EOF

git add src/model.ts

ok "Repo git mock creato (2 commit + 1 file staged)"

# ── 3. Init + Index ───────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[1] kirograph init + index${RESET}"
$KG init 2>&1 | grep -v "^$" | sed 's/^/     /' || true
$KG index 2>&1 | grep -E "✓|file|symbol|edge|Indexed|scanning" | sed 's/^/     /' || true
[ -f ".kirograph/kirograph.db" ] && ok "kirograph.db creato" || { fail "kirograph.db non trovato"; exit 1; }

# ── 4. diff-context ───────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[2] diff-context${RESET}"

OUT=$($KG diff-context 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "diff-context: exit 0" || fail "diff-context: exit $EXIT"
[ -n "$OUT" ] && ok "diff-context: output non vuoto" || warn "diff-context: output vuoto (nessuna modifica rilevata)"

OUT=$($KG diff-context --staged 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "diff-context --staged: exit 0" || fail "diff-context --staged: exit $EXIT"
[ -n "$OUT" ] && ok "diff-context --staged: output non vuoto" || warn "diff-context --staged: output vuoto"
echo "$OUT" | grep -qi "model\|Product\|User\|symbol\|change" \
  && ok "diff-context --staged: menziona il file modificato" \
  || warn "diff-context --staged: file staged non menzionato"

# ── 5. commit-context ─────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[3] commit-context${RESET}"

OUT=$($KG commit-context 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "commit-context: exit 0" || fail "commit-context: exit $EXIT"
[ -n "$OUT" ] && ok "commit-context: output non vuoto" || warn "commit-context: output vuoto (nessuna modifica staged)"

# ── 6. pr-context ─────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[4] pr-context${RESET}"

OUT=$($KG pr-context HEAD~1 HEAD 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "pr-context HEAD~1 HEAD: exit 0" || fail "pr-context HEAD~1 HEAD: exit $EXIT"
[ -n "$OUT" ] && ok "pr-context: output non vuoto" || warn "pr-context: output vuoto"
echo "$OUT" | grep -qi "controller\|OrderService\|symbol\|change\|add" \
  && ok "pr-context: menziona i simboli aggiunti nel commit 2" \
  || warn "pr-context: simboli del diff non trovati nell'output"

OUT=$($KG pr-context HEAD~1 HEAD --format json 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "pr-context --format json: exit 0" || fail "pr-context --format json: exit $EXIT"

OUT=$($KG pr-context HEAD~1 HEAD --format text 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "pr-context --format text: exit 0" || fail "pr-context --format text: exit $EXIT"

# ── 7. changelog ──────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[5] changelog${RESET}"

OUT=$($KG changelog HEAD~1 HEAD 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "changelog HEAD~1 HEAD: exit 0" || fail "changelog HEAD~1 HEAD: exit $EXIT"
[ -n "$OUT" ] && ok "changelog: output non vuoto" || warn "changelog: output vuoto"
echo "$OUT" | grep -qi "controller\|OrderService\|change\|symbol\|add" \
  && ok "changelog: menziona i simboli modificati" \
  || warn "changelog: simboli del diff non trovati nell'output"

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
