/**
 * Searcher — symbol search with 3-tier fallback strategy.
 *
 * Tier 1: exact name match (highest precision, fastest)
 * Tier 2: SQLite FTS5 full-text search
 * Tier 3: LIKE fallback (when FTS5 returns nothing or throws)
 */

import type { GraphDatabase } from '../db/database';
import type { Node, NodeKind, SearchResult, SearchOptions } from '../types';

export class Searcher {
  constructor(private readonly db: GraphDatabase) {}

  search(query: string, kindOrOpts?: NodeKind | SearchOptions, limit = 20): SearchResult[] {
    const opts: SearchOptions = typeof kindOrOpts === 'string'
      ? { kinds: [kindOrOpts as NodeKind], limit }
      : { limit, ...kindOrOpts };

    // Tier 1: exact name match
    const exact = this.db.findNodesByExactName(query, opts.kinds, opts.limit);
    if (exact.length > 0) {
      return exact.map((n: Node) => ({ node: n, score: 1, matchType: 'exact' as const }));
    }

    // Tier 2: FTS5
    let nodes: Node[] = [];
    try {
      nodes = this.db.searchNodes(query, opts);
    } catch {
      // FTS5 parse error (e.g. special chars) — fall through to LIKE
    }

    // Tier 3: LIKE fallback
    if (nodes.length === 0) {
      nodes = this.db.searchNodesByName(query, opts);
    }

    return nodes.map((n: Node) => ({ node: n, score: 1, matchType: 'fuzzy' as const }));
  }
}
