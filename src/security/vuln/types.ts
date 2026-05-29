/**
 * Shared types for the vulnerability database subsystem.
 */

import type { CVERecord } from '../types';

/** A single entry in a batch vulnerability query. */
export interface BatchQuery {
  ecosystem: string;
  packageName: string;
  version: string;
}

/**
 * Adapter interface for querying a vulnerability database.
 * Each supported database (OSV, NVD, etc.) implements this interface.
 */
export interface VulnDatabaseAdapter {
  /** Human-readable name of the database (e.g. "OSV") */
  name: string;

  /**
   * Query for vulnerabilities affecting a specific package version.
   */
  query(
    ecosystem: string,
    packageName: string,
    version: string,
    signal?: AbortSignal,
  ): Promise<CVERecord[]>;

  /**
   * Batch query — results[i] corresponds to queries[i].
   * Implementing this is optional but strongly recommended for performance:
   * a single HTTP request replaces N sequential requests.
   */
  queryBatch?(
    queries: BatchQuery[],
    signal?: AbortSignal,
  ): Promise<Array<CVERecord[]>>;
}
