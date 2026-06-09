# Plan: PDF support for the `data` module

**Branch:** `feature/firecrawl`  
**Library:** `@firecrawl/pdf-inspector` (Rust/NAPI, no OCR, no network)  
**Prebuilt binaries:** linux-x64, macOS ARM64 — no Rust toolchain needed at install time

---

## Goal

Add `.pdf` as a supported format in the `data` module, following the same optional-dependency pattern used by `xlsx` and `parquetjs-lite`. Text-based PDFs are indexed locally in under 200ms. Scanned/image-only PDFs are flagged in lint output and skipped gracefully.

---

## Row representation

PDFs are not tabular. Each **page** becomes one row:

| column | SQLite type | source |
|---|---|---|
| `page` | INTEGER | 0-indexed page number from `extractPagesMarkdown` |
| `content` | TEXT | Markdown string for that page |
| `needs_ocr` | TEXT (`"true"` / `"false"`) | Whether pdf-inspector flagged the page as unreliable |
| `has_tables` | TEXT (`"true"` / `"false"`) | Derived from `pagesWithTables` in the result |
| `has_columns` | TEXT (`"true"` / `"false"`) | Derived from `pagesWithColumns` in the result |

Columns are registered in `data_columns` and rows in the dynamic `data_rows_{datasetId}` table, exactly like every other format.

Pages where `needs_ocr = true` are **included** in the index (with their `content` being whatever text was extractable) but flagged so users can see them via `kirograph data quality`.

**Mixed PDFs** (`pdfType = "Mixed"`) are handled the same way: text pages index normally, scanned pages get `needs_ocr = true`. The quality report should display the split (e.g. "38 / 42 pages text-based, 4 need OCR") rather than treating the whole document as unsupported.

---

## Steps

### 1. Add optional dependency

```json
// package.json — optionalDependencies (alongside @ast-grep/napi, better-sqlite3, etc.)
"@firecrawl/pdf-inspector": "^1.9.5"
```

Do **not** add it to `dependencies` — it ships a native `.node` binary and should degrade gracefully on unsupported platforms.

---

### 2. Create `src/data/parsers/pdf.ts`

Pattern: copy the lazy-load structure from `excel.ts` / `parquet.ts`.

```typescript
// lazy load, cached after first call
let pdfModule: any = null;
let pdfChecked = false;

function tryLoadPdfInspector(): boolean { ... }  // try require('@firecrawl/pdf-inspector')

export const pdfParser: DataFormatParser = {
  name: 'pdf',
  extensions: ['.pdf'],
  isAvailable: () => tryLoadPdfInspector(),
  async parse(filePath, opts) {
    const { extractPagesMarkdown } = pdfModule;
    const buffer = readFileSync(filePath);
    const result = extractPagesMarkdown(buffer);  // returns PagesExtractionResult

    // Build column schema once
    const columns = ['page', 'content', 'needs_ocr', 'has_tables', 'has_columns'];

    // Emit rows in batches of BATCH_SIZE (10_000 — will never be hit for PDFs,
    // but consistent with the rest of the module)
    const batch: ParsedRow[] = [];
    for (const p of result.pages) {
      batch.push({
        page: String(p.page),
        content: p.markdown,
        needs_ocr: String(p.needsOcr),
        has_tables: String(result.pagesWithTables.includes(p.page)),
        has_columns: String(result.pagesWithColumns.includes(p.page)),
      });
    }
    if (batch.length) await opts.onBatch(batch, columns);
  },
};
```

Key notes:
- Use `extractPagesMarkdown(buffer)` (not `processPdf`) — gives per-page markdown + OCR flags in one call.
- Also call `processPdf(buffer, /* detect-only mode via detectPdf */ )` once to capture document-level metadata (see step 2b).
- `readFileSync` is fine; PDFs are fully buffered by the library anyway.
- `columns` array is passed on the first (and only) `onBatch` call since pages are known upfront.
- For `data_columns.summary` on the `content` column, write a truncated preview (≤ 500 chars from page 0) so `kirograph data describe` shows something useful rather than a blank.

---

### 2b. Add `metadata_json` column to `data_datasets` (`src/db/data-schema.sql`)

Dataset-level PDF metadata (`pdfType`, `confidence`, `title`, `hasEncodingIssues`, `isComplexLayout`) is returned by `processPdf` / `detectPdf` but has nowhere to live today. Add a nullable `metadata_json TEXT` column to `data_datasets`:

```sql
ALTER TABLE data_datasets ADD COLUMN metadata_json TEXT;
```

The indexer writes it as a JSON blob for PDF datasets; all other formats leave it `NULL`. `kirograph data describe` prints it as a "PDF info" section when present:

```
PDF info:  TextBased | confidence 0.94 | complex layout | encoding OK
```

This is the only schema migration in this feature. It is additive (nullable column) so no data migration is needed.

---

