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

echo -e "\n${BOLD}  KiroGraph MCP — graph tools (callers · callees · impact · circular_deps · snapshot)${RESET}"
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
rm -rf "$TEST_DIR" && mkdir -p "$TEST_DIR/src"
cat > "$TEST_DIR/package.json" << 'EOF'
{"name":"mock-graph-mcp","version":"1.0.0","private":true}
EOF
cat > "$TEST_DIR/src/database.ts" << 'EOF'
export class Database { connect(): void {} query(sql: string): unknown[] { return []; } }
EOF
cat > "$TEST_DIR/src/token.ts" << 'EOF'
import { Database } from './database';
export function generateToken(db: Database): string { db.connect(); return 'tok'; }
EOF
cat > "$TEST_DIR/src/user.ts" << 'EOF'
import { Database } from './database';
import { generateToken } from './token';
export class UserService {
  private db = new Database();
  login(username: string): string { return generateToken(this.db); }
  findAll(): unknown[] { return this.db.query('SELECT * FROM users'); }
}
EOF
cat > "$TEST_DIR/src/auth.ts" << 'EOF'
import { UserService } from './user';
export class AuthService {
  private users = new UserService();
  authenticate(u: string): string { return this.users.login(u); }
}
EOF
cat > "$TEST_DIR/src/app.ts" << 'EOF'
import { AuthService } from './auth';
const auth = new AuthService();
auth.authenticate('admin');
EOF

cd "$TEST_DIR"
$KG init > /dev/null 2>&1
node -e "
const fs = require('fs'), p = '.kirograph/config.json';
const c = JSON.parse(fs.readFileSync(p,'utf8'));
c.trackCallSites = true; c.enableNavigation = true; c.enableCodeHealth = true;
fs.writeFileSync(p, JSON.stringify(c,null,2));
"
$KG index > /dev/null 2>&1
[ -f ".kirograph/kirograph.db" ] && ok "Mock inizializzato" || { fail "kirograph.db non trovato"; exit 1; }

sep; echo -e "  ${BOLD}[1] kirograph_callers${RESET}"
run_mcp kirograph_callers '{"symbol":"login"}'
[ $EXIT -eq 0 ] && ok "kirograph_callers: exit 0" || fail "kirograph_callers: exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"
echo "$OUT" | grep -qi "authenticate\|AuthService\|caller" && ok "trova caller di login" || warn "caller non trovato"

sep; echo -e "  ${BOLD}[2] kirograph_callees${RESET}"
run_mcp kirograph_callees '{"symbol":"login"}'
[ $EXIT -eq 0 ] && ok "kirograph_callees: exit 0" || fail "kirograph_callees: exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"
echo "$OUT" | grep -qi "generateToken\|Database\|callee" && ok "trova callees di login" || warn "callees non trovati"

sep; echo -e "  ${BOLD}[3] kirograph_impact${RESET}"
run_mcp kirograph_impact '{"symbol":"Database"}'
[ $EXIT -eq 0 ] && ok "kirograph_impact: exit 0" || fail "kirograph_impact: exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"
echo "$OUT" | grep -qi "UserService\|token\|impact" && ok "trova dipendenti di Database" || warn "dipendenti non trovati"

sep; echo -e "  ${BOLD}[4] kirograph_circular_deps${RESET}"
run_mcp kirograph_circular_deps '{}'
[ $EXIT -eq 0 ] && ok "kirograph_circular_deps: exit 0" || fail "kirograph_circular_deps: exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[5] kirograph_snapshot_save${RESET}"
run_mcp kirograph_snapshot_save '{"label":"mcp-test-snap"}'
[ $EXIT -eq 0 ] && ok "kirograph_snapshot_save: exit 0" || fail "kirograph_snapshot_save: exit $EXIT — $OUT"
echo "$OUT" | grep -qi "mcp-test-snap\|snapshot\|saved" && ok "label confermata" || warn "label non trovata"

sep; echo -e "  ${BOLD}[6] kirograph_snapshot_list${RESET}"
run_mcp kirograph_snapshot_list '{}'
[ $EXIT -eq 0 ] && ok "kirograph_snapshot_list: exit 0" || fail "kirograph_snapshot_list: exit $EXIT — $OUT"
echo "$OUT" | grep -qi "mcp-test-snap\|snapshot" && ok "trova mcp-test-snap" || warn "snapshot non trovato"

sep
echo ""
if [ "$FAILURES" -eq 0 ]; then echo -e "  ${GREEN}${BOLD}Tutti i controlli superati.${RESET}"
else echo -e "  ${RED}${BOLD}$FAILURES controllo/i fallito/i.${RESET}"; exit 1; fi
echo ""
