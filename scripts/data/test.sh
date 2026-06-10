#!/usr/bin/env bash
# test-data.sh — testa il modulo data di KiroGraph su un progetto mock multi-formato.
#
# Verifica:
#   A. CSV, JSONL, JSON → data_datasets + data_columns + data_rows_*
#   B. Excel (.xlsx) → graceful-skip se xlsx non installato; full indexing se installato
#   C. Parquet (.parquet) → graceful-skip se parquetjs-lite non installato; full indexing se installato
#   D. PDF (.pdf) → graceful-skip se @firecrawl/pdf-inspector non installato;
#                   full indexing (page/content columns, metadata_json) se installato
#   E. CLI: list, describe, query (filtri), aggregate, quality, search, join
#   F. classify: errore chiaro se non installato, output JSON se installato
#   G. Linker: data_code_refs su src/app.ts che referenzia tutti i data file
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

ok()   { echo -e "  ${GREEN}✓${RESET}  $1"; }
fail() { echo -e "  ${RED}✗${RESET}  $1"; FAILURES=$((FAILURES + 1)); }
info() { echo -e "  ${CYAN}›${RESET}  $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET}  $1"; }
sep()  { echo -e "\n${DIM}──────────────────────────────────────────────────────${RESET}"; }

FAILURES=0
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_DIR="$SCRIPT_DIR/mock"
KG="node $ROOT/dist/bin/kirograph.js"
DB="$TEST_DIR/.kirograph/kirograph.db"

echo -e "\n${BOLD}  KiroGraph Data — test modulo data (CSV · JSONL · JSON · Excel · Parquet · PDF)${RESET}"
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

# ── 2. Pulizia ────────────────────────────────────────────────────────────────
sep
info "Pulizia .kirograph/ e .kiro/..."
rm -rf "$TEST_DIR/.kirograph" "$TEST_DIR/.kiro"
ok "Progetto vergine"
cd "$TEST_DIR"

# ── 3. Controlla dipendenze opzionali ─────────────────────────────────────────
sep
echo -e "  ${BOLD}[1] Dipendenze opzionali${RESET}\n"

XLSX_INSTALLED=false
PARQUET_INSTALLED=false
PDF_INSPECTOR_INSTALLED=false

node -e "require('xlsx')" 2>/dev/null \
  && { XLSX_INSTALLED=true; ok "xlsx installato — test Excel completi"; } \
  || warn "xlsx non installato — test graceful-skip Excel"

node -e "require('parquetjs-lite')" 2>/dev/null \
  && { PARQUET_INSTALLED=true; ok "parquetjs-lite installato — test Parquet completi"; } \
  || warn "parquetjs-lite non installato — test graceful-skip Parquet"

node -e "require('@firecrawl/pdf-inspector')" 2>/dev/null \
  && { PDF_INSPECTOR_INSTALLED=true; ok "@firecrawl/pdf-inspector installato — test PDF completi"; } \
  || warn "@firecrawl/pdf-inspector non installato — test graceful-skip PDF"

# ── 4. Setup mock files ───────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[2] Setup mock files${RESET}\n"

# PDF (Python)
if command -v python3 &>/dev/null; then
  python3 << 'PYEOF'
import os

def make_minimal_pdf():
    parts = []
    header = b'%PDF-1.4\n'
    parts.append(header)
    offsets = []

    offsets.append(sum(len(p) for p in parts))
    parts.append(b'1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n')

    offsets.append(sum(len(p) for p in parts))
    parts.append(b'2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n')

    offsets.append(sum(len(p) for p in parts))
    parts.append(b'3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources <<>>>>\nendobj\n')

    stream_content = b'BT /F1 12 Tf 50 700 Td (KiroGraph data module test PDF) Tj ET'
    obj4_body = b'4 0 obj\n<</Length ' + str(len(stream_content)).encode() + b'>>\nstream\n'
    offsets.append(sum(len(p) for p in parts))
    parts.append(obj4_body + stream_content + b'\nendstream\nendobj\n')

    body = b''.join(parts)
    xref_offset = len(body)

    xref = b'xref\n0 5\n0000000000 65535 f \n'
    for off in offsets:
        xref += f'{off:010d} 00000 n \n'.encode()

    trailer = b'trailer\n<</Size 5 /Root 1 0 R>>\nstartxref\n'
    trailer += f'{xref_offset}\n'.encode()
    trailer += b'%%EOF\n'

    return body + xref + trailer

