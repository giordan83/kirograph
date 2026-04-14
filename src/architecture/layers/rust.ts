/**
 * Layer detector for Rust projects.
 */
import type { LayerDetector, ArchLayerMatch } from '../types';
import picomatch from 'picomatch';

const LAYER_PATTERNS: Array<[string, string, number]> = [
  ['api', '**/handlers/**', 0.9],
  ['api', '**/routes/**', 0.9],
  ['api', '**/*_handler.rs', 0.9],
  ['api', '**/*_route.rs', 0.85],
  ['service', '**/services/**', 0.9],
  ['service', '**/service/**', 0.9],
  ['service', '**/*_service.rs', 0.9],
  ['service', '**/domain/**', 0.8],
  ['data', '**/models/**', 0.85],
  ['data', '**/repositories/**', 0.9],
  ['data', '**/*_repository.rs', 0.9],
  ['data', '**/db/**', 0.85],
  ['data', '**/schema.rs', 0.85],
  ['data', '**/migrations/**', 0.85],
  ['shared', '**/utils/**', 0.85],
  ['shared', '**/common/**', 0.8],
  ['shared', '**/config/**', 0.8],
  ['shared', '**/errors.rs', 0.75],
  ['shared', '**/error.rs', 0.75],
];

export const rustLayerDetector: LayerDetector = {
  language: 'rust',

  async detect(files: string[], _projectRoot: string, configLayers?: Record<string, string[]>): Promise<ArchLayerMatch[]> {
    const results: ArchLayerMatch[] = [];
    const configMatchers = _buildConfigMatchers(configLayers ?? {});

    for (const file of files) {
      if (!file.endsWith('.rs')) continue;
      const configMatch = _matchConfig(file, configMatchers);
      if (configMatch) { results.push({ ...configMatch, filePath: file }); continue; }

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
function _matchConfig(file: string, matchers: Array<[string, ReturnType<typeof picomatch>, string]>): Omit<ArchLayerMatch, 'filePath'> | null {
  for (const [layerName, matcher, pattern] of matchers) {
    if (matcher(file)) return { layerName, confidence: 1.0, matchedPattern: `config:${pattern}` };
  }
  return null;
}
