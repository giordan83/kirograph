/**
 * KiroGraph Memory — Symbol detector
 *
 * Scans observation text for identifiers that match indexed symbols.
 * Returns qualified_name for stable linking across reindex.
 * No LLM involved — pure SQL lookup.
 */

import { extractIdentifiers } from './compress';

export interface DetectedSymbol {
  qualifiedName: string;
  name: string;
}

/**
 * Detect symbols in text that exist in the code graph.
 * Extracts candidate identifiers and batch-looks them up in the nodes table.
 *
 * @param text - The observation text (compressed or raw)
 * @param db - The GraphDatabase handle (raw sqlite)
 * @returns Array of matched symbols with their qualified names
 */
export function detectSymbols(text: string, db: any): DetectedSymbol[] {
  const candidates = extractIdentifiers(text);
  if (candidates.length === 0) return [];

  // Deduplicate candidates
  const unique = [...new Set(candidates)];

  // Batch lookup: find nodes whose name matches any candidate
  // Use a single query with IN clause for efficiency
  const placeholders = unique.map(() => '?').join(',');
  const rows = db.all(
    `SELECT DISTINCT name, qualified_name FROM nodes
     WHERE name IN (${placeholders})
     AND kind IN ('function', 'method', 'class', 'interface', 'type_alias', 'component', 'variable')
     ORDER BY is_exported DESC, name`,
    unique
  );

  // Deduplicate by name (prefer exported, first match)
  const seen = new Set<string>();
  const results: DetectedSymbol[] = [];

  for (const row of rows) {
    if (!seen.has(row.name)) {
      seen.add(row.name);
      results.push({
        qualifiedName: row.qualified_name,
        name: row.name,
      });
    }
  }

  return results;
}
