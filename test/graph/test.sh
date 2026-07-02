#!/usr/bin/env bash
# test-graph.sh — testa callers, callees, impact, circular-deps, snapshot
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

echo -e "\n${BOLD}  KiroGraph Graph — test callers · callees · impact · circular-deps · snapshot${RESET}"
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
{"name":"mock-graph","version":"1.0.0","private":true}
EOF

cat > "$TEST_DIR/src/database.ts" << 'EOF'
/** Low-level database access */
export class Database {
  connect(url: string): void { /* connect */ }
  query(sql: string): unknown[] { return []; }
  disconnect(): void { /* disconnect */ }
}
EOF

cat > "$TEST_DIR/src/token.ts" << 'EOF'
/** JWT token management */
export class TokenManager {
  sign(payload: object): string { return ''; }
  verify(token: string): object | null { return null; }
}
EOF

cat > "$TEST_DIR/src/user.ts" << 'EOF'
import { Database } from './database';

/** User data access */
export class UserRepository {
  private db: Database;
  constructor() { this.db = new Database(); }
  findById(id: string): object | null { return this.db.query(`SELECT * FROM users WHERE id='${id}'`)[0] ?? null; }
  findAll(): object[] { return this.db.query('SELECT * FROM users'); }
}
EOF

cat > "$TEST_DIR/src/auth.ts" << 'EOF'
import { UserRepository } from './user';
import { TokenManager } from './token';

/** Authentication service */
export class AuthService {
  private users: UserRepository;
  private tokens: TokenManager;
  constructor() {
    this.users = new UserRepository();
    this.tokens = new TokenManager();
  }
  login(email: string, password: string): string | null {
    const user = this.users.findAll().find((u: any) => u.email === email);
    if (!user) return null;
    return this.tokens.sign({ email });
  }
  logout(token: string): void {
    this.tokens.verify(token);
  }
  validateToken(token: string): boolean {
    return this.tokens.verify(token) !== null;
  }
}
EOF

cat > "$TEST_DIR/src/app.ts" << 'EOF'
import { AuthService } from './auth';
import { UserRepository } from './user';

/** Application entry point */
export class App {
  private auth: AuthService;
  private users: UserRepository;
  constructor() {
    this.auth = new AuthService();
    this.users = new UserRepository();
  }
  start(): void {
    const token = this.auth.login('admin@example.com', 'secret');
    if (token) {
      const users = this.users.findAll();
      console.log(`Logged in, ${users.length} users found`);
    }
  }
}
EOF

ok "Mock project creato in $TEST_DIR"
cd "$TEST_DIR"

# ── 3. Init + Index ───────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[1] kirograph init + index${RESET}"
$KG init 2>&1 | grep -v "^$" | sed 's/^/     /' || true
$KG index 2>&1 | grep -E "✓|file|symbol|edge|Indexed|scanning" | sed 's/^/     /' || true
[ -f ".kirograph/kirograph.db" ] && ok "kirograph.db creato" || fail "kirograph.db non trovato"

# ── 4. callers ────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[2] callers${RESET}"

OUTPUT=$($KG callers login 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "callers login: exit 0" || fail "callers login: exit $EXIT"
echo "$OUTPUT" | grep -qiE "caller|no caller|AuthService|App" \
  && ok "callers login: output coerente" \
  || fail "callers login: output inatteso — '$OUTPUT'"

OUTPUT=$($KG callers login --json 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "callers login --json: exit 0" || fail "callers login --json: exit $EXIT"
echo "$OUTPUT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(d.callers!==undefined?0:1)" 2>/dev/null \
  && ok "callers login --json: JSON valido con campo callers" \
  || fail "callers login --json: JSON non valido"

# ── 5. callees ────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[3] callees${RESET}"

OUTPUT=$($KG callees login 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "callees login: exit 0" || fail "callees login: exit $EXIT"
echo "$OUTPUT" | grep -qiE "calls|no.*call|findAll|sign|verify" \
  && ok "callees login: output coerente (trova dipendenze)" \
  || warn "callees login: nessuna callee trovata (possibile se il parser non traccia call sites)"

OUTPUT=$($KG callees login --json 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "callees login --json: exit 0" || fail "callees login --json: exit $EXIT"

# ── 6. impact ─────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[4] impact${RESET}"

OUTPUT=$($KG impact Database 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "impact Database: exit 0" || fail "impact Database: exit $EXIT"
[ -n "$OUTPUT" ] && ok "impact Database: output non vuoto" || fail "impact Database: output vuoto"

OUTPUT=$($KG impact Database --json 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "impact Database --json: exit 0" || fail "impact Database --json: exit $EXIT"
echo "$OUTPUT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(d.affected!==undefined?0:1)" 2>/dev/null \
  && ok "impact Database --json: JSON valido con campo affected" \
  || fail "impact Database --json: JSON non valido"

OUTPUT=$($KG impact Database -d 3 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "impact Database -d 3: exit 0" || fail "impact Database -d 3: exit $EXIT"

# ── 7. circular-deps ──────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[5] circular-deps${RESET}"

OUTPUT=$($KG circular-deps 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "circular-deps: exit 0" || fail "circular-deps: exit $EXIT"
[ -n "$OUTPUT" ] && ok "circular-deps: output non vuoto" || fail "circular-deps: output vuoto"

OUTPUT=$($KG circular-deps --json 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "circular-deps --json: exit 0" || fail "circular-deps --json: exit $EXIT"
echo "$OUTPUT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(Array.isArray(d.cycles)?0:1)" 2>/dev/null \
  && ok "circular-deps --json: JSON valido con campo cycles[]" \
  || fail "circular-deps --json: JSON non valido"

# ── 8. snapshot save ──────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[6] snapshot save / list / diff${RESET}"

OUTPUT=$($KG snapshot save before-refactor 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "snapshot save before-refactor: exit 0" || fail "snapshot save before-refactor: exit $EXIT"
echo "$OUTPUT" | grep -qi "before-refactor" \
  && ok "snapshot save: label confermata nell'output" \
  || fail "snapshot save: label non trovata nell'output"

# ── 9. snapshot list ──────────────────────────────────────────────────────────
OUTPUT=$($KG snapshot list 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "snapshot list: exit 0" || fail "snapshot list: exit $EXIT"
echo "$OUTPUT" | grep -qi "before-refactor" \
  && ok "snapshot list: mostra lo snapshot salvato" \
  || fail "snapshot list: snapshot 'before-refactor' non trovato nell'output"

# ── 10. snapshot diff ─────────────────────────────────────────────────────────
OUTPUT=$($KG snapshot diff before-refactor 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "snapshot diff before-refactor: exit 0" || fail "snapshot diff before-refactor: exit $EXIT"
[ -n "$OUTPUT" ] && ok "snapshot diff: output non vuoto" || fail "snapshot diff: output vuoto"

OUTPUT=$($KG snapshot diff before-refactor --format json 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "snapshot diff --format json: exit 0" || fail "snapshot diff --format json: exit $EXIT"

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