pdf = make_minimal_pdf()
os.makedirs('data', exist_ok=True)
with open('data/report.pdf', 'wb') as f:
    f.write(pdf)
print(f'  Created data/report.pdf ({len(pdf)} bytes)')
PYEOF
  ok "data/report.pdf generato"
else
  warn "python3 non disponibile — data/report.pdf non generato"
fi

# Excel (Node.js, solo se xlsx installato)
if [ "$XLSX_INSTALLED" = true ]; then
  node << 'JSEOF'
const XLSX = require('xlsx');
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ['quarter', 'revenue', 'cost', 'region'],
  ['Q1', 120000, 80000, 'EU'],
  ['Q2', 145000, 92000, 'EU'],
  ['Q3',  98000, 71000, 'US'],
  ['Q4', 210000, 130000, 'US'],
  ['Q1',  85000, 60000, 'APAC'],
  ['Q2', 110000, 74000, 'APAC'],
]);
XLSX.utils.book_append_sheet(wb, ws, 'metrics');
const fs = require('fs');
fs.mkdirSync('data', { recursive: true });
XLSX.writeFile(wb, 'data/metrics.xlsx');
console.log('  Created data/metrics.xlsx (6 rows)');
JSEOF
  ok "data/metrics.xlsx generato"
else
  warn "xlsx non installato — data/metrics.xlsx non generato"
fi

# Parquet (Node.js, solo se parquetjs-lite installato)
if [ "$PARQUET_INSTALLED" = true ]; then
  node << 'JSEOF'
const parquet = require('parquetjs-lite');
const fs = require('fs');

async function main() {
  fs.mkdirSync('data', { recursive: true });
  const schema = new parquet.ParquetSchema({
    sensor_id: { type: 'UTF8' },
    timestamp:  { type: 'UTF8' },
    temp_c:     { type: 'DOUBLE' },
    humidity:   { type: 'DOUBLE' },
    location:   { type: 'UTF8' },
  });
  const writer = await parquet.ParquetWriter.openFile(schema, 'data/sensors.parquet');
  const rows = [
    { sensor_id: 'S001', timestamp: '2024-01-01T08:00:00Z', temp_c: 21.3, humidity: 55.2, location: 'lab-a' },
    { sensor_id: 'S002', timestamp: '2024-01-01T08:00:00Z', temp_c: 19.8, humidity: 60.1, location: 'lab-b' },
    { sensor_id: 'S001', timestamp: '2024-01-01T09:00:00Z', temp_c: 22.1, humidity: 54.8, location: 'lab-a' },
    { sensor_id: 'S003', timestamp: '2024-01-01T09:00:00Z', temp_c: 18.5, humidity: 62.3, location: 'outdoor' },
    { sensor_id: 'S002', timestamp: '2024-01-01T10:00:00Z', temp_c: 20.4, humidity: 58.9, location: 'lab-b' },
  ];
  for (const row of rows) await writer.appendRow(row);
  await writer.close();
  console.log('  Created data/sensors.parquet (5 rows)');
}
main().catch(e => { console.error(e); process.exit(1); });
JSEOF
  ok "data/sensors.parquet generato"
else
  warn "parquetjs-lite non installato — data/sensors.parquet non generato"
fi

PDF_EXISTS=false
XLSX_EXISTS=false
PARQUET_EXISTS=false
[ -f "$TEST_DIR/data/report.pdf" ]    && PDF_EXISTS=true
[ -f "$TEST_DIR/data/metrics.xlsx" ]  && XLSX_EXISTS=true
[ -f "$TEST_DIR/data/sensors.parquet" ] && PARQUET_EXISTS=true

