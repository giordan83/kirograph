/**
 * KiroGraph-Sec Secrets Scanner
 *
 * Regex-based secret detection that scans source files and enriches findings
 * with call graph context (containing function + reachability from entry points).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { GraphDatabase } from '../db/database';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SecretFinding {
  filePath: string;
  line: number;
  column: number;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Redacted: first 4 chars of the matched value + "****" */
  snippet: string;
  nodeId?: string;
  nodeName?: string;
  reachableFromEntryPoints: string[];
  entryPointCount: number;
}

export interface SecretsResult {
  findings: SecretFinding[];
  filesScanned: number;
  totalFindings: number;
  criticalCount: number;
  highCount: number;
}

// ── Secret patterns ───────────────────────────────────────────────────────────

interface SecretPattern {
  name: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  pattern: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { name: 'AWS Access Key ID',       severity: 'critical', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'AWS Secret Access Key',   severity: 'critical', pattern: /aws[_\-]secret[_\-]?(access[_\-]?)?key\s*[=:]\s*["']?([A-Za-z0-9\/+=]{40})["']?/i },
  { name: 'GitHub Token',            severity: 'critical', pattern: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'Stripe Secret Key',       severity: 'critical', pattern: /sk_(live|test)_[A-Za-z0-9]{24,}/ },
  { name: 'Stripe Publishable Key',  severity: 'high',     pattern: /pk_(live|test)_[A-Za-z0-9]{24,}/ },
  { name: 'SendGrid API Key',        severity: 'critical', pattern: /SG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}/ },
  { name: 'Twilio Account SID',      severity: 'high',     pattern: /AC[a-z0-9]{32}/ },
  { name: 'Slack Token',             severity: 'high',     pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Private Key (PEM)',       severity: 'critical', pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'JWT Token (hardcoded)',   severity: 'high',     pattern: /eyJ[A-Za-z0-9+\/]{20,}\.[A-Za-z0-9+\/]{20,}\.[A-Za-z0-9+\/\-_]{20,}/ },
  { name: 'Generic API Key',         severity: 'medium',   pattern: /api[_\-]?key\s*[=:]\s*["']([A-Za-z0-9_\-]{20,})["']/i },
  { name: 'Generic Secret',          severity: 'medium',   pattern: /(?:secret|password|passwd|pwd)\s*[=:]\s*["']([^"'\s]{8,})["']/i },
  { name: 'Bearer Token',            severity: 'medium',   pattern: /bearer\s+[A-Za-z0-9+\/=]{20,}/i },
  { name: 'Database URL',            severity: 'high',     pattern: /(postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@[^\/\s]+/ },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const SKIP_DIRS = ['node_modules', '.kirograph', 'dist', 'build'];
const TEST_PATTERNS = [
  /\.test\.[tj]sx?$/,
  /\.spec\.[tj]sx?$/,
  /\/__tests__\//,
  /\/test\//,
  /\/tests\//,
];

function isTestFile(filePath: string): boolean {
  return TEST_PATTERNS.some(p => p.test(filePath));
}

function shouldSkipPath(filePath: string): boolean {
  const parts = filePath.split(path.sep);
  return parts.some(p => SKIP_DIRS.includes(p));
}

/**
 * Redact a matched string: show only the first 4 characters followed by "****".
 * If the match is shorter than 4 chars, show all of it + "****".
 */
function redact(value: string): string {
  if (value.length <= 4) return value + '****';
  return value.slice(0, 4) + '****';
}

// ── SecretsScanner ────────────────────────────────────────────────────────────

export class SecretsScanner {
  constructor(
    private readonly db: GraphDatabase,
    private readonly projectRoot: string,
  ) {}

  async scan(options?: { includeTests?: boolean }): Promise<SecretsResult> {
    const rawDb = this.db.getRawDb();
    const includeTests = options?.includeTests ?? false;

    // 1. Collect all indexed files
    const fileRows: Array<{ path: string }> = rawDb.all(`SELECT path FROM files`);

    const findings: SecretFinding[] = [];
    let filesScanned = 0;

    for (const { path: relOrAbsPath } of fileRows) {
      // Resolve to absolute path
      const absPath = path.isAbsolute(relOrAbsPath)
        ? relOrAbsPath
        : path.join(this.projectRoot, relOrAbsPath);

      // Skip paths in blacklisted dirs
      if (shouldSkipPath(absPath)) continue;

      // Skip test files unless opted-in
      if (!includeTests && isTestFile(absPath)) continue;

      // Read file content
      let content: string;
      try {
        content = fs.readFileSync(absPath, 'utf8');
      } catch {
        // File might have been deleted since indexing — skip silently
        continue;
      }

      filesScanned++;
      const lines = content.split('\n');

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const lineText = lines[lineIdx];
        const lineNumber = lineIdx + 1;

        for (const { name, severity, pattern } of SECRET_PATTERNS) {
          // Clone regex to reset lastIndex between calls
          const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
          let match: RegExpExecArray | null;

          while ((match = re.exec(lineText)) !== null) {
            const matchedValue = match[0];
            const column = match.index + 1;

            // Enrich with graph context
            const { nodeId, nodeName } = this.findContainingNode(rawDb, absPath, lineNumber);
            const entryPoints = nodeId
              ? this.findEntryPoints(rawDb, nodeId)
              : [];

            findings.push({
              filePath: absPath,
              line: lineNumber,
              column,
              type: name,
              severity,
              snippet: redact(matchedValue),
              nodeId,
              nodeName,
              reachableFromEntryPoints: entryPoints,
              entryPointCount: entryPoints.length,
            });

            // Avoid infinite loops on zero-width matches
            if (match[0].length === 0) re.lastIndex++;
          }
        }
      }
    }

    const criticalCount = findings.filter(f => f.severity === 'critical').length;
    const highCount = findings.filter(f => f.severity === 'high').length;

    // Sort: critical first, then high, then by file path + line
    findings.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const diff = severityOrder[a.severity] - severityOrder[b.severity];
      if (diff !== 0) return diff;
      if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
      return a.line - b.line;
    });

    return {
      findings,
      filesScanned,
      totalFindings: findings.length,
      criticalCount,
      highCount,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private findContainingNode(
    rawDb: any,
    filePath: string,
    line: number,
  ): { nodeId?: string; nodeName?: string } {
    const row: { id: string; name: string } | undefined = rawDb.get(
      `SELECT id, name FROM nodes
       WHERE file_path = ? AND start_line <= ? AND end_line >= ?
         AND kind IN ('function', 'method')
       ORDER BY (end_line - start_line) ASC
       LIMIT 1`,
      [filePath, line, line],
    );

    if (!row) return {};
    return { nodeId: row.id, nodeName: row.name };
  }

  private findEntryPoints(rawDb: any, nodeId: string): string[] {
    const rows: Array<{ id: string; name: string }> = rawDb.all(
      `WITH RECURSIVE callers(node_id, depth) AS (
         SELECT source, 1 FROM edges WHERE target = ? AND kind = 'calls'
         UNION
         SELECT e.source, c.depth + 1
         FROM edges e
         JOIN callers c ON e.target = c.node_id
         WHERE c.depth < 5 AND e.kind = 'calls'
       )
       SELECT DISTINCT n.id, n.name
       FROM callers c
       JOIN nodes n ON n.id = c.node_id
       WHERE n.kind IN ('route', 'function')
         AND (n.name LIKE '%route%' OR n.name LIKE '%handler%' OR n.name LIKE '%controller%')`,
      [nodeId],
    );

    return rows.map(r => r.id);
  }
}
