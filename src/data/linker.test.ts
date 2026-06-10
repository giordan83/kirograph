import { describe, it, expect } from 'vitest';
import { detectDataReferences } from './linker';

const KNOWN_PATHS = new Set([
  'data/report.pdf',
  'docs/manual.pdf',
  'data/users.csv',
]);

describe('detectDataReferences — PDF patterns', () => {
  it('detects readFileSync with .pdf path', () => {
    const src = `const buf = readFileSync('data/report.pdf')`;
    const refs = detectDataReferences(src, KNOWN_PATHS);
    expect(refs.some(r => r.filePath === 'data/report.pdf' && r.refType === 'reads')).toBe(true);
  });

  it('detects createReadStream with .pdf path', () => {
    const src = `fs.createReadStream('data/report.pdf')`;
    const refs = detectDataReferences(src, KNOWN_PATHS);
    expect(refs.some(r => r.filePath === 'data/report.pdf')).toBe(true);
  });

  it('detects Python open() with .pdf extension', () => {
    const src = `f = open('docs/manual.pdf', 'rb')`;
    const refs = detectDataReferences(src, KNOWN_PATHS);
    expect(refs.some(r => r.filePath === 'docs/manual.pdf')).toBe(true);
  });

  it('detects PdfReader() call', () => {
    const src = `reader = PdfReader('data/report.pdf')`;
    const refs = detectDataReferences(src, KNOWN_PATHS);
    expect(refs.some(r => r.filePath === 'data/report.pdf')).toBe(true);
  });

  it('detects pdfplumber.open() call', () => {
    const src = `with pdfplumber.open('data/report.pdf') as pdf:`;
    const refs = detectDataReferences(src, KNOWN_PATHS);
    expect(refs.some(r => r.filePath === 'data/report.pdf')).toBe(true);
  });

  it('detects fitz.open() call', () => {
    const src = `doc = fitz.open('docs/manual.pdf')`;
    const refs = detectDataReferences(src, KNOWN_PATHS);
    expect(refs.some(r => r.filePath === 'docs/manual.pdf')).toBe(true);
  });

  it('detects generic string literal with .pdf extension', () => {
    const src = `const path = 'data/report.pdf';`;
    const refs = detectDataReferences(src, KNOWN_PATHS);
    expect(refs.some(r => r.filePath === 'data/report.pdf')).toBe(true);
  });

  it('gives confidence 1.0 for known paths, lower for unknown', () => {
    const src = `readFileSync('data/report.pdf'); readFileSync('other/unknown.pdf')`;
    const refs = detectDataReferences(src, KNOWN_PATHS);
    const known = refs.find(r => r.filePath === 'data/report.pdf');
    const unknown = refs.find(r => r.filePath === 'other/unknown.pdf');
    expect(known?.confidence).toBe(1.0);
    expect(unknown?.confidence).toBeLessThan(1.0);
  });

  it('does not confuse .pdf with .csv patterns', () => {
    const src = `readFileSync('data/users.csv')`;
    const refs = detectDataReferences(src, KNOWN_PATHS);
    expect(refs.some(r => r.filePath === 'data/users.csv')).toBe(true);
    expect(refs.some(r => r.filePath?.endsWith('.pdf'))).toBe(false);
  });
});