# ── 5. Configurazione ─────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[3] Configurazione${RESET}"
mkdir -p .kirograph
cat > .kirograph/config.json << 'EOF'
{
  "version": 1,
  "enableData": true,
  "enablePatterns": false,
  "enableSecurity": false,
  "enableEmbeddings": false,
  "enableDocs": false,
  "enableMemory": false
}
EOF
ok "config.json (enableData: true)"

# ── 6. Index ──────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[4] kirograph index${RESET}"
INDEX_OUT=$($KG index 2>&1)
echo "$INDEX_OUT" | grep -E "data:|Indexed|✓|dataset" | sed 's/^/     /' || true

[ -f "$DB" ] && ok "kirograph.db creato" || { fail "kirograph.db non trovato"; exit 1; }

DATA_ERRS=$(echo "$INDEX_OUT" | grep -c "\[kirograph:error\].*data:" || true)
if [ "$DATA_ERRS" -gt 0 ]; then
  fail "Trovati $DATA_ERRS errori data durante l'index"
  echo "$INDEX_OUT" | grep "\[kirograph:error\].*data:" | sed 's/^/     /'
else
  ok "Nessun errore data durante l'index"
fi

# ── DB helpers ────────────────────────────────────────────────────────────────
db()         { sqlite3 "$DB" "$1" 2>/dev/null || echo ''; }
ds_field()   { db "SELECT $2 FROM data_datasets WHERE id='$1';"; }
col_count()  { db "SELECT COUNT(*) FROM data_columns WHERE dataset_id='$1';"; }
col_exists() { db "SELECT COUNT(*) FROM data_columns WHERE dataset_id='$1' AND name='$2';"; }
row_count()  { db "SELECT COUNT(*) FROM \"data_rows_${1//-/_}\";"; }

# ── 7. Dataset: CSV ───────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[5] Dataset: users.csv${RESET}\n"

USERS_FORMAT=$(ds_field "data-users" "format")
USERS_ROWS=$(ds_field "data-users" "row_count")
USERS_COLS=$(ds_field "data-users" "column_count")

[ "$USERS_FORMAT" = "csv" ] \
  && ok "data-users: format='csv'" \
  || fail "data-users: format atteso 'csv', trovato '${USERS_FORMAT:-non trovato}'"
[ "$USERS_ROWS" -eq 5 ] 2>/dev/null \
  && ok "data-users: row_count=5" \
  || fail "data-users: row_count atteso 5, trovato '${USERS_ROWS:-?}'"
[ "${USERS_COLS:-0}" -eq 5 ] 2>/dev/null \
  && ok "data-users: column_count=5" \
  || fail "data-users: column_count atteso 5, trovato '${USERS_COLS:-?}'"
for col in id name email age role; do
  [ "$(col_exists "data-users" "$col")" -eq 1 ] \
    && ok "  colonna '$col'" \
    || fail "  colonna '$col' non trovata in data_columns"
done
STORED_ROWS=$(row_count "data-users")
[ "${STORED_ROWS:-0}" -eq 5 ] 2>/dev/null \
  && ok "data_rows_data_users: 5 righe memorizzate" \
  || fail "data_rows_data_users: attese 5 righe, trovate '${STORED_ROWS:-?}'"

# ── 8. Dataset: JSONL ─────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[6] Dataset: orders.jsonl${RESET}\n"

ORDERS_FORMAT=$(ds_field "data-orders" "format")
ORDERS_ROWS=$(ds_field "data-orders" "row_count")

[ "$ORDERS_FORMAT" = "jsonl" ] \
  && ok "data-orders: format='jsonl'" \
  || fail "data-orders: format atteso 'jsonl', trovato '${ORDERS_FORMAT:-non trovato}'"
[ "$ORDERS_ROWS" -eq 6 ] 2>/dev/null \
  && ok "data-orders: row_count=6" \
  || fail "data-orders: row_count atteso 6, trovato '${ORDERS_ROWS:-?}'"
