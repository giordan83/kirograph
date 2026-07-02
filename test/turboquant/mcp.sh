#!/usr/bin/env bash
# mcp.sh — integration test REALE per semanticEngine: turboquant
#
# Testa il pipeline COMPLETO:
#   1. turboquant-js disponibile (npm install se mancante)
#   2. Mock ricco con ~25 nodi embeddabili (TypeScript realistico)
#   3. kirograph index con enableEmbeddings: true → embedding reali (nomic-embed-text-v1.5)
#   4. Verifica vettori nel DB > 0
#   5. Verifica turboquant.bin esiste e ha dimensione > 0
#   6. Verifica turboquant-stats.json con count > 0
#   7. kirograph_status riporta "turboquant" + entries > 0, nessun fallback
#   8. kirograph_search con query semantica → risultati rilevanti
#
# Uso: ./mcp.sh [--no-build]

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

echo -e "\n${BOLD}  KiroGraph MCP — turboquant (embedding reale · turboquant-js)${RESET}"
echo -e "  ${DIM}$TEST_DIR${RESET}"

# ── [0] Build ──────────────────────────────────────────────────────────────────
sep
if [ "$NO_BUILD" = false ]; then
  info "Building kirograph..."
  cd "$ROOT" && npm run build > /dev/null 2>&1 && ok "Build OK"
else
  warn "--no-build: usando dist esistente"
fi

# ── [1] Verifica turboquant-js ─────────────────────────────────────────────────
sep
info "Verifica turboquant-js..."
if node -e "require('turboquant-js')" 2>/dev/null; then
  ok "turboquant-js: disponibile"
else
  info "turboquant-js non installato — installo..."
  if npm install turboquant-js --prefix "$ROOT" > /dev/null 2>&1; then
    node -e "require('turboquant-js')" 2>/dev/null \
      && ok "turboquant-js: installato" \
      || { fail "turboquant-js installato ma non caricabile"; exit 1; }
  else
    fail "Impossibile installare turboquant-js. Esegui: npm install turboquant-js"
    exit 1
  fi
fi

# ── [2] Verifica modello embedding in cache ────────────────────────────────────
sep
info "Verifica modello embedding..."
MODEL_CACHE="$HOME/.kirograph/models/nomic-ai/nomic-embed-text-v1.5"
if [ -d "$MODEL_CACHE" ]; then
  ok "nomic-embed-text-v1.5: in cache"
else
  warn "Modello non in cache — verrà scaricato durante l'indicizzazione (~250MB)"
fi

# ── [3] Setup mock ricco (~25 nodi embeddabili) ────────────────────────────────
sep
info "Setup mock con ~25 nodi embeddabili (8 file TypeScript)..."
rm -rf "$TEST_DIR" && mkdir -p "$TEST_DIR/src/services" "$TEST_DIR/src/models" "$TEST_DIR/src/utils"

cat > "$TEST_DIR/package.json" << 'PKGJSON'
{"name":"mock-turboquant-mcp","version":"1.0.0","private":true}
PKGJSON

cat > "$TEST_DIR/src/models/User.ts" << 'EOF'
/** Represents a user account in the system. */
export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  createdAt: Date;
}

/** User account status enumeration. */
export type AccountStatus = 'active' | 'suspended' | 'pending_verification';

/** Manages user entity persistence and retrieval. */
export class UserRepository {
  private users = new Map<string, UserProfile>();

  /** Find a user account by their email address. */
  findByEmail(email: string): UserProfile | undefined {
    return [...this.users.values()].find(u => u.email === email);
  }

  /** Persist a new user profile to the data store. */
  save(user: UserProfile): void {
    this.users.set(user.id, user);
  }

  /** Remove a user account from the system permanently. */
  delete(userId: string): boolean {
    return this.users.delete(userId);
  }

  /** Count total registered users. */
  count(): number {
    return this.users.size;
  }
}
EOF

