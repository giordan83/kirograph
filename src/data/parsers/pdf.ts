/**
 * PDF Parser (Optional Dependency)
 *
 * Handles: .pdf
 * Requires: @firecrawl/pdf-inspector (optional dependency, Rust/NAPI)
 * Gracefully returns isAvailable()=false if not installed or unsupported platform.
 *
 * Each page becomes one row: page, content, needs_ocr, has_tables, has_columns.
 * Text-based PDFs process in under 200ms locally.
 * Scanned/mixed pages get needs_ocr='true' and are included (not skipped).
 */

import { readFileSync } from 'fs';
import type { DataFormatParser, ParsedRow } from '../types';

let pdfModule: any = null;
let pdfChecked = false;

function tryLoadPdfInspector(): boolean {
  if (pdfChecked) return pdfModule !== null;
  pdfChecked = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    pdfModule = require('@firecrawl/pdf-inspector');
    return true;
  } catch {
    return false;
  }
}

/** Testing hook — allows injecting a mock module without module system tricks. */
export function _setPdfInspectorForTesting(mod: any): void {
  pdfModule = mod;
  pdfChecked = true;
}

export function _resetPdfInspectorForTesting(): void {
  pdfModule = null;
  pdfChecked = false;
}

export const pdfParser: DataFormatParser = {
  name: 'pdf',
  extensions: ['.pdf'],

  isAvailable(): boolean {
    return tryLoadPdfInspector();
  },

  async parse(filePath, opts) {
    if (!tryLoadPdfInspector()) {
      return { columns: [], totalRows: 0 };
    }

    const { extractPagesMarkdown, processPdf } = pdfModule;
    const buffer = readFileSync(filePath);

    // Per-page content + OCR flags
    const result = extractPagesMarkdown(buffer);

    // Document-level metadata (non-critical)
    let metadataJson: string | null = null;
    try {
      const meta = processPdf(buffer);
      metadataJson = JSON.stringify({
        pdfType: meta.pdfType ?? null,
        confidence: meta.confidence ?? null,
        title: meta.title ?? null,
        hasEncodingIssues: meta.hasEncodingIssues ?? false,
        isComplexLayout: meta.isComplexLayout ?? false,
      });
    } catch {
      // non-critical — index proceeds without metadata
    }

    const columns = ['page', 'content', 'needs_ocr', 'has_tables', 'has_columns'];
    const batch: ParsedRow[] = [];

    for (const p of result.pages) {
      batch.push({
        page: String(p.page),
        content: p.markdown ?? '',
        needs_ocr: String(p.needsOcr ?? false),
        has_tables: String(result.pagesWithTables?.includes(p.page) ?? false),
        has_columns: String(result.pagesWithColumns?.includes(p.page) ?? false),
      });
    }

    if (batch.length > 0) {
      opts.onBatch(batch, columns);
    }

    return { columns, totalRows: batch.length, metadataJson };
  },
};
