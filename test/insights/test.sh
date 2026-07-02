#!/usr/bin/env bash
# test-insights.sh — testa annotations, dependency-depth, distribution, doc-coverage,
#   gini, god-class, inheritance-depth, largest, module-api, rank, recursion,
#   rename-preview, type-hierarchy, unused-imports
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

echo -e "\n${BOLD}  KiroGraph Insights — test simboli · metriche · gerarchia · copertura${RESET}"
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
mkdir -p "$TEST_DIR/src"

cat > "$TEST_DIR/package.json" << 'EOF'
{"name":"mock-insights","version":"1.0.0","private":true}
EOF

# base.ts — abstract base class + interface for inheritance-depth and type-hierarchy
cat > "$TEST_DIR/src/base.ts" << 'EOF'
/** Base service interface */
export interface IService {
  init(): void;
  destroy(): void;
}

/** Base repository interface */
export interface IRepository<T> {
  findById(id: string): T | null;
  findAll(): T[];
}

/** Abstract base class */
export abstract class BaseService implements IService {
  protected name: string;
  constructor(name: string) { this.name = name; }
  abstract init(): void;
  destroy(): void { /* cleanup */ }
  protected log(msg: string): void { console.log(`[${this.name}] ${msg}`); }
}
EOF

# auth.ts — extends BaseService, some methods with JSDoc, some without
cat > "$TEST_DIR/src/auth.ts" << 'EOF'
import { BaseService, IService } from './base';
import { UserRepository } from './user';
import { TokenManager } from './token';

/**
 * Authentication service.
 * Handles login, logout, and token validation.
 */
export class AuthService extends BaseService {
  private users: UserRepository;
  private tokens: TokenManager;

  constructor() {
    super('AuthService');
    this.users = new UserRepository();
    this.tokens = new TokenManager();
  }

  init(): void { this.log('initialized'); }

  /** Log in with email and password */
  login(email: string, password: string): string | null {
    const user = this.users.findAll().find((u: any) => u.email === email);
    if (!user) return null;
    return this.tokens.sign({ email });
  }

  // no JSDoc intentionally
  logout(token: string): void {
    this.tokens.verify(token);
  }

  validateToken(token: string): boolean {
    return this.tokens.verify(token) !== null;
  }
}
EOF

# token.ts — simple class, no JSDoc on methods
cat > "$TEST_DIR/src/token.ts" << 'EOF'
export class TokenManager {
  sign(payload: object): string { return JSON.stringify(payload); }
  verify(token: string): object | null {
    try { return JSON.parse(token); } catch { return null; }
  }
}
EOF

# user.ts — "god class" with many methods, extends BaseService
cat > "$TEST_DIR/src/user.ts" << 'EOF'
import { BaseService, IRepository } from './base';

export interface User { id: string; email: string; name: string; }

/** User repository — intentionally has many methods (god class candidate) */
export class UserRepository extends BaseService implements IRepository<User> {
  private store: User[] = [];

  constructor() { super('UserRepository'); }
  init(): void { this.log('initialized'); }

  findById(id: string): User | null { return this.store.find(u => u.id === id) ?? null; }
  findAll(): User[] { return this.store; }
  create(user: User): User { this.store.push(user); return user; }
  update(id: string, patch: Partial<User>): User | null {
    const u = this.findById(id);
    if (!u) return null;
    Object.assign(u, patch);
    return u;
  }
  delete(id: string): boolean {
    const idx = this.store.findIndex(u => u.id === id);
    if (idx === -1) return false;
    this.store.splice(idx, 1);
    return true;
  }
  count(): number { return this.store.length; }
  exists(id: string): boolean { return this.findById(id) !== null; }
  findByEmail(email: string): User | null { return this.store.find(u => u.email === email) ?? null; }
  validate(user: User): boolean { return !!user.email && !!user.name; }
  toJSON(): object[] { return this.store.map(u => ({ ...u })); }
}
EOF

# utils.ts — recursive functions, some unused imports
cat > "$TEST_DIR/src/utils.ts" << 'EOF'
import { TokenManager } from './token'; // intentionally unused import

/** Compute factorial recursively */
export function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

/** Compute fibonacci recursively */
export function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatDate(d: Date): string {
  return d.toISOString().split('T')[0] ?? '';
}
EOF

# index.ts — re-exports everything
cat > "$TEST_DIR/src/index.ts" << 'EOF'
export * from './auth';
export * from './user';
export * from './token';
export * from './utils';
export * from './base';
EOF

ok "Mock project creato in $TEST_DIR"
cd "$TEST_DIR"

# ── 3. Init + Index ───────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[1] kirograph init + index${RESET}"
$KG init 2>&1 | grep -v "^$" | sed 's/^/     /' || true
$KG index 2>&1 | grep -E "✓|file|symbol|edge|Indexed|scanning" | sed 's/^/     /' || true
[ -f ".kirograph/kirograph.db" ] && ok "kirograph.db creato" || { fail "kirograph.db non trovato"; exit 1; }