cat > "$TEST_DIR/src/models/Product.ts" << 'EOF'
/** A purchasable product in the catalogue. */
export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  stock: number;
}

/** Manages product catalogue and inventory. */
export class ProductCatalogue {
  private products: Product[] = [];

  /** Search products by category or keyword. */
  search(query: string): Product[] {
    const q = query.toLowerCase();
    return this.products.filter(p =>
      p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
    );
  }

  /** Check if a product is available for purchase. */
  isInStock(productId: string): boolean {
    const p = this.products.find(p => p.id === productId);
    return p ? p.stock > 0 : false;
  }

  /** Decrement inventory after a sale transaction. */
  decrementStock(productId: string, quantity: number): void {
    const p = this.products.find(p => p.id === productId);
    if (p) p.stock = Math.max(0, p.stock - quantity);
  }
}
EOF

cat > "$TEST_DIR/src/services/AuthService.ts" << 'EOF'
import { UserRepository, UserProfile } from '../models/User';

/** Result of an authentication attempt. */
export interface AuthResult {
  success: boolean;
  token?: string;
  error?: string;
}

/** Handles user login, logout, and session management. */
export class AuthService {
  constructor(private readonly users: UserRepository) {}

  /** Authenticate a user with email and password credentials. */
  async login(email: string, password: string): Promise<AuthResult> {
    const user = this.users.findByEmail(email);
    if (!user) return { success: false, error: 'User not found' };
    const token = await this.generateSessionToken(user);
    return { success: true, token };
  }

  /** Generate a cryptographically secure session token. */
  private async generateSessionToken(user: UserProfile): Promise<string> {
    return `tok_${user.id}_${Date.now()}`;
  }

  /** Invalidate a session token to log out the user. */
  logout(token: string): void {
    void token;
  }

  /** Verify that a session token is valid and not expired. */
  isTokenValid(token: string): boolean {
    return token.startsWith('tok_');
  }
}
EOF

cat > "$TEST_DIR/src/services/PaymentService.ts" << 'EOF'
import { Product } from '../models/Product';

/** Payment transaction result. */
export interface PaymentResult {
  transactionId: string;
  amount: number;
  currency: string;
  status: 'approved' | 'declined' | 'pending';
}

/** Processes financial transactions and payment gateway integration. */
export class PaymentService {
  /** Charge a credit card for a product purchase. */
  async chargeCard(cardToken: string, product: Product, quantity: number): Promise<PaymentResult> {
    const amount = product.price * quantity;
    return { transactionId: `txn_${Date.now()}`, amount, currency: 'USD', status: 'approved' };
  }

  /** Issue a refund for a previous transaction. */
  async refund(transactionId: string, amount: number): Promise<boolean> {
    void transactionId; void amount;
    return true;
  }

  /** Validate a payment card token before charging. */
  validateCardToken(token: string): boolean {
    return token.length > 10;
  }
}
EOF

cat > "$TEST_DIR/src/services/NotificationService.ts" << 'EOF'
/** Notification delivery channel options. */
export type NotificationChannel = 'email' | 'sms' | 'push';

/** Sends alerts and messages to users via multiple channels. */
export class NotificationService {
  private queue: Array<{ userId: string; message: string; channel: NotificationChannel }> = [];

  /** Queue an email notification for a user. */
  sendEmail(userId: string, subject: string, body: string): void {
    this.queue.push({ userId, message: `${subject}: ${body}`, channel: 'email' });
  }

  /** Queue a push notification for a mobile device. */
  sendPush(userId: string, message: string): void {
    this.queue.push({ userId, message, channel: 'push' });
  }

  /** Flush the queue and deliver all pending notifications. */
  async flushQueue(): Promise<number> {
    const count = this.queue.length;
    this.queue = [];
    return count;
  }
}
EOF

cat > "$TEST_DIR/src/utils/crypto.ts" << 'EOF'
/** Generate a universally unique identifier (UUID v4). */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/** Compute a simple hash of a string for caching purposes. */
export function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/** Encode data to Base64 for safe transmission over HTTP. */
export function encodeBase64(data: string): string {
  return Buffer.from(data).toString('base64');
}
EOF

