/**
 * KiroGraph Context Builder
 *
 * Implements hybrid search (exact name + semantic + full-text) to assemble
 * relevant code context for a given query.
 * Mirrors CodeGraph src/context/index.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Node, TaskContext } from '../types';
import type { GraphDatabase } from '../db/database';
import type { ReferenceResolver } from '../resolution/index';
import type { VectorManager } from '../vectors/index';
import { logDebug } from '../errors';
import { extractSearchTerms } from '../search/query-utils';
import { validatePathWithinRoot } from '../utils';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Node kinds excluded from context results (low information density). */
const EXCLUDED_NODE_KINDS = new Set<string>(['import', 'export']);

const DEFAULT_MAX_NODES = 20;
const DEFAULT_MAX_CODE_BLOCKS = 5;
const DEFAULT_MAX_CODE_BLOCK_SIZE = 1500;

const NO_RESULTS_MESSAGE = 'No relevant context found for the given query.';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ContextOptions {
  maxNodes?: number;
  maxCodeBlocks?: number;
  maxCodeBlockSize?: number;
  traversalDepth?: number;
}

type Priority = 'exact' | 'semantic' | 'fts';

interface RankedNode {
  node: Node;
  priority: Priority;
}

// ── ContextBuilder ────────────────────────────────────────────────────────────

const FEATURE_REQUEST_WORDS = new Set([
  'add', 'create', 'implement', 'build', 'make', 'new', 'feature', 'support', 'enable', 'allow',
  'introduce', 'generate', 'write', 'develop', 'design', 'extend',
]);

function isFeatureRequest(task: string): boolean {
  const words = task.toLowerCase().split(/\s+/);
  return words.some(w => FEATURE_REQUEST_WORDS.has(w));
}

export class ContextBuilder {
  constructor(
    private readonly db: GraphDatabase,
    private readonly resolver: ReferenceResolver,
    private readonly vectors: VectorManager,
    private readonly projectRoot: string,
  ) {}

  /**
   * Find relevant nodes for the given query using hybrid search.
   *
   * Pipeline:
   * 1. Extract symbol tokens from query
   * 2. Exact name lookup (priority: 'exact')
   * 3. Semantic search via VectorManager (priority: 'semantic')
   * 4. Full-text search fallback (priority: 'fts')
   * 5. Merge and deduplicate by node ID
   * 6. Resolve import nodes to their definitions via 'imports' edge
   * 7. Exclude 'import' and 'export' node kinds
   * 8. Priority-based trimming when exceeding maxNodes
   */
  async findRelevantContext(query: string, opts?: ContextOptions): Promise<Node[]> {
    const maxNodes = opts?.maxNodes ?? DEFAULT_MAX_NODES;

    const tokens = extractSearchTerms(query);
    logDebug('ContextBuilder.findRelevantContext', { query, tokens });

    const ranked: RankedNode[] = [];
    const seen = new Map<string, Priority>();

    // Step 2: Exact name lookup
    for (const token of tokens) {
      const nodes = this.db.findNodesByExactName(token);
      for (const node of nodes) {
        if (!seen.has(node.id)) {
          seen.set(node.id, 'exact');
          ranked.push({ node, priority: 'exact' });
        }
      }
    }

    // Step 3: Semantic search (if vectors enabled)
    if (this.vectors.isInitialized()) {
      const semanticNodes = await this.vectors.search(query, maxNodes);
      for (const node of semanticNodes) {
        if (!seen.has(node.id)) {
          seen.set(node.id, 'semantic');
          ranked.push({ node, priority: 'semantic' });
        }
      }
    }

    // Step 4: Full-text search fallback
    const ftsNodes = this.db.searchNodes(query, { limit: maxNodes });
    for (const node of ftsNodes) {
      if (!seen.has(node.id)) {
        seen.set(node.id, 'fts');
        ranked.push({ node, priority: 'fts' });
      }
    }

    // Step 5: Deduplicated by node ID (already handled via `seen` map above)

    // Step 6: Resolve import nodes to their definitions via 'imports' edge
    const importNodeIds = ranked
      .filter(r => r.node.kind === 'import')
      .map(r => r.node.id);

    if (importNodeIds.length > 0) {
      const edges = this.db.getEdgesForNodes(importNodeIds);
      for (const edge of edges) {
        if (edge.kind === 'imports' && importNodeIds.includes(edge.source)) {
          const targetNode = this.db.getNode(edge.target);
          if (targetNode && !seen.has(targetNode.id)) {
            // Inherit priority from the import node that resolved to this definition
            const importPriority = seen.get(edge.source) ?? 'fts';
            seen.set(targetNode.id, importPriority);
            ranked.push({ node: targetNode, priority: importPriority });
          }
        }
      }
    }

    // Step 7: Exclude 'import' and 'export' node kinds
    const filtered = ranked.filter(r => !EXCLUDED_NODE_KINDS.has(r.node.kind));

    // Step 8: Priority-based trimming
    if (filtered.length <= maxNodes) {
      return filtered.map(r => r.node);
    }

    const exact = filtered.filter(r => r.priority === 'exact');
    const semantic = filtered.filter(r => r.priority === 'semantic');
    const fts = filtered.filter(r => r.priority === 'fts');

    const trimmed: RankedNode[] = [];
    for (const group of [exact, semantic, fts]) {
      for (const item of group) {
        if (trimmed.length >= maxNodes) break;
        trimmed.push(item);
      }
      if (trimmed.length >= maxNodes) break;
    }

    return trimmed.map(r => r.node);
  }

