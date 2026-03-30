/**
 * KiroGraph — Semantic code knowledge graph for Kiro
 *
 * Drop-in equivalent of CodeGraph, wired for Kiro's MCP + hooks system.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import { GraphDatabase } from './db/database';
import { extractFile } from './extraction/extractor';
import { detectLanguage } from './extraction/languages';
import type {
  Node, Edge, NodeKind, IndexResult, IndexProgress, SyncResult, TaskContext, SearchResult,
} from './types';

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  language?: string;
  symbolCount?: number;
  children?: FileTreeNode[];
}

export type FileTree = FileTreeNode[];

function buildFileTree(files: import('./types').FileRecord[], maxDepth?: number): FileTree {
  interface DirNode extends FileTreeNode { _childMap: Map<string, DirNode | FileTreeNode> }

  const rootMap = new Map<string, DirNode | FileTreeNode>();

  for (const file of files) {
    const parts = file.path.split('/');
    let currentMap = rootMap;

    for (let i = 0; i < parts.length; i++) {
      if (maxDepth !== undefined && i >= maxDepth) break;
      const part = parts[i];
      const currentPath = parts.slice(0, i + 1).join('/');
      const isLast = i === parts.length - 1;

      if (!currentMap.has(part)) {
        if (isLast) {
          currentMap.set(part, { name: part, path: currentPath, type: 'file', language: file.language, symbolCount: file.symbolCount });
        } else {
          const dir: DirNode = { name: part, path: currentPath, type: 'dir', children: [], _childMap: new Map() };
          currentMap.set(part, dir);
        }
      }

      if (!isLast) {
        const dir = currentMap.get(part) as DirNode;
        currentMap = dir._childMap;
      }
    }
  }

  function toTree(map: Map<string, DirNode | FileTreeNode>): FileTreeNode[] {
    return [...map.values()].map(n => {
      if (n.type === 'dir') {
        const dir = n as DirNode;
        return { name: dir.name, path: dir.path, type: 'dir' as const, children: toTree(dir._childMap) };
      }
      return n;
    });
  }

  return toTree(rootMap);
}

const KIROGRAPH_DIR = '.kirograph';
const CONFIG_FILE = 'config.json';
const LOCK_FILE = 'kirograph.lock';
const DIRTY_FILE = 'dirty';
const FILE_IO_BATCH_SIZE = 10;
// Timeout after which a lock is considered stale (5 minutes)
const LOCK_STALE_MS = 5 * 60 * 1000;

export interface KiroGraphConfig {
  version: number;
  languages: string[];
  exclude: string[];
  maxFileSize: number;
  extractDocstrings: boolean;
  trackCallSites: boolean;
}

const DEFAULT_CONFIG: KiroGraphConfig = {
  version: 1,
  languages: [],
  exclude: ['node_modules/**', 'dist/**', 'build/**', '.git/**', '*.min.js', '.kirograph/**'],
  maxFileSize: 1_048_576,
  extractDocstrings: true,
  trackCallSites: true,
};

const STOP_WORDS = new Set([
  'the','and','for','with','from','this','that','have','been','will','would',
  'could','should','does','done','make','made','use','used','using','work',
  'works','find','found','show','call','called','get','set','add','all','any',
  'how','what','when','where','which','who','why','fix','bug','code','file',
  'files','function','method','class','type','build','run','test','a','an','in',
  'of','to','is','it','by','on','at','as','or','be','do','if','no','so','up',
]);

function extractTokens(query: string): string[] {
  const tokens = new Set<string>();
  // CamelCase / PascalCase
  for (const m of query.matchAll(/\b([A-Z][a-z]+(?:[A-Z][a-z]*)*|[a-z]+(?:[A-Z][a-z]*)+)\b/g))
    if (m[1].length >= 2) tokens.add(m[1]);
  // snake_case
  for (const m of query.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/gi))
    if (m[1].length >= 3) tokens.add(m[1]);
  // SCREAMING_SNAKE
  for (const m of query.matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g))
    if (m[1].length >= 3) tokens.add(m[1]);
  // dot.notation — add both full and parts
  for (const m of query.matchAll(/\b([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+)\b/g)) {
    tokens.add(m[1]);
    for (const part of m[1].split('.')) tokens.add(part);
  }
  // plain words >= 4 chars
  for (const m of query.matchAll(/\b([a-zA-Z]{4,})\b/g))
    if (!STOP_WORDS.has(m[1].toLowerCase())) tokens.add(m[1]);
  return [...tokens];
}

export default class KiroGraph {
  private db: GraphDatabase;
  private projectRoot: string;
  private config: KiroGraphConfig;

  private constructor(projectRoot: string, db: GraphDatabase, config: KiroGraphConfig) {
    this.projectRoot = projectRoot;
    this.db = db;
    this.config = config;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  static async init(projectRoot: string, config?: Partial<KiroGraphConfig>): Promise<KiroGraph> {
    const resolved = path.resolve(projectRoot);
    const dir = path.join(resolved, KIROGRAPH_DIR);
    fs.mkdirSync(dir, { recursive: true });

    const cfg = { ...DEFAULT_CONFIG, ...config };
    fs.writeFileSync(path.join(dir, CONFIG_FILE), JSON.stringify(cfg, null, 2));

    const db = new GraphDatabase(resolved);
    return new KiroGraph(resolved, db, cfg);
  }

  static async open(projectRoot: string): Promise<KiroGraph> {
    const resolved = path.resolve(projectRoot);
    const dir = path.join(resolved, KIROGRAPH_DIR);
    if (!fs.existsSync(dir)) throw new Error(`KiroGraph not initialized at ${resolved}. Run: kirograph init`);

    const cfgPath = path.join(dir, CONFIG_FILE);
    const cfg: KiroGraphConfig = fs.existsSync(cfgPath)
      ? { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) }
      : DEFAULT_CONFIG;

    const db = new GraphDatabase(resolved);
    return new KiroGraph(resolved, db, cfg);
  }

  static isInitialized(projectRoot: string): boolean {
    return fs.existsSync(path.join(path.resolve(projectRoot), KIROGRAPH_DIR));
  }

  // ── File Locking ───────────────────────────────────────────────────────────

  private lockFilePath(): string {
    return path.join(this.projectRoot, KIROGRAPH_DIR, LOCK_FILE);
  }

  private acquireLock(): void {
    const lockPath = this.lockFilePath();
    if (fs.existsSync(lockPath)) {
      try {
        const content = fs.readFileSync(lockPath, 'utf8').trim();
        const [pidStr, tsStr] = content.split(':');
        const pid = parseInt(pidStr, 10);
        const ts = parseInt(tsStr, 10);

        if (!isNaN(pid) && pid !== process.pid) {
          const isStale = !isNaN(ts) && Date.now() - ts > LOCK_STALE_MS;
          if (!isStale) {
            try {
              process.kill(pid, 0);
              // Process is alive — lock is valid
              throw new Error(`KiroGraph is locked by PID ${pid}. Use 'kirograph unlock' to force-release.`);
            } catch (e: any) {
              if (e.message.includes('KiroGraph is locked')) throw e;
              // Process not found — stale lock, override it
            }
          }
        }
      } catch (e: any) {
        if (e.message.includes('KiroGraph is locked')) throw e;
        // Could not read lock file — override
      }
    }
    fs.writeFileSync(lockPath, `${process.pid}:${Date.now()}`);
  }

  private releaseLock(): void {
    try { fs.unlinkSync(this.lockFilePath()); } catch { /* ignore */ }
  }

  /** Force-remove the lock file. Used by `kirograph unlock`. */
  unlockForce(): void {
    this.releaseLock();
  }

  // ── Dirty Marker ──────────────────────────────────────────────────────────

  private dirtyFilePath(): string {
    return path.join(this.projectRoot, KIROGRAPH_DIR, DIRTY_FILE);
  }

  markDirty(): void {
    fs.writeFileSync(this.dirtyFilePath(), String(Date.now()));
  }

  clearDirty(): void {
    try { fs.unlinkSync(this.dirtyFilePath()); } catch { /* ignore */ }
  }

  isDirty(): boolean {
    return fs.existsSync(this.dirtyFilePath());
  }

  async syncIfDirty(): Promise<SyncResult | null> {
    if (!this.isDirty()) return null;
    return this.sync();
  }

  // ── Indexing ───────────────────────────────────────────────────────────────

  async indexAll(opts?: { onProgress?: (p: IndexProgress) => void; force?: boolean }): Promise<IndexResult> {
    this.acquireLock();
    const start = Date.now();
    const errors: string[] = [];
    let filesIndexed = 0;
    let nodesCreated = 0;
    let edgesCreated = 0;

    try {
      const files = this.scanFiles();
      opts?.onProgress?.({ phase: 'scanning', current: files.length, total: files.length });

      // Batch read files in parallel (FILE_IO_BATCH_SIZE at a time)
      const contentMap = new Map<string, Buffer>();
      for (let b = 0; b < files.length; b += FILE_IO_BATCH_SIZE) {
        const batch = files.slice(b, b + FILE_IO_BATCH_SIZE);
        const results = await Promise.all(
          batch.map(f => fs.promises.readFile(f).catch(() => null))
        );
        for (let i = 0; i < batch.length; i++) {
          if (results[i]) contentMap.set(batch[i], results[i]!);
        }
      }

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        opts?.onProgress?.({ phase: 'parsing', current: i + 1, total: files.length, currentFile: file });

        try {
          const content = contentMap.get(file);
          if (!content) continue;
          if (content.length > this.config.maxFileSize) continue;

          const relPath = path.relative(this.projectRoot, file).replace(/\\/g, '/');

          if (!opts?.force) {
            const existing = this.db.getFile(relPath);
            if (existing) {
              const hash = crypto.createHash('sha256').update(content).digest('hex');
              if (hash === existing.contentHash) continue;
            }
          }

          const extracted = await extractFile(file, this.projectRoot, content);
          if (!extracted) continue;

          this.db.transaction(() => {
            this.db.deleteNodesByFile(extracted.filePath);
            this.db.deleteUnresolvedRefsByFile(extracted.filePath);
            this.db.upsertFile({
              path: extracted.filePath,
              contentHash: extracted.contentHash,
              language: extracted.language,
              fileSize: extracted.fileSize,
              symbolCount: extracted.nodes.length,
              indexedAt: Date.now(),
            });
            for (const node of extracted.nodes) {
              this.db.upsertNode(node);
              nodesCreated++;
            }
            for (const edge of extracted.edges) {
              this.db.insertEdge(edge);
              edgesCreated++;
            }
            for (const ref of extracted.unresolvedCalls) {
              this.db.insertUnresolvedRef(ref.sourceId, ref.calleeName, 'function', extracted.filePath, ref.line, ref.column);
            }
          });

          filesIndexed++;
        } catch (err) {
          errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Resolve cross-file call edges
      opts?.onProgress?.({ phase: 'resolving', current: 0, total: 1 });
      const resolved = this.db.resolveCallEdges();
      edgesCreated += resolved;

      this.clearDirty();
      return { success: errors.length === 0, filesIndexed, nodesCreated, edgesCreated, errors, duration: Date.now() - start };
    } finally {
      this.releaseLock();
    }
  }

  async sync(changedFiles?: string[]): Promise<SyncResult> {
    this.acquireLock();
    const start = Date.now();
    const result: SyncResult = { added: [], modified: [], removed: [], nodesCreated: 0, nodesRemoved: 0, errors: [], duration: 0 };

    try {
      // Use git fast-path for change detection if no explicit files provided
      let filesToProcess: string[];
      if (changedFiles) {
        filesToProcess = changedFiles.map(f => path.resolve(this.projectRoot, f));
      } else {
        const gitChanged = this.getGitChangedFiles();
        if (gitChanged) {
          // Process git-detected changes
          for (const p of gitChanged.deleted) {
            const rel = path.relative(this.projectRoot, p).replace(/\\/g, '/');
            this.db.deleteFile(rel);
            this.db.deleteUnresolvedRefsByFile(rel);
            result.removed.push(rel);
          }
          filesToProcess = gitChanged.modified;
        } else {
          // Fallback: full scan + detect removed files
          const indexed = new Set(this.db.getAllFiles().map(f => f.path));
          const current = new Set(this.scanFiles().map(f => path.relative(this.projectRoot, f).replace(/\\/g, '/')));
          for (const p of indexed) {
            if (!current.has(p)) {
              this.db.deleteFile(p);
              this.db.deleteUnresolvedRefsByFile(p);
              result.removed.push(p);
            }
          }
          filesToProcess = this.scanFiles();
        }
      }

      for (const file of filesToProcess) {
        if (!fs.existsSync(file)) {
          const rel = path.relative(this.projectRoot, file).replace(/\\/g, '/');
          this.db.deleteFile(rel);
          this.db.deleteUnresolvedRefsByFile(rel);
          result.removed.push(rel);
          continue;
        }

        try {
          const extracted = await extractFile(file, this.projectRoot);
          if (!extracted) continue;

          const existing = this.db.getFile(extracted.filePath);
          const isNew = !existing;

          if (!isNew && existing!.contentHash === extracted.contentHash) continue;

          this.db.transaction(() => {
            const oldNodes = this.db.getNodesByFile(extracted.filePath);
            result.nodesRemoved += oldNodes.length;
            this.db.deleteNodesByFile(extracted.filePath);
            this.db.deleteUnresolvedRefsByFile(extracted.filePath);
            this.db.upsertFile({
              path: extracted.filePath,
              contentHash: extracted.contentHash,
              language: extracted.language,
              fileSize: extracted.fileSize,
              symbolCount: extracted.nodes.length,
              indexedAt: Date.now(),
            });
            for (const node of extracted.nodes) {
              this.db.upsertNode(node);
              result.nodesCreated++;
            }
            for (const edge of extracted.edges) {
              this.db.insertEdge(edge);
            }
            for (const ref of extracted.unresolvedCalls) {
              this.db.insertUnresolvedRef(ref.sourceId, ref.calleeName, 'function', extracted.filePath, ref.line, ref.column);
            }
          });

          if (isNew) result.added.push(extracted.filePath);
          else result.modified.push(extracted.filePath);
        } catch (err) {
          result.errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Re-resolve call edges for changed files
      this.db.resolveCallEdges();

      this.clearDirty();
      result.duration = Date.now() - start;
      return result;
    } finally {
      this.releaseLock();
    }
  }

  // ── Query API ──────────────────────────────────────────────────────────────

  searchNodes(query: string, kind?: NodeKind, limit = 20): SearchResult[] {
    // Try exact name match first (highest precision)
    const exact = this.db.findNodesByExactName(query, kind, limit);
    if (exact.length > 0) {
      return exact.map(n => ({ node: n, score: 1, matchType: 'exact' as const }));
    }

    // Try FTS, fall back to LIKE
    let nodes: Node[] = [];
    try {
      nodes = this.db.searchNodes(query, kind, limit);
    } catch {
      nodes = this.db.searchNodesByName(query, kind, limit);
    }
    if (nodes.length === 0) {
      nodes = this.db.searchNodesByName(query, kind, limit);
    }
    return nodes.map(n => ({ node: n, score: 1, matchType: 'fuzzy' as const }));
  }

  getCallers(nodeId: string, limit = 30): Node[] {
    return this.db.getCallers(nodeId, limit);
  }

  getCallees(nodeId: string, limit = 30): Node[] {
    return this.db.getCallees(nodeId, limit);
  }

  getImpactRadius(nodeId: string, depth = 2): Node[] {
    return this.db.getImpactRadius(nodeId, depth);
  }

  findDeadCode(limit = 50): Node[] {
    return this.db.findDeadCode(limit);
  }

  findCircularDependencies(): string[][] {
    return this.db.findCircularDependencies();
  }

  findPath(fromId: string, toId: string, maxDepth = 10): Node[] {
    return this.db.findPath(fromId, toId, maxDepth);
  }

  getTypeHierarchy(nodeId: string, direction: 'up' | 'down' | 'both' = 'both'): Node[] {
    return this.db.getTypeHierarchy(nodeId, direction);
  }

  getNode(id: string): Node | null {
    return this.db.getNode(id);
  }

  getNodeSource(node: Node): string | null {
    const absPath = path.join(this.projectRoot, node.filePath);
    try {
      const lines = fs.readFileSync(absPath, 'utf8').split('\n');
      return lines.slice(node.startLine - 1, node.endLine).join('\n');
    } catch {
      return null;
    }
  }

  async buildContext(task: string, opts?: { maxNodes?: number; includeCode?: boolean }): Promise<TaskContext> {
    const maxNodes = opts?.maxNodes ?? 20;
    const includeCode = opts?.includeCode ?? true;

    // Extract candidate symbol tokens from the task description
    const tokens = extractTokens(task);
    const seen = new Set<string>();
    const entryPoints: Node[] = [];

    for (const token of tokens) {
      if (entryPoints.length >= Math.ceil(maxNodes / 2)) break;
      const results = this.searchNodes(token, undefined, 3);
      for (const r of results) {
        if (!seen.has(r.node.id)) {
          seen.add(r.node.id);
          entryPoints.push(r.node);
        }
      }
    }

    // Expand via graph
    const relatedSet = new Map<string, Node>();
    for (const ep of entryPoints) {
      const callers = this.getCallers(ep.id, 5);
      const callees = this.getCallees(ep.id, 5);
      for (const n of [...callers, ...callees]) {
        if (!seen.has(n.id)) { seen.add(n.id); relatedSet.set(n.id, n); }
      }
    }

    const allNodeIds = [...entryPoints.map(n => n.id), ...relatedSet.keys()].slice(0, maxNodes);
    const allNodes = [...entryPoints, ...relatedSet.values()].slice(0, maxNodes);
    const edges = this.db.getEdgesForNodes(allNodeIds);

    const codeSnippets = new Map<string, string>();
    if (includeCode) {
      for (const node of allNodes.slice(0, 10)) {
        const src = this.getNodeSource(node);
        if (src) codeSnippets.set(node.id, src);
      }
    }

    return {
      task,
      entryPoints,
      relatedNodes: [...relatedSet.values()],
      edges,
      codeSnippets,
      summary: `Found ${entryPoints.length} entry points and ${relatedSet.size} related symbols for: "${task}"`,
    };
  }

  /**
   * Get the indexed file structure, optionally filtered by path prefix or glob pattern.
   */
  getFiles(opts?: { filterPath?: string; pattern?: string; maxDepth?: number }): FileTree {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const picomatch = opts?.pattern ? require('picomatch')(opts.pattern) : null;
    const allFiles = this.db.getAllFiles();

    const filtered = allFiles.filter(f => {
      if (opts?.filterPath && !f.path.startsWith(opts.filterPath)) return false;
      if (picomatch && !picomatch(f.path)) return false;
      return true;
    });

    return buildFileTree(filtered, opts?.maxDepth);
  }

  /**
   * Find test files affected by changes to the given source files.
   * BFS-traverses import/call dependents to find which test files depend on changed code.
   */
  getAffectedTests(changedFiles: string[], opts?: { depth?: number; testPattern?: string }): string[] {
    const depth = opts?.depth ?? 5;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const picomatch = require('picomatch');
    const testPattern = opts?.testPattern ?? '{**/*.spec.*,**/*.test.*,**/e2e/**,**/tests/**,**/__tests__/**}';
    const isTest = picomatch(testPattern);

    const results = new Set<string>();

    for (const file of changedFiles) {
      const rel = file.replace(/\\/g, '/').replace(/^\.\//, '');

      // If the changed file itself is a test, include it directly
      if (isTest(rel)) { results.add(rel); continue; }

      // BFS over dependents (files that import this file)
      const visited = new Set<string>([rel]);
      let frontier = [rel];

      for (let d = 0; d < depth; d++) {
        if (frontier.length === 0) break;
        const next: string[] = [];
        for (const f of frontier) {
          const dependents = this.db.getDependentFiles(f);
          for (const dep of dependents) {
            if (!visited.has(dep)) {
              visited.add(dep);
              next.push(dep);
              if (isTest(dep)) results.add(dep);
            }
          }
        }
        frontier = next;
      }
    }

    return [...results].sort();
  }

  getStats() {
    return this.db.getStats();
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  close(): void {
    this.releaseLock();
    this.db.close();
  }

  // ── File Scanning ──────────────────────────────────────────────────────────

  /**
   * Try to use git ls-files for fast, .gitignore-aware file discovery.
   * Falls back to filesystem walk if git is unavailable.
   */
  private scanFiles(): string[] {
    // Try git fast-path
    try {
      const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
        cwd: this.projectRoot,
        encoding: 'utf8',
        timeout: 10_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const relPaths = output.split('\n').filter(Boolean);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const picomatch = require('picomatch');
      const excludeMatchers = this.buildExcludeMatchers(picomatch);
      return relPaths
        .filter(rel => !excludeMatchers.some((m: (s: string) => boolean) => m(rel) || m(rel + '/')))
        .map(rel => path.join(this.projectRoot, rel))
        .filter(abs => {
          const lang = detectLanguage(abs);
          return lang !== 'unknown';
        });
    } catch {
      // Fall through to filesystem walk
    }

    return this.scanFilesWalk();
  }

  /**
   * Filesystem walk fallback. Respects .kirographignore files.
   */
  private scanFilesWalk(): string[] {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const picomatch = require('picomatch');
    const excludeMatchers = this.buildExcludeMatchers(picomatch);
    const results: string[] = [];
    const visitedDirs = new Set<string>();

    const walk = (dir: string) => {
      let realDir: string;
      try { realDir = fs.realpathSync(dir); } catch { return; }
      if (visitedDirs.has(realDir)) return; // symlink cycle protection
      visitedDirs.add(realDir);

      // Check for .kirographignore in this directory
      const ignoreFile = path.join(dir, '.kirographignore');
      if (fs.existsSync(ignoreFile)) return;

      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(this.projectRoot, full).replace(/\\/g, '/');
        if (excludeMatchers.some((m: (s: string) => boolean) => m(rel) || m(rel + '/'))) continue;
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          const lang = detectLanguage(full);
          if (lang !== 'unknown') results.push(full);
        }
      }
    };
    walk(this.projectRoot);
    return results;
  }

  private buildExcludeMatchers(picomatch: any): ((s: string) => boolean)[] {
    const patterns = [...this.config.exclude];

    // Also load .kirographignore from project root
    const rootIgnore = path.join(this.projectRoot, '.kirographignore');
    if (fs.existsSync(rootIgnore)) {
      const lines = fs.readFileSync(rootIgnore, 'utf8')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));
      patterns.push(...lines);
    }

    return patterns.map((p: string) => picomatch(p));
  }

  /**
   * Use `git status --porcelain` to detect changed/deleted files since last commit.
   * Returns null if git is unavailable.
   */
  private getGitChangedFiles(): { modified: string[]; deleted: string[] } | null {
    try {
      const output = execFileSync('git', ['status', '--porcelain', '--no-renames'], {
        cwd: this.projectRoot,
        encoding: 'utf8',
        timeout: 10_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      const modified: string[] = [];
      const deleted: string[] = [];

      for (const line of output.split('\n').filter(Boolean)) {
        const status = line.slice(0, 2).trim();
        const relPath = line.slice(3).trim();
        const absPath = path.join(this.projectRoot, relPath);
        const lang = detectLanguage(absPath);
        if (lang === 'unknown') continue;

        if (status === 'D') {
          deleted.push(absPath);
        } else {
          modified.push(absPath);
        }
      }

      return { modified, deleted };
    } catch {
      return null;
    }
  }
}

/**
 * Walk up directories to find the nearest .kirograph/ folder.
 */
export function findNearestKiroGraphRoot(startPath: string): string | null {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, KIROGRAPH_DIR))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
