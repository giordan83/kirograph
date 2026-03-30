/**
 * KiroGraph Database Layer
 * Wraps node-sqlite3-wasm for portability (no native bindings needed).
 */

import * as path from 'path';
import * as fs from 'fs';
import type { Node, Edge, FileRecord, NodeKind, Language } from '../types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Database } = require('node-sqlite3-wasm');

export class GraphDatabase {
  private db: any;
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    const dbDir = path.join(projectRoot, '.kirograph');
    fs.mkdirSync(dbDir, { recursive: true });
    const dbPath = path.join(dbDir, 'kirograph.db');
    this.db = new Database(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.applySchema();
  }

  private applySchema(): void {
    const schemaPath = path.join(__dirname, '../db/schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    this.db.exec(sql);
    // Migrate: add line/column to unresolved_refs if missing (existing databases)
    try {
      this.db.exec('ALTER TABLE unresolved_refs ADD COLUMN line INTEGER');
    } catch { /* column already exists */ }
    try {
      this.db.exec('ALTER TABLE unresolved_refs ADD COLUMN column INTEGER');
    } catch { /* column already exists */ }
  }

  // ── Files ──────────────────────────────────────────────────────────────────

  upsertFile(record: FileRecord): void {
    this.db.run(
      `INSERT OR REPLACE INTO files (path, content_hash, language, file_size, symbol_count, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [record.path, record.contentHash, record.language, record.fileSize, record.symbolCount, record.indexedAt]
    );
  }

  getFile(filePath: string): FileRecord | null {
    const row = this.db.get('SELECT * FROM files WHERE path = ?', [filePath]);
    return row ? this.rowToFile(row) : null;
  }

  getAllFiles(): FileRecord[] {
    return this.db.all('SELECT * FROM files').map(this.rowToFile);
  }

  deleteFile(filePath: string): void {
    // Cascade deletes nodes (and their edges via FK)
    this.db.run('DELETE FROM nodes WHERE file_path = ?', [filePath]);
    this.db.run('DELETE FROM files WHERE path = ?', [filePath]);
  }

  private rowToFile(row: any): FileRecord {
    return {
      path: row.path,
      contentHash: row.content_hash,
      language: row.language as Language,
      fileSize: row.file_size,
      symbolCount: row.symbol_count,
      indexedAt: row.indexed_at,
    };
  }

  // ── Nodes ──────────────────────────────────────────────────────────────────

  upsertNode(node: Node): void {
    this.db.run(
      `INSERT OR REPLACE INTO nodes
        (id, kind, name, qualified_name, file_path, language,
         start_line, end_line, start_column, end_column,
         docstring, signature, visibility,
         is_exported, is_async, is_static, is_abstract,
         decorators, type_parameters, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        node.id, node.kind, node.name, node.qualifiedName, node.filePath, node.language,
        node.startLine, node.endLine, node.startColumn, node.endColumn,
        node.docstring ?? null, node.signature ?? null, node.visibility ?? null,
        node.isExported ? 1 : 0, node.isAsync ? 1 : 0,
        node.isStatic ? 1 : 0, node.isAbstract ? 1 : 0,
        node.decorators ? JSON.stringify(node.decorators) : null,
        node.typeParameters ? JSON.stringify(node.typeParameters) : null,
        node.updatedAt,
      ]
    );
    // Keep FTS in sync
    this.db.run(
      `INSERT OR REPLACE INTO nodes_fts (id, name, qualified_name, docstring, signature)
       VALUES (?, ?, ?, ?, ?)`,
      [node.id, node.name, node.qualifiedName, node.docstring ?? '', node.signature ?? '']
    );
  }

  getNode(id: string): Node | null {
    const row = this.db.get('SELECT * FROM nodes WHERE id = ?', [id]);
    return row ? this.rowToNode(row) : null;
  }

  getNodesByFile(filePath: string): Node[] {
    return this.db.all('SELECT * FROM nodes WHERE file_path = ?', [filePath]).map(this.rowToNode);
  }

  findNodesByExactName(name: string, kind?: NodeKind, limit = 20): Node[] {
    if (kind) {
      return this.db.all(
        'SELECT * FROM nodes WHERE name = ? AND kind = ? LIMIT ?',
        [name, kind, limit]
      ).map(this.rowToNode);
    }
    return this.db.all(
      'SELECT * FROM nodes WHERE name = ? LIMIT ?',
      [name, limit]
    ).map(this.rowToNode);
  }

  searchNodes(query: string, kind?: NodeKind, limit = 20): Node[] {
    // Sanitize for FTS5: escape special chars and append wildcard
    const safe = query.replace(/['"*()]/g, ' ').trim();
    const ftsQuery = safe ? safe + '*' : safe;
    if (kind) {
      return this.db.all(
        `SELECT n.* FROM nodes n
         JOIN nodes_fts f ON n.id = f.id
         WHERE nodes_fts MATCH ? AND n.kind = ?
         ORDER BY rank LIMIT ?`,
        [ftsQuery, kind, limit]
      ).map(this.rowToNode);
    }
    return this.db.all(
      `SELECT n.* FROM nodes n
       JOIN nodes_fts f ON n.id = f.id
       WHERE nodes_fts MATCH ?
       ORDER BY rank LIMIT ?`,
      [ftsQuery, limit]
    ).map(this.rowToNode);
  }

  searchNodesByName(name: string, kind?: NodeKind, limit = 20): Node[] {
    const pattern = `%${name}%`;
    if (kind) {
      return this.db.all(
        'SELECT * FROM nodes WHERE name LIKE ? AND kind = ? LIMIT ?',
        [pattern, kind, limit]
      ).map(this.rowToNode);
    }
    return this.db.all(
      'SELECT * FROM nodes WHERE name LIKE ? LIMIT ?',
      [pattern, limit]
    ).map(this.rowToNode);
  }

  deleteNodesByFile(filePath: string): void {
    const ids = this.db.all('SELECT id FROM nodes WHERE file_path = ?', [filePath]).map((r: any) => r.id);
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.run(`DELETE FROM edges WHERE source IN (${placeholders}) OR target IN (${placeholders})`, [...ids, ...ids]);
    this.db.run(`DELETE FROM nodes_fts WHERE id IN (${placeholders})`, ids);
    this.db.run(`DELETE FROM nodes WHERE file_path = ?`, [filePath]);
  }

  private rowToNode(row: any): Node {
    return {
      id: row.id,
      kind: row.kind as NodeKind,
      name: row.name,
      qualifiedName: row.qualified_name,
      filePath: row.file_path,
      language: row.language as Language,
      startLine: row.start_line,
      endLine: row.end_line,
      startColumn: row.start_column,
      endColumn: row.end_column,
      docstring: row.docstring ?? undefined,
      signature: row.signature ?? undefined,
      visibility: row.visibility ?? undefined,
      isExported: row.is_exported === 1,
      isAsync: row.is_async === 1,
      isStatic: row.is_static === 1,
      isAbstract: row.is_abstract === 1,
      decorators: row.decorators ? JSON.parse(row.decorators) : undefined,
      typeParameters: row.type_parameters ? JSON.parse(row.type_parameters) : undefined,
      updatedAt: row.updated_at,
    };
  }

  // ── Edges ──────────────────────────────────────────────────────────────────

  insertEdge(edge: Edge): void {
    this.db.run(
      `INSERT OR IGNORE INTO edges (source, target, kind, metadata, line, column)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [edge.source, edge.target, edge.kind, edge.metadata ? JSON.stringify(edge.metadata) : null, edge.line ?? null, edge.column ?? null]
    );
  }

  getCallers(nodeId: string, limit = 30): Node[] {
    return this.db.all(
      `SELECT n.* FROM nodes n
       JOIN edges e ON e.source = n.id
       WHERE e.target = ? AND e.kind = 'calls'
       LIMIT ?`,
      [nodeId, limit]
    ).map(this.rowToNode);
  }

  getCallees(nodeId: string, limit = 30): Node[] {
    return this.db.all(
      `SELECT n.* FROM nodes n
       JOIN edges e ON e.target = n.id
       WHERE e.source = ? AND e.kind = 'calls'
       LIMIT ?`,
      [nodeId, limit]
    ).map(this.rowToNode);
  }

  getImpactRadius(nodeId: string, depth = 2): Node[] {
    // BFS over 'calls' and 'imports' edges (dependents)
    const visited = new Set<string>([nodeId]);
    let frontier = [nodeId];
    for (let d = 0; d < depth; d++) {
      if (frontier.length === 0) break;
      const placeholders = frontier.map(() => '?').join(',');
      const rows = this.db.all(
        `SELECT DISTINCT source FROM edges WHERE target IN (${placeholders}) AND kind IN ('calls','imports')`,
        frontier
      );
      frontier = [];
      for (const row of rows) {
        if (!visited.has(row.source)) {
          visited.add(row.source);
          frontier.push(row.source);
        }
      }
    }
    visited.delete(nodeId);
    if (visited.size === 0) return [];
    const ids = [...visited];
    const placeholders = ids.map(() => '?').join(',');
    return this.db.all(`SELECT * FROM nodes WHERE id IN (${placeholders})`, ids).map(this.rowToNode);
  }

  getEdgesForNodes(nodeIds: string[]): Edge[] {
    if (nodeIds.length === 0) return [];
    const placeholders = nodeIds.map(() => '?').join(',');
    return this.db.all(
      `SELECT * FROM edges WHERE source IN (${placeholders}) OR target IN (${placeholders})`,
      [...nodeIds, ...nodeIds]
    ).map((row: any) => ({
      source: row.source,
      target: row.target,
      kind: row.kind,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      line: row.line ?? undefined,
      column: row.column ?? undefined,
    }));
  }

  /**
   * Find files that import (depend on) the given file path.
   * Used for affected-test traversal.
   */
  getDependentFiles(filePath: string): string[] {
    // Find nodes in the target file
    const targetNodes = this.db.all('SELECT id FROM nodes WHERE file_path = ?', [filePath]);
    if (targetNodes.length === 0) return [];
    const ids = targetNodes.map((r: any) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    // Find source nodes that call/import these target nodes
    const rows = this.db.all(
      `SELECT DISTINCT n.file_path FROM nodes n
       JOIN edges e ON e.source = n.id
       WHERE e.target IN (${placeholders}) AND e.kind IN ('calls','imports')
       AND n.file_path != ?`,
      [...ids, filePath]
    );
    return rows.map((r: any) => r.file_path);
  }

  // ── Unresolved References ──────────────────────────────────────────────────

  insertUnresolvedRef(sourceId: string, refName: string, refKind: string, filePath: string, line?: number, column?: number): void {
    this.db.run(
      `INSERT INTO unresolved_refs (source_id, ref_name, ref_kind, file_path, line, column)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sourceId, refName, refKind, filePath, line ?? null, column ?? null]
    );
  }

  deleteUnresolvedRefsByFile(filePath: string): void {
    this.db.run('DELETE FROM unresolved_refs WHERE file_path = ?', [filePath]);
  }

  /**
   * Resolve pending call references using 3-strategy name matching:
   * 1. Exact name match
   * 2. Qualified name suffix match (::name)
   * 3. Case-insensitive fuzzy match
   *
   * Returns the number of edges successfully created.
   */
  resolveCallEdges(): number {
    const refs = this.db.all('SELECT * FROM unresolved_refs WHERE ref_kind = ?', ['function']);
    let resolved = 0;

    for (const ref of refs) {
      const { id: refId, source_id: sourceId, ref_name: refName, line, column } = ref;

      // Strategy 1: exact name match
      let target = this.db.get('SELECT id FROM nodes WHERE name = ? LIMIT 1', [refName]);

      // Strategy 2: qualified name suffix
      if (!target) {
        target = this.db.get(
          `SELECT id FROM nodes WHERE qualified_name LIKE ? LIMIT 1`,
          [`%::${refName}`]
        );
      }

      // Strategy 3: case-insensitive
      if (!target) {
        target = this.db.get(
          'SELECT id FROM nodes WHERE lower(name) = lower(?) LIMIT 1',
          [refName]
        );
      }

      if (target) {
        this.insertEdge({ source: sourceId, target: target.id, kind: 'calls', line: line ?? undefined, column: column ?? undefined });
        this.db.run('DELETE FROM unresolved_refs WHERE id = ?', [refId]);
        resolved++;
      }
    }

    return resolved;
  }

  // ── Graph Analysis ─────────────────────────────────────────────────────────

  /**
   * Find symbols with no incoming edges (potential dead code).
   */
  findDeadCode(limit = 50): Node[] {
    return this.db.all(
      `SELECT * FROM nodes
       WHERE kind IN ('function','method','class')
         AND id NOT IN (SELECT DISTINCT target FROM edges)
       LIMIT ?`,
      [limit]
    ).map(this.rowToNode);
  }

  /**
   * Find circular import dependencies using DFS over import edges.
   * Returns arrays of file paths forming cycles.
   */
  findCircularDependencies(): string[][] {
    // Build adjacency map: file → imported files
    const rows = this.db.all(
      `SELECT DISTINCT n1.file_path as src, n2.file_path as dst
       FROM edges e
       JOIN nodes n1 ON n1.id = e.source
       JOIN nodes n2 ON n2.id = e.target
       WHERE e.kind = 'imports' AND n1.file_path != n2.file_path`
    );

    const adj = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!adj.has(row.src)) adj.set(row.src, new Set());
      adj.get(row.src)!.add(row.dst);
    }

    const cycles: string[][] = [];
    const visited = new Set<string>();
    const path: string[] = [];
    const inPath = new Set<string>();

    function dfs(node: string): void {
      if (inPath.has(node)) {
        const cycleStart = path.indexOf(node);
        cycles.push(path.slice(cycleStart).concat(node));
        return;
      }
      if (visited.has(node)) return;
      visited.add(node);
      inPath.add(node);
      path.push(node);
      for (const neighbor of adj.get(node) ?? []) {
        dfs(neighbor);
      }
      path.pop();
      inPath.delete(node);
    }

    for (const node of adj.keys()) {
      if (!visited.has(node)) dfs(node);
    }

    return cycles;
  }

