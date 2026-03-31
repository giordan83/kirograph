import type { NodeKind } from '../types';

// ── Stop Words ────────────────────────────────────────────────────────────────

/** Common English words that carry no search signal. */
export const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'have', 'been', 'will',
  'would', 'could', 'should', 'does', 'done', 'make', 'made', 'use', 'used',
  'using', 'work', 'works', 'find', 'found', 'show', 'call', 'called', 'get',
  'set', 'add', 'all', 'any', 'how', 'what', 'when', 'where', 'which', 'who',
  'why', 'fix', 'bug', 'code', 'file', 'files', 'function', 'method', 'class',
  'type', 'build', 'run', 'test', 'a', 'an', 'in', 'of', 'to', 'is', 'it',
  'by', 'on', 'at', 'as', 'or', 'be', 'do', 'if', 'no', 'so', 'up', 'not',
  'but', 'are', 'was', 'has', 'had', 'its', 'can', 'may', 'also', 'into',
  'then', 'than', 'just', 'more', 'some', 'such', 'each', 'over', 'only',
  'new', 'out', 'two', 'way', 'see', 'him', 'his', 'her', 'she', 'they',
  'them', 'their', 'our', 'your', 'you', 'we', 'me', 'my', 'him', 'his',
]);

// ── extractSearchTerms ────────────────────────────────────────────────────────

/**
 * Tokenises a natural-language query.
 * Splits camelCase, PascalCase, snake_case, SCREAMING_SNAKE, and dot.notation.
 * Lowercases all tokens, removes stop words, removes tokens shorter than 3 chars.
 */
export function extractSearchTerms(query: string): string[] {
  const tokens = new Set<string>();

  // Split camelCase / PascalCase into component words
  // e.g. "getUserName" → ["get", "User", "Name"] → ["get", "user", "name"]
  const camelSplit = query.replace(/([a-z])([A-Z])/g, '$1 $2')
                          .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  // Replace underscores and dots with spaces (handles snake_case, SCREAMING_SNAKE, dot.notation)
  const normalised = camelSplit.replace(/[_\.]+/g, ' ');

  // Split on any non-alphanumeric character
  const words = normalised.split(/[^a-zA-Z0-9]+/).filter(Boolean);

  for (const word of words) {
    const lower = word.toLowerCase();
    if (lower.length < 3) continue;
    if (STOP_WORDS.has(lower)) continue;
    tokens.add(lower);
  }

  return [...tokens];
}

// ── scorePathRelevance ────────────────────────────────────────────────────────

/**
 * Numeric relevance score for a file path against a query string.
 * +10 if filename (no extension) matches a query token exactly.
 * +5  if a directory segment matches a query token exactly.
 * +3  if any path segment contains a query token as a substring.
 */
export function scorePathRelevance(filePath: string, query: string): number {
  const queryTerms = extractSearchTerms(query);
  if (queryTerms.length === 0) return 0;

  // Normalise separators and split into segments
  const normalised = filePath.replace(/\\/g, '/');
  const segments = normalised.split('/').filter(Boolean);
  if (segments.length === 0) return 0;

  const lastSegment = segments[segments.length - 1];
  const dotIdx = lastSegment.lastIndexOf('.');
  const filename = dotIdx > 0 ? lastSegment.slice(0, dotIdx) : lastSegment;
  const dirSegments = segments.slice(0, -1);

  let score = 0;

  for (const term of queryTerms) {
    const filenameLower = filename.toLowerCase();
    const termLower = term.toLowerCase();

    if (filenameLower === termLower) {
      // +10: filename exactly matches
      score += 10;
    } else if (dirSegments.some(s => s.toLowerCase() === termLower)) {
      // +5: a directory segment exactly matches
      score += 5;
    } else if (segments.some(s => s.toLowerCase().includes(termLower))) {
      // +3: any segment contains the term as a substring
      score += 3;
    }
  }

  return score;
}

// ── kindBonus ─────────────────────────────────────────────────────────────────

/**
 * Numeric relevance bonus by node kind.
 */
export function kindBonus(kind: NodeKind): number {
  switch (kind) {
    case 'function':
    case 'method':
      return 10;
    case 'route':
      return 9;
    case 'class':
    case 'component':
      return 8;
    case 'interface':
      return 7;
    case 'type_alias':
    case 'struct':
    case 'trait':
      return 6;
    case 'enum':
      return 5;
    case 'module':
    case 'namespace':
      return 4;
    case 'property':
    case 'field':
    case 'constant':
      return 3;
    case 'variable':
      return 2;
    case 'import':
    case 'export':
      return 1;
    case 'parameter':
    case 'file':
      return 0;
    default:
      return 0;
  }
}
