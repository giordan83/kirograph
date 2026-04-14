/**
 * Layer detector for Python projects.
 * Detects patterns common in Django, Flask, FastAPI, and generic Python projects.
 */
import type { LayerDetector, ArchLayerMatch } from '../types';
import picomatch from 'picomatch';

const LAYER_PATTERNS: Array<[string, string, number]> = [
  // API layer
  ['api', '**/views.py', 0.9],
  ['api', '**/views/**', 0.9],
  ['api', '**/viewsets.py', 0.9],
  ['api', '**/urls.py', 0.85],
  ['api', '**/routers.py', 0.85],
  ['api', '**/endpoints/**', 0.9],
  ['api', '**/api/**', 0.8],

  // Service layer
  ['service', '**/services.py', 0.9],
  ['service', '**/services/**', 0.9],
  ['service', '**/tasks.py', 0.8],
  ['service', '**/tasks/**', 0.8],
  ['service', '**/use_cases/**', 0.85],
  ['service', '**/domain/**', 0.8],

  // Data layer
  ['data', '**/models.py', 0.9],
  ['data', '**/models/**', 0.9],
  ['data', '**/migrations/**', 0.85],
  ['data', '**/repositories/**', 0.9],
  ['data', '**/serializers.py', 0.8],
  ['data', '**/schemas.py', 0.8],
  ['data', '**/db/**', 0.8],

  // Shared layer
  ['shared', '**/utils.py', 0.85],
  ['shared', '**/utils/**', 0.85],
  ['shared', '**/helpers.py', 0.85],
  ['shared', '**/helpers/**', 0.85],
  ['shared', '**/common/**', 0.8],
  ['shared', '**/config/**', 0.8],
  ['shared', '**/settings.py', 0.75],
  ['shared', '**/middleware.py', 0.8],
];

export const pythonLayerDetector: LayerDetector = {
  language: 'python',

  async detect(files: string[], _projectRoot: string, configLayers?: Record<string, string[]>): Promise<ArchLayerMatch[]> {
    const results: ArchLayerMatch[] = [];
    const configMatchers = _buildConfigMatchers(configLayers ?? {});

    for (const file of files) {
      if (!file.endsWith('.py')) continue;

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
