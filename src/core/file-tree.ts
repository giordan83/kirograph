/**
 * File tree builder — constructs a navigable directory tree from flat FileRecord list.
 */

import type { FileRecord } from '../types';

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  language?: string;
  symbolCount?: number;
  children?: FileTreeNode[];
}

export type FileTree = FileTreeNode[];

export function buildFileTree(files: FileRecord[], maxDepth?: number): FileTree {
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
          currentMap.set(part, {
            name: part, path: currentPath, type: 'file',
            language: file.language, symbolCount: file.symbolCount,
          });
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
