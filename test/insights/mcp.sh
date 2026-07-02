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

echo -e "\n${BOLD}  KiroGraph MCP — insights tools (enableCodeHealth)${RESET}"
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
{"name":"mock-insights-mcp","version":"1.0.0","private":true}
EOF
cat > "$TEST_DIR/src/base.ts" << 'EOF'
/** Base service abstraction */
export abstract class BaseService {
  abstract process(input: string): string;
  validate(input: string): boolean { return input.length > 0; }
}
export interface Repository<T> { findById(id: string): T | null; findAll(): T[]; }
EOF
cat > "$TEST_DIR/src/auth.ts" << 'EOF'
import { BaseService } from './base';
/** @deprecated use AuthV2 */
export class AuthService extends BaseService {
  process(input: string): string { return input.toUpperCase(); }
  login(user: string): boolean { return this.validate(user); }
}
EOF
cat > "$TEST_DIR/src/user.ts" << 'EOF'
import { BaseService } from './base';
import { Repository } from './base';
/** God class with too many responsibilities */
export class UserService extends BaseService implements Repository<string> {
  process(input: string): string { return input; }
  findById(id: string): string | null { return id; }
  findAll(): string[] { return []; }
  create(name: string): string { return name; }
  update(id: string, name: string): void {}
  delete(id: string): void {}
  validate2(input: string): boolean { return true; }
  format(input: string): string { return input.trim(); }
  transform(input: string): string { return input.toLowerCase(); }
  export(): string[] { return []; }
}
EOF
cat > "$TEST_DIR/src/utils.ts" << 'EOF'
import { TokenManager } from './nonexistent';
export function factorial(n: number): number { return n <= 1 ? 1 : n * factorial(n - 1); }
export function fibonacci(n: number): number { return n <= 1 ? n : fibonacci(n-1) + fibonacci(n-2); }
export function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
EOF
cat > "$TEST_DIR/src/index.ts" << 'EOF'
export { BaseService } from './base';
export { AuthService } from './auth';
export { UserService } from './user';
export { factorial, fibonacci } from './utils';
EOF

cd "$TEST_DIR"
$KG init > /dev/null 2>&1
node -e "
const fs = require('fs'), p = '.kirograph/config.json';
const c = JSON.parse(fs.readFileSync(p,'utf8'));
c.enableCodeHealth = true; c.trackCallSites = true;
fs.writeFileSync(p, JSON.stringify(c,null,2));
"
$KG index > /dev/null 2>&1
[ -f ".kirograph/kirograph.db" ] && ok "Mock inizializzato (enableCodeHealth)" || { fail "kirograph.db non trovato"; exit 1; }

sep; echo -e "  ${BOLD}[1] kirograph_annotations${RESET}"
run_mcp kirograph_annotations '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[2] kirograph_dependency_depth${RESET}"
run_mcp kirograph_dependency_depth '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[3] kirograph_distribution${RESET}"
run_mcp kirograph_distribution '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[4] kirograph_doc_coverage${RESET}"
run_mcp kirograph_doc_coverage '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[5] kirograph_rank${RESET}"
run_mcp kirograph_rank '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[6] kirograph_unused_imports${RESET}"
run_mcp kirograph_unused_imports '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
echo "$OUT" | grep -qi "TokenManager\|unused\|import" && ok "trova import inutilizzato" || warn "import non trovato"

sep; echo -e "  ${BOLD}[7] kirograph_type_hierarchy${RESET}"
run_mcp kirograph_type_hierarchy '{"symbol":"BaseService"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
echo "$OUT" | grep -qi "AuthService\|UserService\|hierarchy\|extends" && ok "trova derivate di BaseService" || warn "derivate non trovate"

sep; echo -e "  ${BOLD}[8] kirograph_god_class${RESET}"
run_mcp kirograph_god_class '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
echo "$OUT" | grep -qi "UserService\|god\|method" && ok "individua UserService" || warn "god class non trovata"

sep; echo -e "  ${BOLD}[9] kirograph_inheritance_depth${RESET}"
run_mcp kirograph_inheritance_depth '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[10] kirograph_recursion${RESET}"
run_mcp kirograph_recursion '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
echo "$OUT" | grep -qi "factorial\|fibonacci\|recursion" && ok "trova funzioni ricorsive" || warn "ricorsione non trovata"

sep; echo -e "  ${BOLD}[11] kirograph_largest${RESET}"
run_mcp kirograph_largest '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[12] kirograph_gini${RESET}"
run_mcp kirograph_gini '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[13] kirograph_module_api${RESET}"
run_mcp kirograph_module_api '{"path":"src"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"

sep; echo -e "  ${BOLD}[14] kirograph_rename_preview${RESET}"
run_mcp kirograph_rename_preview '{"symbol":"BaseService"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
echo "$OUT" | grep -qi "BaseService\|rename\|reference\|file" && ok "mostra piano di rename" || warn "piano non trovato"

sep
echo ""
if [ "$FAILURES" -eq 0 ]; then echo -e "  ${GREEN}${BOLD}Tutti i controlli superati.${RESET}"
else echo -e "  ${RED}${BOLD}$FAILURES controllo/i fallito/i.${RESET}"; exit 1; fi
echo ""