  /**
   * Find the shortest path between two nodes via BFS over all edge kinds.
   */
  findPath(fromId: string, toId: string, maxDepth = 10): Node[] {
    if (fromId === toId) {
      const node = this.getNode(fromId);
      return node ? [node] : [];
    }

    const prev = new Map<string, string>();
    const queue: string[] = [fromId];
    const visited = new Set<string>([fromId]);
    let depth = 0;

    outer: while (queue.length > 0 && depth < maxDepth) {
      const levelSize = queue.length;
      depth++;
      for (let i = 0; i < levelSize; i++) {
        const current = queue.shift()!;
        const rows = this.db.all(
          `SELECT DISTINCT target as next FROM edges WHERE source = ?
           UNION
           SELECT DISTINCT source as next FROM edges WHERE target = ?`,
          [current, current]
        );
        for (const row of rows) {
          if (!visited.has(row.next)) {
            visited.add(row.next);
            prev.set(row.next, current);
            if (row.next === toId) break outer;
            queue.push(row.next);
          }
        }
      }
    }

    if (!prev.has(toId)) return [];

    // Reconstruct path
    const pathIds: string[] = [];
    let cur: string | undefined = toId;
    while (cur !== undefined) {
      pathIds.unshift(cur);
      cur = prev.get(cur);
    }

    const result: Node[] = [];
    for (const id of pathIds) {
      const node = this.getNode(id);
      if (node) result.push(node);
    }
    return result;
  }