for col in order_id user_id amount status region; do
  [ "$(col_exists "data-orders" "$col")" -eq 1 ] \
    && ok "  colonna '$col'" \
    || fail "  colonna '$col' non trovata in data_columns"
done

# ── 9. Dataset: JSON ──────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[7] Dataset: products.json${RESET}\n"

PRODS_FORMAT=$(ds_field "data-products" "format")
PRODS_ROWS=$(ds_field "data-products" "row_count")

[ "$PRODS_FORMAT" = "json" ] \
  && ok "data-products: format='json'" \
  || fail "data-products: format atteso 'json', trovato '${PRODS_FORMAT:-non trovato}'"
[ "$PRODS_ROWS" -eq 4 ] 2>/dev/null \
  && ok "data-products: row_count=4" \
  || fail "data-products: row_count atteso 4, trovato '${PRODS_ROWS:-?}'"
for col in id name category price in_stock; do
  [ "$(col_exists "data-products" "$col")" -eq 1 ] \
    && ok "  colonna '$col'" \
    || fail "  colonna '$col' non trovata in data_columns"
done

# ── 10. Dataset: Excel ────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[8] Dataset: metrics.xlsx${RESET}\n"

if [ "$XLSX_EXISTS" = false ]; then
  warn "data/metrics.xlsx non generato — sezione Excel saltata"
elif [ "$XLSX_INSTALLED" = true ]; then
  echo -e "  ${DIM}xlsx installato — verifica indicizzazione completa${RESET}\n"

  XLSX_FORMAT=$(ds_field "data-metrics" "format")
  XLSX_ROWS=$(ds_field "data-metrics" "row_count")

  [ "$XLSX_FORMAT" = "xlsx" ] \
    && ok "data-metrics: format='xlsx'" \
    || fail "data-metrics: format atteso 'xlsx', trovato '${XLSX_FORMAT:-non trovato}'"
  [ "${XLSX_ROWS:-0}" -ge 6 ] 2>/dev/null \
    && ok "data-metrics: row_count=${XLSX_ROWS} (attesi >=6)" \
    || fail "data-metrics: row_count atteso >=6, trovato '${XLSX_ROWS:-?}'"
  for col in quarter revenue cost region; do
    [ "$(col_exists "data-metrics" "$col")" -eq 1 ] \
      && ok "  colonna '$col'" \
      || fail "  colonna '$col' non trovata in data_columns"
  done
  XLSX_STORED=$(row_count "data-metrics")
  [ "${XLSX_STORED:-0}" -ge 6 ] 2>/dev/null \
    && ok "data_rows_data_metrics: ${XLSX_STORED} righe memorizzate" \
    || fail "data_rows_data_metrics: attese >=6 righe, trovate '${XLSX_STORED:-?}'"
else
  echo -e "  ${DIM}xlsx NON installato — verifica graceful-skip${RESET}\n"
  XLSX_IN_DB=$(db "SELECT COUNT(*) FROM data_datasets WHERE id='data-metrics';")
  [ "${XLSX_IN_DB:-0}" -eq 0 ] 2>/dev/null \
    && ok "data-metrics: NON in data_datasets (parser non disponibile → skip corretto)" \
    || fail "data-metrics: presente in data_datasets nonostante xlsx non sia installato"
fi

# ── 11. Dataset: Parquet ──────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[9] Dataset: sensors.parquet${RESET}\n"

if [ "$PARQUET_EXISTS" = false ]; then
  warn "data/sensors.parquet non generato — sezione Parquet saltata"
