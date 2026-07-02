#!/usr/bin/env bash
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

echo -e "\n${BOLD}  KiroGraph MCP — architecture tools (enableArchitecture)${RESET}"
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
rm -rf "$TEST_DIR" && mkdir -p "$TEST_DIR/src/auth" "$TEST_DIR/src/user" "$TEST_DIR/src/core"
cat > "$TEST_DIR/package.json" << 'EOF'
{"name":"mock-arch-mcp","version":"1.0.0","private":true,"dependencies":{"lodash":"^4.17.21","express":"^4.18.0"},"devDependencies":{"typescript":"^5.0.0"}}
EOF
cat > "$TEST_DIR/package-lock.json" << 'EOF'
{"lockfileVersion":3,"packages":{"node_modules/lodash":{"version":"4.17.21","license":"MIT"},"node_modules/express":{"version":"4.18.2","license":"MIT"},"node_modules/typescript":{"version":"5.1.6","license":"Apache-2.0","dev":true}}}
EOF
cat > "$TEST_DIR/src/core/database.ts" << 'EOF'
export class Database { connect(): void {} query(sql: string): unknown[] { return []; } }
EOF
cat > "$TEST_DIR/src/auth/service.ts" << 'EOF'
import { Database } from '../core/database';
export class AuthService { private db = new Database(); login(u: string): boolean { return !!this.db.query(u).length; } }
EOF
cat > "$TEST_DIR/src/user/repository.ts" << 'EOF'
import { Database } from '../core/database';
export class UserRepository { private db = new Database(); findAll(): unknown[] { return this.db.query('SELECT * FROM users'); } }
EOF
cat > "$TEST_DIR/src/app.ts" << 'EOF'
import { AuthService } from './auth/service';
import { UserRepository } from './user/repository';
export class App { auth = new AuthService(); users = new UserRepository(); }
EOF

cd "$TEST_DIR"
$KG init > /dev/null 2>&1
node -e "
const fs = require('fs'), p = '.kirograph/config.json';
const c = JSON.parse(fs.readFileSync(p,'utf8'));
c.enableArchitecture = true; c.enableNavigation = true;
fs.writeFileSync(p, JSON.stringify(c,null,2));
"
$KG index > /dev/null 2>&1
[ -f ".kirograph/kirograph.db" ] && ok "Mock inizializzato (enableArchitecture)" || { fail "kirograph.db non trovato"; exit 1; }

sep; echo -e "  ${BOLD}[1] kirograph_architecture${RESET}"
run_mcp kirograph_architecture '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || fail "output vuoto"

run_mcp kirograph_architecture '{"level":"files"}'
[ $EXIT -eq 0 ] && ok "level=files: exit 0" || fail "level=files: exit $EXIT"
echo "$OUT" | grep -qiE "auth|user|core|src" && ok "trova package del progetto" || warn "package non trovati"

sep; echo -e "  ${BOLD}[2] kirograph_coupling${RESET}"
run_mcp kirograph_coupling '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

for sortval in instability ca ce name; do
  run_mcp kirograph_coupling "{\"sortBy\":\"$sortval\"}"
  [ $EXIT -eq 0 ] && ok "sortBy=$sortval: exit 0" || fail "sortBy=$sortval: exit $EXIT"
done

sep; echo -e "  ${BOLD}[3] kirograph_package${RESET}"
run_mcp kirograph_package '{"package":"src/auth"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"
echo "$OUT" | grep -qi "AuthService\|auth\|package" && ok "descrive il package auth" || warn "contenuto auth non trovato"

sep; echo -e "  ${BOLD}[4] kirograph_manifest${RESET}"
run_mcp kirograph_manifest '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || fail "output vuoto"
echo "$OUT" | grep -qi "lodash\|express\|typescript\|dependency\|package" && ok "trova dipendenze npm" || warn "dipendenze non trovate"

sep
echo ""
if [ "$FAILURES" -eq 0 ]; then echo -e "  ${GREEN}${BOLD}Tutti i controlli superati.${RESET}"
else echo -e "  ${RED}${BOLD}$FAILURES controllo/i fallito/i.${RESET}"; exit 1; fi
echo ""