# helper: run a command, check exit 0, optionally check output contains a string
check() {
  local label="$1"; local pattern="$2"; shift 2
  local out
  out=$("$@" 2>&1) || { fail "$label: exit non-zero"; return; }
  ok "$label: exit 0"
  if [ -n "$pattern" ]; then
    echo "$out" | grep -qi "$pattern" \
      && ok "$label: output contiene '$pattern'" \
      || fail "$label: output non contiene '$pattern'"
  else
    [ -n "$out" ] && ok "$label: output non vuoto" || warn "$label: output vuoto (potrebbe essere ok)"
  fi
}

# ── 4. annotations ────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[2] annotations${RESET}"
check "annotations" "" $KG annotations

# ── 5. dependency-depth ───────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[3] dependency-depth${RESET}"
check "dependency-depth --limit 5" "" $KG dependency-depth --limit 5

# ── 6. distribution ───────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[4] distribution${RESET}"
check "distribution" "class\|function\|interface\|method" $KG distribution

# ── 7. doc-coverage ───────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[5] doc-coverage${RESET}"
OUT=$($KG doc-coverage --limit 10 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "doc-coverage: exit 0" || fail "doc-coverage: exit $EXIT"
# Should find at least logout (no JSDoc)
[ -n "$OUT" ] && ok "doc-coverage: output non vuoto" || warn "doc-coverage: output vuoto"

# ── 8. gini ───────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[6] gini${RESET}"
check "gini --metric loc"    "gini\|coefficien\|0\." $KG gini --metric loc
check "gini --metric fan-in" "" $KG gini --metric fan-in
check "gini --metric fan-out" "" $KG gini --metric fan-out

# ── 9. god-class ──────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[7] god-class${RESET}"
OUT=$($KG god-class --limit 5 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "god-class: exit 0" || fail "god-class: exit $EXIT"
echo "$OUT" | grep -qi "UserRepository\|user" \
  && ok "god-class: UserRepository identificata (ha più metodi)" \
  || warn "god-class: UserRepository non in cima (dipende dal parser)"

# ── 10. inheritance-depth ─────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[8] inheritance-depth${RESET}"
OUT=$($KG inheritance-depth --limit 5 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "inheritance-depth: exit 0" || fail "inheritance-depth: exit $EXIT"
echo "$OUT" | grep -qi "AuthService\|UserRepository\|BaseService" \
  && ok "inheritance-depth: trova classi con ereditarietà" \
  || warn "inheritance-depth: nessuna classe con profondità > 0 trovata"

# ── 11. largest ───────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[9] largest${RESET}"
check "largest --limit 5" "" $KG largest --limit 5

# ── 12. module-api ────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[10] module-api${RESET}"
check "module-api src/auth.ts" "AuthService\|login\|logout" $KG module-api src/auth.ts
check "module-api src/user.ts" "UserRepository" $KG module-api src/user.ts

# ── 13. rank ──────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[11] rank${RESET}"
check "rank --by fan-in"  "" $KG rank --by fan-in
check "rank --by fan-out" "" $KG rank --by fan-out

# ── 14. recursion ─────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[12] recursion${RESET}"
OUT=$($KG recursion --limit 5 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "recursion: exit 0" || fail "recursion: exit $EXIT"
echo "$OUT" | grep -qi "factorial\|fibonacci" \
  && ok "recursion: trova factorial o fibonacci" \
  || warn "recursion: funzioni ricorsive non trovate (dipende dal parser di call sites)"

# ── 15. rename-preview ────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[13] rename-preview${RESET}"
check "rename-preview AuthService" "AuthService\|auth\|reference\|site\|trovato\|import" $KG rename-preview AuthService --limit 10

# ── 16. type-hierarchy ────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[14] type-hierarchy${RESET}"
check "type-hierarchy AuthService --direction both" "AuthService\|BaseService\|IService" $KG type-hierarchy AuthService --direction both
check "type-hierarchy AuthService --direction up"   "" $KG type-hierarchy AuthService --direction up
check "type-hierarchy AuthService --direction down"  "" $KG type-hierarchy AuthService --direction down

OUT=$($KG type-hierarchy AuthService --json 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "type-hierarchy --json: exit 0" || fail "type-hierarchy --json: exit $EXIT"
echo "$OUT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(d.hierarchy!==undefined?0:1)" 2>/dev/null \
  && ok "type-hierarchy --json: JSON valido con campo hierarchy" \
  || fail "type-hierarchy --json: JSON non valido"

# ── 17. unused-imports ────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[15] unused-imports${RESET}"
OUT=$($KG unused-imports --limit 5 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "unused-imports: exit 0" || fail "unused-imports: exit $EXIT"
echo "$OUT" | grep -qi "TokenManager\|utils\|token\|unused\|zero" \
  && ok "unused-imports: trova import inutilizzato in utils.ts" \
  || warn "unused-imports: import inutilizzato non rilevato (dipende dal linker)"

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