elif [ "$PARQUET_INSTALLED" = true ]; then
  echo -e "  ${DIM}parquetjs-lite installato — verifica indicizzazione completa${RESET}\n"

  PQ_FORMAT=$(ds_field "data-sensors" "format")
  PQ_ROWS=$(ds_field "data-sensors" "row_count")

  [ "$PQ_FORMAT" = "parquet" ] \
    && ok "data-sensors: format='parquet'" \
    || fail "data-sensors: format atteso 'parquet', trovato '${PQ_FORMAT:-non trovato}'"
  [ "${PQ_ROWS:-0}" -ge 5 ] 2>/dev/null \
    && ok "data-sensors: row_count=${PQ_ROWS} (attesi >=5)" \
    || fail "data-sensors: row_count atteso >=5, trovato '${PQ_ROWS:-?}'"
  for col in sensor_id timestamp temp_c humidity location; do
    [ "$(col_exists "data-sensors" "$col")" -eq 1 ] \
      && ok "  colonna '$col'" \
      || fail "  colonna '$col' non trovata in data_columns"
  done
  PQ_STORED=$(row_count "data-sensors")
  [ "${PQ_STORED:-0}" -ge 5 ] 2>/dev/null \
    && ok "data_rows_data_sensors: ${PQ_STORED} righe memorizzate" \
    || fail "data_rows_data_sensors: attese >=5 righe, trovate '${PQ_STORED:-?}'"
else
  echo -e "  ${DIM}parquetjs-lite NON installato — verifica graceful-skip${RESET}\n"
  PQ_IN_DB=$(db "SELECT COUNT(*) FROM data_datasets WHERE id='data-sensors';")
  [ "${PQ_IN_DB:-0}" -eq 0 ] 2>/dev/null \
    && ok "data-sensors: NON in data_datasets (parser non disponibile → skip corretto)" \
    || fail "data-sensors: presente in data_datasets nonostante parquetjs-lite non sia installato"
fi

# ── 12. Dataset: PDF ──────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[10] Dataset: report.pdf${RESET}\n"

if [ "$PDF_EXISTS" = false ]; then
  warn "data/report.pdf non generato — sezione PDF saltata"
elif [ "$PDF_INSPECTOR_INSTALLED" = true ]; then
  echo -e "  ${DIM}@firecrawl/pdf-inspector installato — verifica indicizzazione completa${RESET}\n"

  PDF_FORMAT=$(ds_field "data-report" "format")
  PDF_ROWS=$(ds_field "data-report" "row_count")
  PDF_META=$(ds_field "data-report" "metadata_json")

  [ "$PDF_FORMAT" = "pdf" ] \
    && ok "data-report: format='pdf'" \
    || fail "data-report: format atteso 'pdf', trovato '${PDF_FORMAT:-non trovato}'"
  [ "${PDF_ROWS:-0}" -ge 1 ] 2>/dev/null \
    && ok "data-report: row_count=${PDF_ROWS} (almeno 1 pagina)" \
    || fail "data-report: row_count atteso >=1, trovato '${PDF_ROWS:-?}'"
  for col in page content needs_ocr has_tables has_columns; do
    [ "$(col_exists "data-report" "$col")" -eq 1 ] \
      && ok "  colonna '$col'" \
      || fail "  colonna '$col' non trovata in data_columns"
  done
  if [ -n "${PDF_META:-}" ] && [ "$PDF_META" != "null" ]; then
    ok "metadata_json presente: $PDF_META"
  else
    warn "metadata_json null o assente"
  fi

  CLASSIFY_OUT=$($KG data classify data/report.pdf --json 2>&1)
  echo "$CLASSIFY_OUT" | sed 's/^/     /'
  echo "$CLASSIFY_OUT" | grep -qi "pdfType\|type\|confidence" \
    && ok "classify --json: output contiene tipo/confidence" \
    || fail "classify --json: output inatteso"
else
  echo -e "  ${DIM}@firecrawl/pdf-inspector NON installato — verifica graceful-skip${RESET}\n"

  PDF_IN_DB=$(db "SELECT COUNT(*) FROM data_datasets WHERE id='data-report';")
  [ "${PDF_IN_DB:-0}" -eq 0 ] 2>/dev/null \
    && ok "data-report: NON in data_datasets (parser non disponibile → skip corretto)" \
    || fail "data-report: presente in data_datasets nonostante il parser non sia disponibile"

  CLASSIFY_ERR=$($KG data classify data/report.pdf 2>&1 || true)
  echo "$CLASSIFY_ERR" | sed 's/^/     /'
  echo "$CLASSIFY_ERR" | grep -qiE "not installed|not available|unavailable|install|missing" \
    && ok "classify: messaggio di errore chiaro ('not installed' o simile)" \
    || fail "classify: errore silenzioso o crash inatteso"