  /**
   * Build a full TaskContext for the given task description.
   * Finds relevant nodes, gathers their edges and source snippets, and returns
   * the structured context used by MCP tools and the query API.
   */
  async buildTaskContext(task: string, opts?: { maxNodes?: number; includeCode?: boolean }): Promise<TaskContext> {
    const maxNodes = opts?.maxNodes ?? DEFAULT_MAX_NODES;
    const nodes = await this.findRelevantContext(task, { maxNodes });

    const entryPoints = nodes.slice(0, Math.ceil(maxNodes / 2));
    const relatedNodes = nodes.slice(Math.ceil(maxNodes / 2));
    const edges = this.db.getEdgesForNodes(nodes.map(n => n.id));

    const codeSnippets = new Map<string, string>();
    if (opts?.includeCode !== false) {
      for (const node of nodes.slice(0, 10)) {
        const src = this._readNodeSource(node);
        if (src) codeSnippets.set(node.id, src);
      }
    }

    const hint = isFeatureRequest(task)
      ? ' (feature request — showing existing patterns and extension points)'
      : '';

    return {
      task, entryPoints, relatedNodes, edges, codeSnippets,
      summary: `Found ${entryPoints.length} entry points and ${relatedNodes.length} related symbols for: "${task}"${hint}`,
    };
  }

  private _readNodeSource(node: Node): string | null {
    const absPath = validatePathWithinRoot(path.join(this.projectRoot, node.filePath), this.projectRoot);
    if (!absPath) return null;
    try {
      return fs.readFileSync(absPath, 'utf8').split('\n').slice(node.startLine - 1, node.endLine).join('\n');
    } catch { return null; }
  }

  /**
   * Build a formatted context string for the given query.
   *
   * Each node is formatted as:
   *   [filePath:line] kind name
   *   ```
   *   {snippet}
   *   ```
   *
   * Returns NO_RESULTS_MESSAGE when no nodes are found.
   */
  async build(query: string, opts?: ContextOptions): Promise<string> {
    const maxCodeBlocks = opts?.maxCodeBlocks ?? DEFAULT_MAX_CODE_BLOCKS;
    const maxCodeBlockSize = opts?.maxCodeBlockSize ?? DEFAULT_MAX_CODE_BLOCK_SIZE;

    const nodes = await this.findRelevantContext(query, opts);

    if (nodes.length === 0) {
      return NO_RESULTS_MESSAGE;
    }

    const parts: string[] = [];
    const limit = Math.min(nodes.length, maxCodeBlocks);

    for (let i = 0; i < limit; i++) {
      const node = nodes[i];
      const snippet = getSnippet(node, maxCodeBlockSize);
      parts.push(`[${node.filePath}:${node.startLine}] ${node.kind} ${node.name}\n\`\`\`\n${snippet}\n\`\`\``);
    }

    return parts.join('\n\n');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Get the best available snippet for a node, truncated to maxSize.
 * Prefers signature > docstring > name.
 */
function getSnippet(node: Node, maxSize: number): string {
  const raw = node.signature ?? node.docstring ?? node.name;
  return raw.length > maxSize ? raw.slice(0, maxSize) : raw;
}