  /**
   * Traverse type hierarchy via 'extends' and 'implements' edges.
   * direction 'up' = base types, 'down' = derived types, 'both' = all.
   */
  getTypeHierarchy(nodeId: string, direction: 'up' | 'down' | 'both' = 'both'): Node[] {
    const visited = new Set<string>([nodeId]);
    const frontier = [nodeId];
    const result: Node[] = [];

    while (frontier.length > 0) {
      const current = frontier.shift()!;
      let rows: any[] = [];

      if (direction === 'up' || direction === 'both') {
        // current extends/implements something → go up
        const up = this.db.all(
          `SELECT target as id FROM edges WHERE source = ? AND kind IN ('extends','implements')`,
          [current]
        );
        rows = rows.concat(up);
      }
      if (direction === 'down' || direction === 'both') {
        // something extends/implements current → go down
        const down = this.db.all(
          `SELECT source as id FROM edges WHERE target = ? AND kind IN ('extends','implements')`,
          [current]
        );
        rows = rows.concat(down);
      }

      for (const row of rows) {
        if (!visited.has(row.id)) {
          visited.add(row.id);
          frontier.push(row.id);
          const node = this.getNode(row.id);
          if (node) result.push(node);
        }
      }
    }

    return result;
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  getStats(): { files: number; nodes: number; edges: number; nodesByKind: Record<string, number> } {
    const files = this.db.get('SELECT COUNT(*) as c FROM files').c;
    const nodes = this.db.get('SELECT COUNT(*) as c FROM nodes').c;
    const edges = this.db.get('SELECT COUNT(*) as c FROM edges').c;
    const kindRows = this.db.all('SELECT kind, COUNT(*) as c FROM nodes GROUP BY kind');
    const nodesByKind: Record<string, number> = {};
    for (const row of kindRows) nodesByKind[row.kind] = row.c;
    return { files, nodes, edges, nodesByKind };
  }

  // ── Transactions ──────────────────────────────────────────────────────────

  transaction<T>(fn: () => T): T {
    this.db.run('BEGIN');
    try {
      const result = fn();
      this.db.run('COMMIT');
      return result;
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }
}
