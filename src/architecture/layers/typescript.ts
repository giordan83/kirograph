/**
 * Layer detector for TypeScript / JavaScript / TSX / JSX projects.
 *
 * Detects: api, service, data, ui, shared layers based on
 * directory names and file naming conventions common in TS/JS projects.
 */
import type { LayerDetector, ArchLayerMatch } from '../types';
import picomatch from 'picomatch';

// Pattern definitions: each entry is [layerName, glob, confidence]
const LAYER_PATTERNS: Array<[string, string, number]> = [
  // API / Controller layer
  ['api', '**/routes/**', 0.9],
  ['api', '**/controllers/**', 0.9],
  ['api', '**/handlers/**', 0.85],
  ['api', '**/*.route.ts', 0.9],
  ['api', '**/*.route.js', 0.9],
  ['api', '**/*.controller.ts', 0.9],
  ['api', '**/*.controller.js', 0.9],
  ['api', '**/*.handler.ts', 0.85],
  ['api', '**/api/**', 0.75],
  ['api', '**/endpoints/**', 0.85],

  // Service / Business logic layer
  ['service', '**/services/**', 0.9],
  ['service', '**/*.service.ts', 0.9],
  ['service', '**/*.service.js', 0.9],
  ['service', '**/usecases/**', 0.85],
  ['service', '**/use-cases/**', 0.85],
  ['service', '**/interactors/**', 0.8],
  ['service', '**/domain/**', 0.8],

  // Data / Repository layer
  ['data', '**/repositories/**', 0.9],
  ['data', '**/repository/**', 0.9],
  ['data', '**/models/**', 0.85],
  ['data', '**/entities/**', 0.85],
  ['data', '**/dao/**', 0.9],
  ['data', '**/store/**', 0.8],
  ['data', '**/*.repository.ts', 0.9],
  ['data', '**/*.repository.js', 0.9],
  ['data', '**/*.model.ts', 0.85],
  ['data', '**/*.model.js', 0.85],
  ['data', '**/*.entity.ts', 0.85],
  ['data', '**/db/**', 0.8],
  ['data', '**/database/**', 0.8],
  ['data', '**/migrations/**', 0.85],
  ['data', '**/schema/**', 0.8],

  // UI / Frontend layer
  ['ui', '**/components/**', 0.9],
  ['ui', '**/pages/**', 0.9],
  ['ui', '**/views/**', 0.85],
  ['ui', '**/screens/**', 0.9],
  ['ui', '**/layouts/**', 0.85],
  ['ui', '**/*.component.ts', 0.9],
  ['ui', '**/*.component.tsx', 0.9],
  ['ui', '**/*.page.tsx', 0.9],
  ['ui', '**/*.screen.tsx', 0.9],
  ['ui', '**/ui/**', 0.8],

  // Shared / Infrastructure layer
  ['shared', '**/utils/**', 0.85],
  ['shared', '**/helpers/**', 0.85],
  ['shared', '**/lib/**', 0.8],
  ['shared', '**/common/**', 0.8],
  ['shared', '**/shared/**', 0.85],
  ['shared', '**/constants/**', 0.8],
  ['shared', '**/config/**', 0.8],
  ['shared', '**/middleware/**', 0.8],
  ['shared', '**/plugins/**', 0.75],
  ['shared', '**/hooks/**', 0.8],
  ['shared', '**/*.util.ts', 0.85],
  ['shared', '**/*.util.js', 0.85],
  ['shared', '**/*.helper.ts', 0.85],
];

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.svelte']);

export const typescriptLayerDetector: LayerDetector = {
  language: 'typescript',

  async detect(files: string[], _projectRoot: string, configLayers?: Record<string, string[]>): Promise<ArchLayerMatch[]> {
    const results: ArchLayerMatch[] = [];

    // Config-defined layers override auto-detection for matching files
    const configMatchers = _buildConfigMatchers(configLayers ?? {});

    for (const file of files) {
      const ext = file.slice(file.lastIndexOf('.'));
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

      // Check config layers first (they win)
      const configMatch = _matchConfig(file, configMatchers);
      if (configMatch) {
        results.push({ ...configMatch, filePath: file });
        continue;
      }

      // Auto-detect
      let best: ArchLayerMatch | null = null;
      for (const [layerName, pattern, confidence] of LAYER_PATTERNS) {
        if (picomatch(pattern)(file)) {
          if (!best || confidence > best.confidence) {
            best = { layerName, filePath: file, confidence, matchedPattern: pattern };
          }
        }
      }
      if (best) results.push(best);
    }

    return results;
  },
};

function _buildConfigMatchers(configLayers: Record<string, string[]>): Array<[string, ReturnType<typeof picomatch>, string]> {
  const matchers: Array<[string, ReturnType<typeof picomatch>, string]> = [];
  for (const [layerName, patterns] of Object.entries(configLayers)) {
    for (const pattern of patterns) {
      matchers.push([layerName, picomatch(pattern), pattern]);
    }
  }
  return matchers;
}

function _matchConfig(
  file: string,
  matchers: Array<[string, ReturnType<typeof picomatch>, string]>
): Omit<ArchLayerMatch, 'filePath'> | null {
  for (const [layerName, matcher, pattern] of matchers) {
    if (matcher(file)) return { layerName, confidence: 1.0, matchedPattern: `config:${pattern}` };
  }
  return null;
}
