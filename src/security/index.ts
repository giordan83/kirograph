/**
 * KiroGraph-Sec Module Index
 *
 * Exports all public interfaces, classes, and types for the security module.
 * Used by MCP tools, CLI commands, and pipeline integration.
 */

// ── Pipeline ──────────────────────────────────────────────────────────────────
export { SecurityPipeline } from './pipeline';

// ── Manifest Parsing ──────────────────────────────────────────────────────────
export { ManifestParser } from './manifest/parser';

// ── Dependency Graph Integration ──────────────────────────────────────────────
export { DependencyGraphIntegrator } from './integrator';

// ── Vulnerability Database ────────────────────────────────────────────────────
export { VulnerabilityDatabaseClient } from './vuln/client';
export { OsvAdapter } from './vuln/osv-adapter';
export type { VulnDatabaseAdapter } from './vuln/types';

// ── Reachability Analysis ─────────────────────────────────────────────────────
export { ReachabilityAnalyzer } from './reachability';

// ── Export (SBOM / VEX) ───────────────────────────────────────────────────────
export { SBOMExporter } from './export/sbom';
export { VEXExporter } from './export/vex';
export { buildFixSuggestion, formatFixSuggestion } from './export/fix-suggestions';

// ── Context Warnings ──────────────────────────────────────────────────────────
export { getSecurityWarningsForNodes, formatSecurityWarnings } from './context-warnings';
export type { SecurityWarning } from './context-warnings';

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  ParsedDependency,
  ManifestParseResult,
  IntegrationResult,
  TransitiveResult,
  CleanupResult,
  CVERecord,
  VersionRange,
  EnrichmentResult,
  ReachabilityVerdict,
  ReachabilityPath,
  ReachabilityResult,
  ImpactSummary,
  SecurityResult,
  SBOMMetadata,
  CycloneDXSBOM,
  CycloneDXComponent,
  CycloneDXDependencyEntry,
  CycloneDXVEX,
  CycloneDXVulnerability,
} from './types';

// ── Errors ────────────────────────────────────────────────────────────────────
export { SecurityError, ManifestParseError, VulnDatabaseError } from './errors';
