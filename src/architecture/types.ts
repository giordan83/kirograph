/**
 * Architecture Analysis Types
 *
 * These types model the higher-level software architecture layer:
 * packages (logical groupings of files) and layers (architectural tiers).
 * All populated only when enableArchitecture=true in config.
 */

export interface ArchPackage {
  id: string;           // e.g. "pkg:npm:my-lib" or "pkg:dir:src/auth"
  name: string;         // display name
  path: string;         // relative directory path within the project
  source: 'manifest' | 'directory';
  language?: string;    // primary language
  manifestPath?: string; // relative path to manifest file
  version?: string;
  externalDeps?: string[]; // declared external dependency names
  metadata?: Record<string, unknown>;
  updatedAt: number;
}

export interface ArchLayer {
  id: string;           // e.g. "layer:api"
  name: string;         // "api" | "service" | "data" | "ui" | "shared"
  source: 'auto' | 'config';
  patterns: string[];   // glob patterns that caused this layer to be detected
  metadata?: Record<string, unknown>;
  updatedAt: number;
}

export interface ArchPackageDep {
  sourcePkg: string;
  targetPkg: string;
  depCount: number;
  files?: Array<{ from: string; to: string }>;
}

export interface ArchLayerDep {
  sourceLayer: string;
  targetLayer: string;
  depCount: number;
}

export interface ArchCoupling {
  packageId: string;
  afferent: number;    // Ca: packages that depend on this package
  efferent: number;    // Ce: packages this package depends on
  instability: number; // Ce / (Ca + Ce), 0 = maximally stable, 1 = maximally unstable
  updatedAt: number;
}

export interface ArchitectureResult {
  packages: ArchPackage[];
  layers: ArchLayer[];
  packageDeps: ArchPackageDep[];
  layerDeps: ArchLayerDep[];
  coupling: ArchCoupling[];
  filePackages: Record<string, string[]>; // filePath → packageIds
  fileLayers: Record<string, Array<{ layerId: string; confidence: number; matchedPattern: string }>>;
}

// ── Manifest Parser Interface ─────────────────────────────────────────────────

export interface ManifestParser {
  /** Unique name for this parser (e.g. "npm", "go", "cargo") */
  name: string;
  /** Manifest filenames this parser handles (e.g. ["package.json"]) */
  manifestFiles: string[];
  /** Primary language for packages detected by this parser */
  language: string;
  /** Returns true if this parser can handle the given manifest file path */
  canParse(manifestPath: string): boolean;
  /** Parse one manifest file and return the package(s) it defines */
  parse(manifestPath: string, projectRoot: string): Promise<ArchPackage[]>;
}

// ── Layer Detector Interface ──────────────────────────────────────────────────

export interface LayerDetector {
  /** Language this detector applies to, or 'any' for universal detectors */
  language: string;
  /** Optional framework specificity (e.g. "django", "rails") */
  framework?: string;
  /**
   * Given all indexed file paths (relative to project root), return
   * layer matches for files this detector recognises.
   */
  detect(files: string[], projectRoot: string, configLayers?: Record<string, string[]>): Promise<ArchLayerMatch[]>;
}

export interface ArchLayerMatch {
  layerName: string;       // e.g. 'api', 'service', 'data', 'ui', 'shared'
  filePath: string;        // relative file path
  confidence: number;      // 0.0–1.0
  matchedPattern: string;  // the pattern that triggered this match
}
