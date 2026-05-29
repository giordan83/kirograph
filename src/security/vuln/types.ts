/**
 * Shared types for the vulnerability database subsystem.
 */

import type { CVERecord } from '../types';

/**
 * Adapter interface for querying a vulnerability database.
 * Each supported database (OSV, NVD, etc.) implements this interface.
 */
export interface VulnDatabaseAdapter {
  /** Human-readable name of the database (e.g. "OSV") */
  name: string;

  /**
   * Query for vulnerabilities affecting a specific package version.
   *
   * @param ecosystem - Package ecosystem (npm, maven, go, pypi, cargo)
   * @param packageName - Package name
   * @param version - Resolved version string
   * @param signal - Optional AbortSignal for timeout/cancellation
   * @returns Array of CVE records matching the query
   */
  query(
    ecosystem: string,
    packageName: string,
    version: string,
    signal?: AbortSignal,
  ): Promise<CVERecord[]>;
}
