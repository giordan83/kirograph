/**
 * Layer detector for Ruby / Rails projects.
 */
import type { LayerDetector, ArchLayerMatch } from '../types';
import picomatch from 'picomatch';

const LAYER_PATTERNS: Array<[string, string, number]> = [
  ['api', '**/app/controllers/**', 0.95],
  ['api', '**/controllers/**', 0.9],
  ['api', '**/app/channels/**', 0.85],
  ['service', '**/app/services/**', 0.95],
  ['service', '**/services/**', 0.9],
  ['service', '**/app/jobs/**', 0.85],
  ['data', '**/app/models/**', 0.95],
  ['data', '**/models/**', 0.9],
  ['data', '**/db/migrate/**', 0.9],
  ['data', '**/db/**', 0.8],
  ['ui', '**/app/views/**', 0.95],
  ['ui', '**/views/**', 0.9],
  ['ui', '**/app/helpers/**', 0.8],
  ['shared', '**/app/mailers/**', 0.8],
  ['shared', '**/lib/**', 0.8],
  ['shared', '**/config/**', 0.75],
];

export const rubyLayerDetector: LayerDetector = {
  language: 'ruby',

  async detect(files: string[], _projectRoot: string, configLayers?: Record<string, string[]>): Promise<ArchLayerMatch[]> {
    const results: ArchLayerMatch[] = [];
    const configMatchers = _buildConfigMatchers(configLayers ?? {});

    for (const file of files) {
      if (!file.endsWith('.rb')) continue;

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
