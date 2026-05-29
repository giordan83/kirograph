/**
 * KiroGraph-Sec Error Classes
 *
 * Security-specific error types extending the base KiroGraphError.
 */

import { KiroGraphError } from '../errors';

export class SecurityError extends KiroGraphError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'SECURITY_ERROR', context);
    this.name = 'SecurityError';
  }
}

export class ManifestParseError extends KiroGraphError {
  constructor(message: string, filePath: string, line?: number) {
    super(message, 'MANIFEST_PARSE_ERROR', { filePath, line });
    this.name = 'ManifestParseError';
  }
}

export class VulnDatabaseError extends KiroGraphError {
  constructor(message: string, database: string, httpStatus?: number) {
    super(message, 'VULN_DATABASE_ERROR', { database, httpStatus });
    this.name = 'VulnDatabaseError';
  }
}
