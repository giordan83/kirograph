/**
 * Symbol extractor using web-tree-sitter
 * Parses source files and extracts nodes + edges into the graph.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { Node, Edge, NodeKind, Language } from '../types';
import { detectLanguage, GRAMMAR_MAP, isSupportedLanguage } from './languages';

// Lazy-loaded tree-sitter
let Parser: any = null;
const loadedGrammars = new Map<string, any>();

async function getParser(): Promise<any> {
  if (Parser) return Parser;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const TreeSitter = require('web-tree-sitter');
  await TreeSitter.Parser.init();
  Parser = TreeSitter;
  return Parser;
}

async function getGrammar(language: Language): Promise<any | null> {
  if (loadedGrammars.has(language)) return loadedGrammars.get(language)!;
  const grammarName = GRAMMAR_MAP[language];
  if (!grammarName) return null;

  try {
    const TS = await getParser();
    // tree-sitter-wasms stores wasm files in out/
    const wasmDir = path.join(require.resolve('tree-sitter-wasms/package.json'), '..', 'out');
    const wasmPath = path.join(wasmDir, `${grammarName}.wasm`);
    if (!fs.existsSync(wasmPath)) return null;
    const lang = await TS.Language.load(wasmPath);
    loadedGrammars.set(language, lang);
    return lang;
  } catch {
    return null;
  }
}

export interface UnresolvedCall {
  sourceId: string;
  calleeName: string;
  line: number;
  column: number;
}

export interface ExtractedFile {
  filePath: string;
  language: Language;
  contentHash: string;
  fileSize: number;
  nodes: Node[];
  edges: Edge[];
  unresolvedCalls: UnresolvedCall[];
}

export function makeNodeId(filePath: string, kind: string, name: string, line: number): string {
  const hash = crypto.createHash('sha256').update(`${filePath}:${kind}:${name}:${line}`).digest('hex').slice(0, 32);
  return `${kind}:${hash}`;
}

/**
 * Extract symbols from a single file.
 * Optionally accepts pre-read content for batch I/O efficiency.
 */
export async function extractFile(filePath: string, projectRoot: string, content?: Buffer | string): Promise<ExtractedFile | null> {
  const language = detectLanguage(filePath);
  if (!isSupportedLanguage(language)) return null;

  let source: string;
  try {
    if (content !== undefined) {
      source = typeof content === 'string' ? content : content.toString('utf8');
    } else {
      source = fs.readFileSync(filePath, 'utf8');
    }
  } catch {
    return null;
  }

  const contentHash = crypto.createHash('sha256').update(source).digest('hex');
  const fileSize = Buffer.byteLength(source, 'utf8');
  const relPath = path.relative(projectRoot, filePath).replace(/\\/g, '/');

  const grammar = await getGrammar(language);
  if (!grammar) {
    // Return minimal file node even without grammar
    return {
      filePath: relPath,
      language,
      contentHash,
      fileSize,
      nodes: [],
      edges: [],
      unresolvedCalls: [],
    };
  }

  const TS = await getParser();
  const parser = new TS.Parser();
  parser.setLanguage(grammar);
  const tree = parser.parse(source);

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const unresolvedCalls: UnresolvedCall[] = [];
  const now = Date.now();

  // Walk the AST and extract symbols
  walkTree(tree.rootNode, source, relPath, language, nodes, edges, unresolvedCalls, now);

  return { filePath: relPath, language, contentHash, fileSize, nodes, edges, unresolvedCalls };
}

function walkTree(
  node: any,
  source: string,
  filePath: string,
  language: Language,
  nodes: Node[],
  edges: Edge[],
  unresolvedCalls: UnresolvedCall[],
  now: number,
  parentId?: string
): void {
  // Transparent wrapper nodes — descend without creating a symbol
  const transparent = new Set(['export_statement', 'program', 'source_file', 'module', 'translation_unit']);
  if (transparent.has(node.type)) {
    for (let i = 0; i < node.childCount; i++) {
      walkTree(node.child(i), source, filePath, language, nodes, edges, unresolvedCalls, now, parentId);
    }
    return;
  }

  const kind = mapNodeKind(node.type, language);
  if (kind) {
    const name = extractName(node, source, language);
    if (name) {
      const id = makeNodeId(filePath, kind, name, node.startPosition.row + 1);
      const graphNode: Node = {
        id,
        kind,
        name,
        qualifiedName: `${filePath}::${name}`,
        filePath,
        language,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startColumn: node.startPosition.column,
        endColumn: node.endPosition.column,
        docstring: extractDocstring(node, source),
        signature: extractSignature(node, source),
        isExported: isExported(node, source),
        isAsync: isAsync(node),
        isStatic: isStatic(node),
        updatedAt: now,
      };
      nodes.push(graphNode);

      if (parentId) {
        edges.push({ source: parentId, target: id, kind: 'contains' });
      }

      // Collect unresolved call references within this node
      collectCalls(node, source, id, unresolvedCalls);

      // Recurse into children with this node as parent
      for (let i = 0; i < node.childCount; i++) {
        walkTree(node.child(i), source, filePath, language, nodes, edges, unresolvedCalls, now, id);
      }
      return;
    }
  }

  // No symbol at this node — recurse without changing parent
  for (let i = 0; i < node.childCount; i++) {
    walkTree(node.child(i), source, filePath, language, nodes, edges, unresolvedCalls, now, parentId);
  }
}