cat > "$TEST_DIR/src/utils/validation.ts" << 'EOF'
/** Check if a string is a valid email address format. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Sanitize user input to prevent injection attacks. */
export function sanitizeInput(raw: string): string {
  return raw.replace(/[<>"'&]/g, c => `&#${c.charCodeAt(0)};`);
}

/** Validate that a price is a positive finite number. */
export function isValidPrice(value: unknown): value is number {
  return typeof value === 'number' && isFinite(value) && value >= 0;
}
EOF

cat > "$TEST_DIR/src/OrderService.ts" << 'EOF'
import { ProductCatalogue } from './models/Product';
import { PaymentService } from './services/PaymentService';
import { NotificationService } from './services/NotificationService';

/** Manages the complete order lifecycle from cart to delivery. */
export class OrderService {
  constructor(
    private readonly catalogue: ProductCatalogue,
    private readonly payments: PaymentService,
    private readonly notifications: NotificationService,
  ) {}

  /** Place a new order and process payment for the given product. */
  async placeOrder(userId: string, productId: string, quantity: number, cardToken: string) {
    if (!this.catalogue.isInStock(productId)) {
      throw new Error('Product out of stock');
    }
    const products = this.catalogue.search(productId);
    const product = products[0];
    if (!product) throw new Error('Product not found');

    const payment = await this.payments.chargeCard(cardToken, product, quantity);
    if (payment.status !== 'approved') throw new Error('Payment declined');

    this.catalogue.decrementStock(productId, quantity);
    this.notifications.sendEmail(userId, 'Order confirmed', `Transaction: ${payment.transactionId}`);
    return payment;
  }

  /** Cancel an existing order and issue a refund. */
  async cancelOrder(userId: string, transactionId: string, amount: number): Promise<void> {
    await this.payments.refund(transactionId, amount);
    this.notifications.sendPush(userId, 'Your order has been cancelled and refunded.');
  }
}
EOF

cd "$TEST_DIR"
$KG init > /dev/null 2>&1
node -e "
const fs = require('fs'), p = '.kirograph/config.json';
const c = JSON.parse(fs.readFileSync(p,'utf8'));
c.enableEmbeddings = true;
c.semanticEngine = 'turboquant';
c.turboquantBits = 4;
c.turboquantMemDocs = false;
c.enableNavigation = true;
fs.writeFileSync(p, JSON.stringify(c,null,2));
"
ok "Mock creato: 8 file TypeScript, ~25 nodi embeddabili"

info "Indicizzazione con embeddings (30-90s se modello in cache)..."
$KG index 2>&1 | grep -E "✓|symbol|embed|error|Error|Warning" | sed 's/^/     /' || true

[ -f ".kirograph/kirograph.db" ] && ok "kirograph.db creato" || { fail "kirograph.db non trovato"; exit 1; }

# ── [4] Verifica file indice (turboquant usa formato binario, non SQLite) ──────
# I vettori quantizzati sono in turboquant.bin; stats.json riporta il conteggio.
sep; echo -e "  ${BOLD}[1] File indice e metadati${RESET}"

# ── [5] Verifica turboquant.bin ────────────────────────────────────────────────
echo -e "  ${BOLD}turboquant.bin${RESET}"
if [ -f ".kirograph/turboquant.bin" ]; then
  ok "turboquant.bin: esiste"
  BIN_SIZE=$(wc -c < ".kirograph/turboquant.bin" | tr -d ' ')
  if [ "$BIN_SIZE" -gt 0 ]; then
    ok "turboquant.bin: ${BIN_SIZE} bytes"
  else
    fail "turboquant.bin: vuoto (0 bytes)"
  fi
else
  fail "turboquant.bin: non trovato — l'engine turboquant non ha creato l'indice"
fi

# ── [6] Verifica turboquant-stats.json ────────────────────────────────────────
echo -e "  ${BOLD}turboquant-stats.json${RESET}"
if [ -f ".kirograph/turboquant-stats.json" ]; then
  ok "turboquant-stats.json: esiste"
  STATS_COUNT=$(node -e "
const fs = require('fs');
try { const s = JSON.parse(fs.readFileSync('.kirograph/turboquant-stats.json','utf8')); console.log(s.count||0); }
catch { console.log(0); }
" 2>/dev/null || echo "0")
  if [ "$STATS_COUNT" -gt 0 ]; then
    ok "stats.count: $STATS_COUNT vettori indicizzati"
    STATS_BITS=$(node -e "const s=JSON.parse(require('fs').readFileSync('.kirograph/turboquant-stats.json','utf8')); console.log(s.bits||0)" 2>/dev/null || echo "0")
    ok "stats.bits: $STATS_BITS bit per coordinata"
  else
    fail "stats.count = 0 — turboquant non ha indicizzato vettori"
  fi
else
  fail "turboquant-stats.json: non trovato"
fi

# ── [7] kirograph_status: engine attivo, nessun fallback ──────────────────────
sep; echo -e "  ${BOLD}[4] kirograph_status — engine verificato${RESET}"
run_mcp kirograph_status '{}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
echo "$OUT" | grep -qi "turboquant" \
  && ok "status riporta 'turboquant'" \
  || fail "status non menziona turboquant — engine non attivo"
echo "$OUT" | grep -qiE "turboquant \([1-9][0-9]* entr" \
  && ok "entries > 0 riportate da status" \
  || warn "pattern entries non trovato (verificare formato status)"
echo "$OUT" | grep -qi "fallback" \
  && fail "ENGINE FALLBACK RILEVATO — turboquant non attivo, usa cosine" \
  || ok "nessun fallback — turboquant ANN attivo"

# ── [8] kirograph_search semantica ────────────────────────────────────────────
sep; echo -e "  ${BOLD}[5] kirograph_search semantica${RESET}"
run_mcp kirograph_search '{"query":"user login authentication credentials"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || fail "output vuoto"
echo "$OUT" | grep -qiE "AuthService|login|auth|UserRepository|token" \
  && ok "risultati semanticamente rilevanti (auth/login)" \
  || warn "risultati attesi non trovati (auth/login)"

run_mcp kirograph_search '{"query":"process payment credit card transaction"}'
[ $EXIT -eq 0 ] && ok "semantic payment: exit 0" || fail "semantic payment: exit $EXIT"
echo "$OUT" | grep -qiE "Payment|charge|transaction|card" \
  && ok "risultati semanticamente rilevanti (payment)" \
  || warn "nessun match semantico per query payment"

run_mcp kirograph_search '{"query":"send email notification to user","limit":5}'
[ $EXIT -eq 0 ] && ok "semantic notification: exit 0" || fail "semantic notification: exit $EXIT"

# ── [9] kirograph_context semantica ───────────────────────────────────────────
sep; echo -e "  ${BOLD}[6] kirograph_context semantica${RESET}"
run_mcp kirograph_context '{"task":"how does user authentication work"}'
[ $EXIT -eq 0 ] && ok "exit 0" || fail "exit $EXIT — $OUT"
[ -n "$OUT" ] && ok "output non vuoto" || warn "output vuoto"
echo "$OUT" | grep -qiE "AuthService|login|token|authenticate" \
  && ok "context semanticamente rilevante" \
  || warn "context non mostra simboli auth attesi"

# ── Fine ──────────────────────────────────────────────────────────────────────
sep
echo ""
if [ "$FAILURES" -eq 0 ]; then echo -e "  ${GREEN}${BOLD}Tutti i controlli superati.${RESET}"
else echo -e "  ${RED}${BOLD}$FAILURES controllo/i fallito/i.${RESET}"; exit 1; fi
echo ""
