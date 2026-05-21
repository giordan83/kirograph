/**
 * KiroGraph Memory — Deterministic observation compressor
 *
 * Applies caveman grammar rules programmatically. No LLM involved.
 * Only runs when cavemanMode is not 'off'. Uses the same level the user chose.
 */

import type { CompressResult } from './types';

export type CavemanMode = 'off' | 'lite' | 'full' | 'ultra';

// ── Patterns to preserve (never compress) ────────────────────────────────────

/** Matches code blocks (``` ... ```) */
const CODE_BLOCK_RE = /```[\s\S]*?```/g;

/** Matches inline code (`...`) */
const INLINE_CODE_RE = /`[^`]+`/g;

/** Matches file paths (containing / or \ with extensions) */
const FILE_PATH_RE = /(?:\.?\.?\/)?[\w\-./\\]+\.\w{1,10}/g;

/** Matches URLs */
const URL_RE = /https?:\/\/[^\s)]+/g;

/** Matches version numbers (v1.2.3, 1.2.3) */
const VERSION_RE = /\bv?\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?\b/g;

/** Matches identifiers: camelCase, PascalCase, snake_case, SCREAMING_SNAKE */
const IDENTIFIER_RE = /\b(?:[A-Z][a-z]+(?:[A-Z][a-z]+)+|[a-z]+(?:[A-Z][a-z]+)+|[a-z]+(?:_[a-z]+)+|[A-Z]+(?:_[A-Z]+)+)\b/g;

// ── Filler / article / hedging patterns ──────────────────────────────────────

const FILLER_WORDS = /\b(just|really|basically|simply|actually|very|quite|rather|somewhat|perhaps|maybe)\b/gi;

const ARTICLES = /\b(a|an|the)\b/gi;

const HEDGING_PHRASES = [
  /\bI think\b/gi,
  /\bit seems (like |that )?/gi,
  /\byou might want to\b/gi,
  /\byou may want to\b/gi,
  /\bit looks like\b/gi,
  /\bprobably\b/gi,
  /\bI believe\b/gi,
  /\bin my opinion\b/gi,
];

const PLEASANTRIES = [
  /\b(please|thanks|thank you|sorry|excuse me)\b/gi,
  /^(hi|hello|hey|sure|okay|ok|great|nice|cool|awesome|perfect),?\s*/gim,
];

// ── Abbreviations (ultra only) ───────────────────────────────────────────────

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bdatabase\b/gi, 'DB'],
  [/\bauthentication\b/gi, 'auth'],
  [/\bauthenticate\b/gi, 'auth'],
  [/\brequest\b/gi, 'req'],
  [/\bresponse\b/gi, 'res'],
  [/\bfunction\b/gi, 'fn'],
  [/\bconfiguration\b/gi, 'cfg'],
  [/\bconfigure\b/gi, 'cfg'],
  [/\bmessage\b/gi, 'msg'],
  [/\berror\b/gi, 'err'],
  [/\bimplementation\b/gi, 'impl'],
  [/\bimplement\b/gi, 'impl'],
  [/\bdependency\b/gi, 'dep'],
  [/\bdependencies\b/gi, 'deps'],
  [/\brepository\b/gi, 'repo'],
  [/\benvironment\b/gi, 'env'],
  [/\bapplication\b/gi, 'app'],
  [/\bmiddleware\b/gi, 'mw'],
  [/\bparameter\b/gi, 'param'],
  [/\bparameters\b/gi, 'params'],
];

// ── Core compressor ──────────────────────────────────────────────────────────

/**
 * Compress observation text using caveman grammar rules.
 * Returns the text unchanged if mode is 'off'.
 */
export function compressObservation(text: string, mode: CavemanMode): CompressResult {
  const originalLength = text.length;

  if (mode === 'off') {
    return {
      compressed: text,
      originalLength,
      compressedLength: text.length,
      detectedSymbols: extractIdentifiers(text),
    };
  }

  // Extract preserved tokens (code blocks, paths, URLs, versions, identifiers)
  const preserved = new Map<string, string>();
  let processed = text;
  let placeholderIdx = 0;

  function preserve(re: RegExp): void {
    processed = processed.replace(re, (match) => {
      const key = `\x00P${placeholderIdx++}\x00`;
      preserved.set(key, match);
      return key;
    });
  }

  // Order matters: code blocks first (they may contain other patterns)
  preserve(CODE_BLOCK_RE);
  preserve(INLINE_CODE_RE);
  preserve(URL_RE);
  preserve(FILE_PATH_RE);
  preserve(VERSION_RE);
  preserve(IDENTIFIER_RE);

  // Apply compression rules based on mode
  if (mode === 'lite' || mode === 'full' || mode === 'ultra') {
    // All modes: drop filler words
    processed = processed.replace(FILLER_WORDS, '');

    // All modes: drop pleasantries
    for (const re of PLEASANTRIES) {
      processed = processed.replace(re, '');
    }
  }

  if (mode === 'full' || mode === 'ultra') {
    // Drop articles
    processed = processed.replace(ARTICLES, '');

    // Drop hedging phrases
    for (const re of HEDGING_PHRASES) {
      processed = processed.replace(re, '');
    }
  }

  if (mode === 'ultra') {
    // Apply abbreviations
    for (const [re, replacement] of ABBREVIATIONS) {
      processed = processed.replace(re, replacement);
    }

    // Replace "because" / "so" / "therefore" with →
    processed = processed.replace(/\b(because|so|therefore|thus|hence)\b/gi, '→');

    // Replace "and" with +
    processed = processed.replace(/\band\b/gi, '+');
  }

  // Clean up multiple spaces and leading/trailing whitespace per line
  processed = processed
    .split('\n')
    .map(line => line.replace(/\s{2,}/g, ' ').trim())
    .filter(line => line.length > 0)
    .join('\n');

  // Restore preserved tokens
  for (const [key, value] of preserved) {
    processed = processed.replace(key, value);
  }

  return {
    compressed: processed,
    originalLength,
    compressedLength: processed.length,
    detectedSymbols: extractIdentifiers(text),
  };
}

/**
 * Extract candidate identifiers from text (camelCase, PascalCase, snake_case).
 * Used for symbol detection.
 */
export function extractIdentifiers(text: string): string[] {
  const matches = new Set<string>();

  // camelCase and PascalCase
  const camelPascal = text.match(/\b[A-Z]?[a-z]+(?:[A-Z][a-z]+)+\b/g);
  if (camelPascal) camelPascal.forEach(m => matches.add(m));

  // PascalCase (starting with uppercase)
  const pascal = text.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g);
  if (pascal) pascal.forEach(m => matches.add(m));

  // snake_case (at least one underscore, all lowercase)
  const snake = text.match(/\b[a-z]+(?:_[a-z]+)+\b/g);
  if (snake) snake.forEach(m => matches.add(m));

  // SCREAMING_SNAKE_CASE
  const screaming = text.match(/\b[A-Z]+(?:_[A-Z]+)+\b/g);
  if (screaming) screaming.forEach(m => matches.add(m));

  return [...matches];
}
