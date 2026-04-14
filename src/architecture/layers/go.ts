/**
 * Layer detector for Go projects.
 * Detects patterns common in Go service layouts (standard, Clean Architecture, DDD).
 */
import type { LayerDetector, ArchLayerMatch } from '../types';
import picomatch from 'picomatch';

const LAYER_PATTERNS: Array<[string, string, number]> = [
  // API layer (cmd = entry points, handler = HTTP handlers)
  ['api', '**/cmd/**', 0.85],
  ['api', '**/handler/**', 0.9],
  ['api', '**/handlers/**', 0.9],
  ['api', '**/*_handler.go', 0.9],
  ['api', '**/delivery/**', 0.85],
  ['api', '**/transport/**', 0.85],
  ['api', '**/http/**', 0.85],
  ['api', '**/grpc/**', 0.85],
  ['api', '**/api/**', 0.8],

  // Service layer
  ['service', '**/service/**', 0.9],
  ['service', '**/services/**', 0.9],
  ['service', '**/*_service.go', 0.9],
  ['service', '**/usecase/**', 0.9],
  ['service', '**/usecases/**', 0.9],
  ['service', '**/domain/**', 0.8],
  ['service', '**/business/**', 0.85],

  // Data layer
  ['data', '**/repository/**', 0.9],
  ['data', '**/repositories/**', 0.9],
  ['data', '**/*_repository.go', 0.9],
  ['data', '**/*_repo.go', 0.9],
  ['data', '**/store/**', 0.85],
  ['data', '**/storage/**', 0.85],
  ['data', '**/db/**', 0.85],
  ['data', '**/models/**', 0.8],
  ['data', '**/entities/**', 0.8],
  ['data', '**/migrations/**', 0.85],

  // Shared / infrastructure layer
  ['shared', '**/pkg/**', 0.8],
  ['shared', '**/internal/**', 0.75],
  ['shared', '**/util/**', 0.85],
  ['shared', '**/utils/**', 0.85],
  ['shared', '**/common/**', 0.8],
  ['shared', '**/config/**', 0.8],
  ['shared', '**/middleware/**', 0.85],
  ['shared', '**/logger/**', 0.8],
];

export const goLayerDetector: LayerDetector = {
  language: 'go',

  async detect(files: string[], _projectRoot: string, configLayers?: Record<string, string[]>): Promise<ArchLayerMatch[]> {
    const results: ArchLayerMatch[] = [];
    const configMatchers = _buildConfigMatchers(configLayers ?? {});

    for (const file of files) {
      if (!file.endsWith('.go')) continue;

      const configMatch = _matchConfig(file, configMatchers);
      if (configMatch) {
        results.push({ ...configMatch, filePath: file });
        continue;
      }

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
  return Object.entries(configLayers).flatMap(([layerName, patterns]) =>
    patterns.map((pattern): [string, ReturnType<typeof picomatch>, string] =>
      [layerName, picomatch(pattern), pattern]
    )
  );
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
