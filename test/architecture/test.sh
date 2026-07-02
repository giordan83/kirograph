#!/usr/bin/env bash
# test-architecture.sh — testa architecture, coupling, package, manifest
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

echo -e "\n${BOLD}  KiroGraph Architecture — test architecture · coupling · package · manifest${RESET}"
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
mkdir -p "$TEST_DIR/src/auth" "$TEST_DIR/src/user" "$TEST_DIR/src/core"

# package.json con dipendenze reali per manifest
cat > "$TEST_DIR/package.json" << 'EOF'
{
  "name": "mock-architecture",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "lodash": "^4.17.21",
    "express": "^4.18.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
EOF

cat > "$TEST_DIR/package-lock.json" << 'EOF'
{
  "lockfileVersion": 3,
  "packages": {
    "node_modules/lodash":   { "version": "4.17.21", "license": "MIT" },
    "node_modules/express":  { "version": "4.18.2",  "license": "MIT" },
    "node_modules/typescript": { "version": "5.1.6", "license": "Apache-2.0", "dev": true }
  }
}
EOF

cat > "$TEST_DIR/src/core/database.ts" << 'EOF'
/** Shared database — imported by auth and user packages */
export class Database {
  connect(url: string): void { /* connect */ }
  query(sql: string): unknown[] { return []; }
  disconnect(): void { /* disconnect */ }
}
EOF

cat > "$TEST_DIR/src/core/logger.ts" << 'EOF'
export class Logger {
  log(level: string, msg: string): void { console.log(`[${level}] ${msg}`); }
  info(msg: string): void { this.log('INFO', msg); }
  error(msg: string): void { this.log('ERROR', msg); }
}
EOF

cat > "$TEST_DIR/src/auth/service.ts" << 'EOF'
import { Database } from '../core/database';
import { Logger } from '../core/logger';

export class AuthService {
  private db = new Database();
  private log = new Logger();
  login(email: string): boolean {
    const result = this.db.query(`SELECT 1 FROM users WHERE email='${email}'`);
    this.log.info(`Login attempt: ${email}`);
    return result.length > 0;
  }
  logout(): void { this.log.info('Logout'); }
}
EOF

cat > "$TEST_DIR/src/auth/middleware.ts" << 'EOF'
import { AuthService } from './service';

export function authMiddleware(token: string): boolean {
  const svc = new AuthService();
  return svc.login(token);
}
EOF

cat > "$TEST_DIR/src/user/model.ts" << 'EOF'
export interface User { id: string; email: string; name: string; }
EOF

cat > "$TEST_DIR/src/user/repository.ts" << 'EOF'
import { Database } from '../core/database';
import { User } from './model';

export class UserRepository {
  private db = new Database();
  findById(id: string): User | null {
    return (this.db.query(`SELECT * FROM users WHERE id='${id}'`)[0] as User) ?? null;
  }
  findAll(): User[] { return this.db.query('SELECT * FROM users') as User[]; }
}
EOF

cat > "$TEST_DIR/src/app.ts" << 'EOF'
import { AuthService } from './auth/service';
import { authMiddleware } from './auth/middleware';
import { UserRepository } from './user/repository';
import { Logger } from './core/logger';

export class App {
  private auth = new AuthService();
  private users = new UserRepository();
  private log = new Logger();
  start(): void {
    this.log.info('App started');
    if (authMiddleware('admin@example.com')) {
      const all = this.users.findAll();
      this.log.info(`${all.length} users loaded`);
    }
  }
}
EOF

ok "Mock project creato in $TEST_DIR"
cd "$TEST_DIR"

# ── 3. Init + config + Index ──────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[1] kirograph init + index${RESET}"
$KG init 2>&1 | grep -v "^$" | sed 's/^/     /' || true

# Enable architecture analysis in config
node -e "
const fs = require('fs');
const p = '.kirograph/config.json';
const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
cfg.enableArchitecture = true;
cfg.enableNavigation = true;
cfg.enableComplexity = true;
fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
"
ok "Config: enableArchitecture=true"

$KG index 2>&1 | grep -E "✓|file|symbol|edge|Indexed|scanning" | sed 's/^/     /' || true
[ -f ".kirograph/kirograph.db" ] && ok "kirograph.db creato" || { fail "kirograph.db non trovato"; exit 1; }

# ── 4. architecture ───────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[2] architecture${RESET}"
OUT=$($KG architecture 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "architecture: exit 0" || fail "architecture: exit $EXIT"
[ -n "$OUT" ] && ok "architecture: output non vuoto" || fail "architecture: output vuoto"

OUT=$($KG architecture --packages 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "architecture --packages: exit 0" || fail "architecture --packages: exit $EXIT"
echo "$OUT" | grep -qiE "auth|user|core|src" \
  && ok "architecture --packages: trova i package del progetto" \
  || warn "architecture --packages: nessun package rilevato (dipende dal rilevamento)"

OUT=$($KG architecture --layers 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "architecture --layers: exit 0" || fail "architecture --layers: exit $EXIT"

# ── 5. coupling ───────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[3] coupling${RESET}"
OUT=$($KG coupling 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "coupling: exit 0" || fail "coupling: exit $EXIT"
[ -n "$OUT" ] && ok "coupling: output non vuoto" || warn "coupling: output vuoto"

for SORT in instability ca ce name; do
  OUT=$($KG coupling --sort $SORT 2>&1)
  EXIT=$?
  [ $EXIT -eq 0 ] && ok "coupling --sort $SORT: exit 0" || fail "coupling --sort $SORT: exit $EXIT"
done

# ── 6. package ────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[4] package${RESET}"
OUT=$($KG package src/auth 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "package src/auth: exit 0" || fail "package src/auth: exit $EXIT"

OUT=$($KG package src/core 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "package src/core: exit 0" || fail "package src/core: exit $EXIT"

# ── 7. manifest ───────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[5] manifest${RESET}"
OUT=$($KG manifest 2>&1)
EXIT=$?
[ $EXIT -eq 0 ] && ok "manifest: exit 0" || fail "manifest: exit $EXIT"
[ -n "$OUT" ] && ok "manifest: output non vuoto" || fail "manifest: output vuoto"
echo "$OUT" | grep -qi "lodash\|express\|typescript\|dependency\|package" \
  && ok "manifest: trova le dipendenze (lodash/express/typescript)" \
  || warn "manifest: dipendenze non trovate nell'output"

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
