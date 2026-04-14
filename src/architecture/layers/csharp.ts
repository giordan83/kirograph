/**
 * Layer detector for C# / .NET projects.
 */
import type { LayerDetector, ArchLayerMatch } from '../types';
import picomatch from 'picomatch';

const LAYER_PATTERNS: Array<[string, string, number]> = [
  ['api', '**/Controllers/**', 0.95],
  ['api', '**/*Controller.cs', 0.95],
  ['api', '**/Endpoints/**', 0.9],
  ['api', '**/MinimalApis/**', 0.9],
  ['service', '**/Services/**', 0.9],
  ['service', '**/*Service.cs', 0.9],
  ['service', '**/Application/**', 0.8],
  ['service', '**/UseCases/**', 0.85],
  ['data', '**/Repositories/**', 0.95],
  ['data', '**/*Repository.cs', 0.95],
  ['data', '**/Data/**', 0.85],
  ['data', '**/Entities/**', 0.9],
  ['data', '**/Models/**', 0.8],
  ['data', '**/Migrations/**', 0.9],
  ['ui', '**/Views/**', 0.9],
  ['ui', '**/Pages/**', 0.9],
  ['shared', '**/Helpers/**', 0.85],
  ['shared', '**/Extensions/**', 0.8],
  ['shared', '**/Common/**', 0.8],
  ['shared', '**/Infrastructure/**', 0.8],
  ['shared', '**/Middleware/**', 0.85],
];

export const csharpLayerDetector: LayerDetector = {
  language: 'csharp',

  async detect(files: string[], _projectRoot: string, configLayers?: Record<string, string[]>): Promise<ArchLayerMatch[]> {
    const results: ArchLayerMatch[] = [];
    const configMatchers = _buildConfigMatchers(configLayers ?? {});

    for (const file of files) {
      if (!file.endsWith('.cs')) continue;
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