fi

# ── 13. CLI: list ─────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[11] kirograph data list${RESET}\n"

LIST_OUT=$($KG data list 2>&1)
echo "$LIST_OUT" | sed 's/^/     /'

for ds in "users" "orders" "products"; do
  echo "$LIST_OUT" | grep -qi "$ds" \
    && ok "data list: '$ds' presente" \
    || fail "data list: '$ds' non trovato nell'output"
done
[ "$XLSX_INSTALLED" = true ] && { echo "$LIST_OUT" | grep -qi "metrics" \
  && ok "data list: 'metrics' (xlsx) presente" \
  || fail "data list: 'metrics' (xlsx) non trovato"; } || true
[ "$PARQUET_INSTALLED" = true ] && { echo "$LIST_OUT" | grep -qi "sensors" \
  && ok "data list: 'sensors' (parquet) presente" \
  || fail "data list: 'sensors' (parquet) non trovato"; } || true
[ "$PDF_INSPECTOR_INSTALLED" = true ] && { echo "$LIST_OUT" | grep -qi "report" \
  && ok "data list: 'report' (pdf) presente" \
  || fail "data list: 'report' (pdf) non trovato"; } || true

# ── 14. CLI: describe ─────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[12] kirograph data describe data-users${RESET}\n"

DESC_OUT=$($KG data describe data-users 2>&1)
echo "$DESC_OUT" | head -20 | sed 's/^/     /'
for col in id name email age role; do
  echo "$DESC_OUT" | grep -qi "$col" \
    && ok "describe: colonna '$col' presente" \
    || fail "describe: colonna '$col' non trovata"
done

# ── 15. CLI: query con filtro ─────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[13] kirograph data query data-users --filter role:eq:admin${RESET}\n"

QUERY_OUT=$($KG data query data-users --filter "role:eq:admin" 2>&1)
echo "$QUERY_OUT" | sed 's/^/     /'

echo "$QUERY_OUT" | grep -qi "Alice" \
  && ok "query: Alice (admin) trovata" \
  || fail "query: Alice (admin) non trovata"
echo "$QUERY_OUT" | grep -qi "Charlie" \
  && ok "query: Charlie (admin) trovato" \
  || fail "query: Charlie (admin) non trovato"
echo "$QUERY_OUT" | grep -qi "Bob" \
  && fail "query: Bob (user) non dovrebbe apparire nel filtro admin" \
  || ok "query: Bob (user) correttamente escluso"

# ── 16. CLI: aggregate ───────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[14] kirograph data aggregate data-orders --group-by region --metric sum:amount${RESET}\n"

AGG_OUT=$($KG data aggregate data-orders --group-by region --metric "sum:amount" 2>&1)
echo "$AGG_OUT" | sed 's/^/     /'

for region in EU US APAC; do
  echo "$AGG_OUT" | grep -qi "$region" \
    && ok "aggregate: regione '$region' presente" \
    || fail "aggregate: regione '$region' non trovata"
done
echo "$AGG_OUT" | grep -qi "380" \
  && ok "aggregate: somma EU ≈ 380.75" \
  || warn "aggregate: somma EU non verificata nell'output (formato diverso?)"

# ── 17. CLI: quality ──────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[15] kirograph data quality data-users${RESET}\n"

QUAL_OUT=$($KG data quality data-users 2>&1)
echo "$QUAL_OUT" | head -15 | sed 's/^/     /'
echo "$QUAL_OUT" | grep -qiE "quality|null|issue|ok|pass|clean" \
  && ok "data quality: output ricevuto" \
  || fail "data quality: output inatteso o vuoto"

# ── 18. CLI: search ───────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[16] kirograph data search data-users email${RESET}\n"