function mapNodeKind(type: string, _lang: Language): NodeKind | null {
  const map: Record<string, NodeKind> = {
    // TypeScript / JavaScript
    function_declaration: 'function',
    function_expression: 'function',
    arrow_function: 'function',
    method_definition: 'method',
    class_declaration: 'class',
    class_expression: 'class',
    interface_declaration: 'interface',
    type_alias_declaration: 'type_alias',
    enum_declaration: 'enum',
    // Python
    function_definition: 'function',
    class_definition: 'class',
    // Go
    function_declaration_go: 'function',
    method_declaration: 'method',
    type_declaration: 'type_alias',
    // Rust
    function_item: 'function',
    impl_item: 'class',
    struct_item: 'struct',
    trait_item: 'trait',
    enum_item: 'enum',
    // Java / C#
    constructor_declaration: 'method',
    // Generic
    module: 'module',
    namespace_declaration: 'namespace',
  };
  return map[type] ?? null;
}

function extractName(node: any, source: string, _lang: Language): string | null {
  // Look for a 'name' or 'identifier' child
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type === 'identifier' || child.type === 'property_identifier' || child.type === 'type_identifier') {
      return source.slice(child.startIndex, child.endIndex);
    }
  }
  return null;
}

function extractSignature(node: any, source: string): string | undefined {
  // Grab first line as signature approximation
  const text = source.slice(node.startIndex, node.endIndex);
  const firstLine = text.split('\n')[0].trim();
  return firstLine.length > 120 ? firstLine.slice(0, 120) + '…' : firstLine;
}

/**
 * Extract a docstring by walking previousNamedSibling through comment nodes.
 */
function extractDocstring(node: any, source: string): string | undefined {
  const commentTypes = new Set(['comment', 'block_comment', 'line_comment', 'documentation_comment']);
  const commentLines: string[] = [];

  let sibling = node.previousNamedSibling;
  while (sibling && commentTypes.has(sibling.type)) {
    commentLines.unshift(source.slice(sibling.startIndex, sibling.endIndex));
    sibling = sibling.previousNamedSibling;
  }

  if (commentLines.length === 0) return undefined;

  const cleaned = commentLines.join('\n')
    .replace(/^\/\*+\s*/gm, '')
    .replace(/\s*\*+\/\s*$/gm, '')
    .replace(/^\s*\*\s?/gm, '')
    .replace(/^\/\/\s?/gm, '')
    .trim();

  return cleaned.length > 0 ? cleaned : undefined;
}

function isExported(node: any, source: string): boolean {
  // Walk up to check for export_statement ancestor
  let current = node.parent;
  while (current) {
    if (current.type === 'export_statement') return true;
    current = current.parent;
  }
  // Fallback: check if first token is 'export'
  const text = source.slice(node.startIndex, Math.min(node.startIndex + 20, node.endIndex));
  return text.startsWith('export');
}

function isAsync(node: any): boolean {
  for (let i = 0; i < node.childCount; i++) {
    if (node.child(i).type === 'async') return true;
  }
  return false;
}

function isStatic(node: any): boolean {
  for (let i = 0; i < node.childCount; i++) {
    if (node.child(i).type === 'static') return true;
  }
  return false;
}

/**
 * Collect call expressions within a node as unresolved references.
 * Uses only the final segment of dotted names (e.g., "a.b.c" → "c").
 */
function collectCalls(node: any, source: string, sourceId: string, unresolvedCalls: UnresolvedCall[]): void {
  findCallExpressions(node, source, sourceId, unresolvedCalls);
}

function findCallExpressions(node: any, source: string, sourceId: string, unresolvedCalls: UnresolvedCall[]): void {
  if (node.type === 'call_expression') {
    const funcNode = node.child(0);
    if (funcNode) {
      const rawName = source.slice(funcNode.startIndex, funcNode.endIndex).split('(')[0].trim();
      if (rawName && rawName.length < 100) {
        // Use only the final segment of dotted/chained names
        const calleeName = rawName.split('.').pop()!.trim();
        if (calleeName && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(calleeName)) {
          unresolvedCalls.push({
            sourceId,
            calleeName,
            line: node.startPosition.row + 1,
            column: node.startPosition.column,
          });
        }
      }
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    findCallExpressions(node.child(i), source, sourceId, unresolvedCalls);
  }
}
