/**
 * Layer detector for Java/Kotlin projects.
 * Detects Spring MVC / layered architecture patterns.
 */
import type { LayerDetector, ArchLayerMatch } from '../types';
import picomatch from 'picomatch';

const LAYER_PATTERNS: Array<[string, string, number]> = [
  // API layer
  ['api', '**/controller/**', 0.95],
  ['api', '**/controllers/**', 0.95],
  ['api', '**/*Controller.java', 0.95],
  ['api', '**/*Controller.kt', 0.95],
  ['api', '**/*Resource.java', 0.9],
  ['api', '**/rest/**', 0.85],
  ['api', '**/web/**', 0.8],
  ['api', '**/api/**', 0.8],

  // Service layer
  ['service', '**/service/**', 0.9],
  ['service', '**/services/**', 0.9],
  ['service', '**/*Service.java', 0.9],
  ['service', '**/*Service.kt', 0.9],
  ['service', '**/*ServiceImpl.java', 0.9],
  ['service', '**/usecase/**', 0.85],
  ['service', '**/domain/**', 0.8],

  // Data layer
  ['data', '**/repository/**', 0.95],
  ['data', '**/repositories/**', 0.95],
  ['data', '**/*Repository.java', 0.95],
  ['data', '**/*Repository.kt', 0.95],
  ['data', '**/*Dao.java', 0.9],
  ['data', '**/*Dao.kt', 0.9],
  ['data', '**/entity/**', 0.9],
  ['data', '**/entities/**', 0.9],
  ['data', '**/*Entity.java', 0.9],
  ['data', '**/model/**', 0.8],
  ['data', '**/models/**', 0.8],
  ['data', '**/persistence/**', 0.85],
  ['data', '**/migration/**', 0.85],

  // Shared / infrastructure
  ['shared', '**/util/**', 0.85],
  ['shared', '**/utils/**', 0.85],
  ['shared', '**/*Util.java', 0.85],
  ['shared', '**/common/**', 0.8],
  ['shared', '**/config/**', 0.8],
  ['shared', '**/*Config.java', 0.8],
  ['shared', '**/exception/**', 0.8],
  ['shared', '**/security/**', 0.8],
];

export const javaLayerDetector: LayerDetector = {
  language: 'java',

  async detect(files: string[], _projectRoot: string, configLayers?: Record<string, string[]>): Promise<ArchLayerMatch[]> {
    const results: ArchLayerMatch[] = [];
    const configMatchers = _buildConfigMatchers(configLayers ?? {});

    for (const file of files) {
      if (!file.endsWith('.java') && !file.endsWith('.kt')) continue;

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