SEARCH_OUT=$($KG data search data-users "email" 2>&1)
echo "$SEARCH_OUT" | sed 's/^/     /'
echo "$SEARCH_OUT" | grep -qi "email" \
  && ok "data search: colonna 'email' trovata" \
  || fail "data search: 'email' non trovata"

# ── 19. CLI: join ─────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[17] kirograph data join data-users data-orders --left-col id --right-col user_id${RESET}\n"

JOIN_OUT=$($KG data join data-users data-orders --left-col id --right-col user_id 2>&1)
echo "$JOIN_OUT" | head -20 | sed 's/^/     /'
echo "$JOIN_OUT" | grep -qi "Alice\|alice" \
  && ok "join: Alice presente" \
  || fail "join: Alice non trovata"
echo "$JOIN_OUT" | grep -qi "ORD-" \
  && ok "join: order_id presente" \
  || fail "join: order_id non trovato"

# ── 20. Code linker ───────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[18] Code linker (data_code_refs)${RESET}\n"
echo -e "  ${DIM}src/app.ts referenzia users.csv, orders.jsonl, products.json, metrics.xlsx, sensors.parquet, report.pdf${RESET}\n"

REFS_TOTAL=$(db "SELECT COUNT(*) FROM data_code_refs;")
[ "${REFS_TOTAL:-0}" -gt 0 ] 2>/dev/null \
  && ok "data_code_refs: ${REFS_TOTAL} riferimenti trovati" \
  || fail "data_code_refs: nessun riferimento creato (linker non funzionante)"

for ds_id in "data-users" "data-orders" "data-products"; do
  REF_CNT=$(db "SELECT COUNT(*) FROM data_code_refs WHERE dataset_id='$ds_id';")
  [ "${REF_CNT:-0}" -ge 1 ] 2>/dev/null \
    && ok "  $ds_id: ${REF_CNT} ref" \
    || fail "  $ds_id: nessuna ref in data_code_refs"
done
[ "$XLSX_INSTALLED" = true ] && {
  REF_CNT=$(db "SELECT COUNT(*) FROM data_code_refs WHERE dataset_id='data-metrics';")
  [ "${REF_CNT:-0}" -ge 1 ] 2>/dev/null \
    && ok "  data-metrics (xlsx): ${REF_CNT} ref" \
    || fail "  data-metrics (xlsx): nessuna ref in data_code_refs"
} || true
[ "$PARQUET_INSTALLED" = true ] && {
  REF_CNT=$(db "SELECT COUNT(*) FROM data_code_refs WHERE dataset_id='data-sensors';")
  [ "${REF_CNT:-0}" -ge 1 ] 2>/dev/null \
    && ok "  data-sensors (parquet): ${REF_CNT} ref" \
    || fail "  data-sensors (parquet): nessuna ref in data_code_refs"
} || true
[ "$PDF_INSPECTOR_INSTALLED" = true ] && {
  REF_CNT=$(db "SELECT COUNT(*) FROM data_code_refs WHERE dataset_id='data-report';")
  [ "${REF_CNT:-0}" -ge 1 ] 2>/dev/null \
    && ok "  data-report (pdf): ${REF_CNT} ref" \
    || fail "  data-report (pdf): nessuna ref in data_code_refs"
} || true

# ── 21. Riepilogo DB ──────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[19] Riepilogo data_datasets${RESET}\n"

sqlite3 "$DB" \
  "SELECT id, format, row_count, column_count, file_size
   FROM data_datasets
   ORDER BY file_path;" 2>/dev/null \
| while IFS='|' read -r id fmt rows cols fsize; do
    printf "     %-32s  %-8s  %4s righe  %2s col  %s bytes\n" \
           "$id" "$fmt" "$rows" "$cols" "$fsize"
  done || warn "Nessun dataset nel DB"

echo ""
echo -e "  ${DIM}data_columns totali:   $(db "SELECT COUNT(*) FROM data_columns;")${RESET}"
echo -e "  ${DIM}data_code_refs totali: $(db "SELECT COUNT(*) FROM data_code_refs;")${RESET}"

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