### 3. Register in `src/data/parsers/index.ts`

Import `pdfParser` and push it into the registry. No other changes needed — `getAvailableExtensions()` / `getUnavailableExtensions()` and `lint` already handle optional parsers automatically.

---

### 4. Add `**/*.pdf` to default glob in `src/data/indexer.ts`

```typescript
// dataInclude default
const DEFAULT_INCLUDE = ['**/*.csv', '**/*.tsv', '**/*.jsonl', '**/*.ndjson',
                         'data/**/*.json', '**/*.pdf'];
```

The existing `dataMaxFileSize` guard (50 MB default) applies — large scanned PDFs won't be loaded.

---

### 5. Extend `src/data/linker.ts`

Add detection patterns for PDF references alongside existing CSV/Parquet patterns:

```typescript
// Node.js
/readFileSync\(['"`]([^'"`]+\.pdf)['"`]\)/,
/createReadStream\(['"`]([^'"`]+\.pdf)['"`]\)/,
// Python
/open\(['"`]([^'"`]+\.pdf)['"`]\)/,
/PdfReader\(['"`]([^'"`]+\.pdf)['"`]\)/,
/pdfplumber\.open\(['"`]([^'"`]+\.pdf)['"`]\)/,
/fitz\.open\(['"`]([^'"`]+\.pdf)['"`]\)/,
```

Confidence: 0.8 for all (same tier as the existing generic `open()` patterns).

---

### 6. Add `kirograph data classify <file>` subcommand

Thin wrapper over `classifyPdf(buffer)` — useful before indexing to check if a PDF has a text layer.

```
$ kirograph data classify report.pdf
Type:       TextBased
Confidence: 0.94
Pages:      42
OCR needed: none
```

With `--json`:
```json
{ "pdfType": "TextBased", "pageCount": 42, "pagesNeedingOcr": [], "confidence": 0.94 }
```

File: `src/bin/commands/data.ts` — add one more `program.command('classify <file>')` block.

---

### 7. Update `src/data/lint.ts`

No changes needed. The existing lint check already emits `missing_dep` warnings when `isAvailable()` returns false, and `stale_file` warnings when content changes. The one addition: surface `needs_ocr` page count in the quality report.

In `src/data/queries.ts` → `quality()`: add a check that counts rows where `needs_ocr = 'true'` and reports them as a quality risk (same pattern as null-% thresholds today). Also surface `hasEncodingIssues` from `metadata_json` as a warning ("text extraction may be garbled — consider OCR pre-processing").

---

### 8. Context verbosity note (config docs)

PDF `content` columns are far larger than CSV cells. Update the config documentation to recommend `dataContextLimit: 1` (or 0) when PDF datasets are present, and add a comment in the default config template. No code change — this is a docs-only update in `help/` or `README.md`.

---

### 9. Tests

- `src/data/parsers/pdf.test.ts`:
  - Mock `@firecrawl/pdf-inspector` unavailable → `isAvailable()` returns false, `parse()` never called
  - Happy path: fixture text PDF → correct row count, columns present, `needs_ocr` values correct, `metadata_json` written
  - Mixed PDF (some pages `needsOcr: true`) → text pages indexed, scanned pages flagged, quality report shows split count
  - `hasEncodingIssues: true` → quality report emits encoding warning
- `src/data/linker.test.ts`: add PDF path patterns to existing linker fixture tests
- `src/db/data-schema.sql` migration test: existing DB without `metadata_json` column upgrades cleanly

---

## What's out of scope

- **OCR** — scanned pages are indexed as-is (empty `content` + `needs_ocr: true`). A follow-up could shell out to Tesseract or a cloud OCR API for those pages.
- **Structured table extraction** — tables inside PDFs land as markdown in `content`. A follow-up could parse markdown tables into a separate child dataset.
- **macOS x64 / Windows / Linux ARM** — `@firecrawl/pdf-inspector` ships prebuilts for linux-x64 and macOS ARM64 only. Other platforms fall through to `isAvailable() = false` and PDFs are skipped with a lint warning.
- **Streaming large PDFs** — the library buffers the whole file; the existing `dataMaxFileSize` guard is the mitigation.

---

## Documentation updates

### `CHANGELOG.md`

Add a new entry above `[0.21.0]`. Follow the existing format exactly (one-liner summary in the heading, bullet list of added items):

```markdown
## [0.22.0] - YYYY-MM-DD: PDF support for the data module

### Added

- **PDF indexing** (`enableData: true`): `.pdf` files are now indexed by the data module via
  [`@firecrawl/pdf-inspector`](https://github.com/firecrawl/pdf-inspector) (optional dep, pure Rust,
  no OCR, no network). Each page becomes one row with columns `page`, `content`, `needs_ocr`,
  `has_tables`, `has_columns`. Text-based PDFs process in under 200ms locally.
- **Mixed/scanned PDF handling**: text pages index normally; scanned pages are flagged with
  `needs_ocr = true` and surfaced in `kirograph data quality`.
- **Encoding issue detection**: `kirograph data quality` warns when `hasEncodingIssues` is set on
  a PDF dataset (garbled font encodings that may require OCR pre-processing).
- **`kirograph data classify <file>`**: new subcommand — fast (~10–50ms) PDF classification without
  full indexing. Reports type (`TextBased`/`Scanned`/`Mixed`/`ImageBased`), confidence, page count,
  and which pages need OCR. Supports `--json`.
- **PDF code-reference detection**: `kirograph data lint` / linker now detects `readFileSync`,
  `createReadStream`, `open`, `pdfplumber.open`, `fitz.open`, and `PdfReader` calls referencing
  `.pdf` paths.
- **`metadata_json` column on `data_datasets`**: stores PDF-specific metadata (type, confidence,
  title, encoding issues, complex layout) surfaced in `kirograph data describe`.
- **Platform support**: prebuilt binaries for linux-x64 and macOS ARM64. Other platforms degrade
  gracefully (`isAvailable() = false`, PDFs skipped with a lint warning).
- **Optional dep**: `npm install --save-optional @firecrawl/pdf-inspector`.
```

---

### `README.md`

Two places to update:

1. **Data module attribution line** (currently mentions CSV/TSV/JSONL/JSON/Excel/Parquet) — add PDF:
   > "…indexes tabular data files (CSV, TSV, JSONL, JSON, Excel, Parquet, **PDF**)"

2. **Format table** (line ~166, "Data | jDataMunch-MCP | …") — add a note that PDF is now supported alongside structured formats.

---

### `docs/guide/how-it-works.md`

Line ~144 currently reads:
> "KiroGraph indexes tabular data files (CSV, TSV, JSONL, JSON, Excel, Parquet)…"
> "Optional format deps: CSV/TSV/JSONL/JSON are built-in (zero deps). Excel requires `xlsx`, Parquet requires `parquetjs-lite`"

Update to:
> "KiroGraph indexes tabular data files and documents (CSV, TSV, JSONL, JSON, Excel, Parquet, **PDF**)…"
> "Optional format deps: … PDF requires `@firecrawl/pdf-inspector` (prebuilt Rust binary, linux-x64 and macOS ARM64). PDFs are page-indexed: each page becomes a row with `content` (markdown), `needs_ocr`, `has_tables`, and `has_columns` columns. Scanned pages are flagged rather than skipped."

---

### `docs/guide/configuration.md`

Three updates:

1. **`dataInclude` row** (line ~64): change the default value from `["**/*.csv", ...]` to `["**/*.csv", "**/*.tsv", "**/*.jsonl", "**/*.ndjson", "data/**/*.json", "**/*.pdf"]`.

2. **`dataContextLimit` row** (line ~67): add a note in the description column — "For PDF datasets, keep this at 0–1; PDF `content` columns are verbose and will inflate context significantly."

3. **New row** after `dataMaxRows` for `metadata_json` (informational, not a user-configurable field — note it as a read-only dataset attribute visible in `kirograph data describe`).

---

### `docs/guide/cli.md`

Add `kirograph data classify` to the data commands section (currently ends around line ~425). Follow the same format as the existing data command blocks:

```markdown
# Classify a PDF before indexing (fast, no full parse)
kirograph data classify report.pdf
kirograph data classify report.pdf --json
```

Also update the data command intro sentence to mention PDF alongside CSV/Excel/Parquet.

---

**Code**

| file | action |
|---|---|
| `package.json` | add `@firecrawl/pdf-inspector` to `optionalDependencies` |
| `src/db/data-schema.sql` | add `metadata_json TEXT` column to `data_datasets` |
| `src/data/parsers/pdf.ts` | **create** |
| `src/data/parsers/index.ts` | import + register `pdfParser` |
| `src/data/indexer.ts` | add `**/*.pdf` to default `dataInclude` glob; write `metadata_json` on index |
| `src/data/linker.ts` | add PDF reference patterns |
| `src/data/queries.ts` | surface `needs_ocr` count + encoding warning in `quality()`; show `metadata_json` in `describe()` |
| `src/bin/commands/data.ts` | add `classify` subcommand |
| `src/data/parsers/pdf.test.ts` | **create** |
| `src/data/linker.test.ts` | extend with PDF patterns |

**Docs**

| file | action |
|---|---|
| `CHANGELOG.md` | add `[0.22.0]` entry |
| `README.md` | add PDF to format list and data table row |
| `docs/guide/how-it-works.md` | update data layer description + optional deps list |
| `docs/guide/configuration.md` | update `dataInclude` default, add PDF note to `dataContextLimit`, add `metadata_json` info row |
| `docs/guide/cli.md` | add `kirograph data classify` command block + update data section intro |
