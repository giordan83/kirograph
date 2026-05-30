/**
 * Remediation SLA Tracker
 *
 * Tracks how long open vulnerabilities have been known, when a fix became
 * available, and whether remediation is overdue based on severity-based SLA
 * thresholds.
 *
 * SLA thresholds:
 *   critical (CVSS ≥ 9)  → 7 days
 *   high     (CVSS ≥ 7)  → 30 days
 *   medium   (CVSS ≥ 4)  → 90 days
 *   low / unknown        → 180 days
 */

import type { GraphDatabase } from '../db/database';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RemediationStatus {
  cveId: string;
  packageName: string;
  severity: number | null;
  riskScore: number | null;
  firstDetectedAt: number | null;
  daysOpen: number | null;
  fixAvailableSince: number | null;
  daysWithFixAvailable: number | null;
  isOverdue: boolean;
  slaStatus: 'ok' | 'warning' | 'overdue' | 'no_fix';
  slaDeadline: number | null;   // epoch ms
}

// ── RemediationTracker ────────────────────────────────────────────────────────

export class RemediationTracker {
  constructor(private readonly db: GraphDatabase) {}

  /**
   * Called when a vulnerability is first inserted.
   * Sets first_detected_at if not already set, and fix_available_since if a
   * fixed_version is provided and fix_available_since is not yet recorded.
   */
  markDetected(vulnNodeId: string, fixedVersion: string | null): void {
    const rawDb = this.db.getRawDb();
    const now = Date.now();

    // Set first_detected_at only if not already set
    rawDb.run(
      `UPDATE sec_vulnerabilities
       SET first_detected_at = COALESCE(first_detected_at, ?)
       WHERE node_id = ?`,
      [now, vulnNodeId],
    );

    // Set fix_available_since if a fix is known and not yet recorded
    if (fixedVersion) {
      rawDb.run(
        `UPDATE sec_vulnerabilities
         SET fix_available_since = COALESCE(fix_available_since, ?)
         WHERE node_id = ? AND fixed_version IS NOT NULL`,
        [now, vulnNodeId],
      );
    }
  }

  /**
   * Get remediation status for all open (non-remediated, non-suppressed)
   * vulnerabilities that have been detected.
   */
  getStatus(): RemediationStatus[] {
    const rawDb = this.db.getRawDb();
    const now = Date.now();

    const rows: Array<{
      node_id: string;
      cve_id: string;
      severity_score: number | null;
      risk_score: number | null;
      fixed_version: string | null;
      first_detected_at: number | null;
      fix_available_since: number | null;
      suppressed_at: number | null;
      remediated_at: number | null;
      package_name: string | null;
    }> = rawDb.all(
      `SELECT v.node_id, v.cve_id, v.severity_score, v.risk_score,
              v.fixed_version, v.first_detected_at, v.fix_available_since,
              v.suppressed_at, v.remediated_at,
              d.package_name
       FROM sec_vulnerabilities v
       LEFT JOIN edges e ON e.target = v.node_id AND e.kind = 'has_vulnerability'
       LEFT JOIN sec_dependencies d ON d.node_id = e.source
       WHERE v.remediated_at IS NULL
         AND v.suppressed_at IS NULL
         AND v.first_detected_at IS NOT NULL`,
    );

    return rows.map(row => {
      const firstDetectedAt = row.first_detected_at;
      const daysOpen = firstDetectedAt !== null
        ? Math.floor((now - firstDetectedAt) / (1000 * 60 * 60 * 24))
        : null;

      const fixAvailableSince = row.fix_available_since;
      const daysWithFixAvailable = fixAvailableSince !== null
        ? Math.floor((now - fixAvailableSince) / (1000 * 60 * 60 * 24))
        : null;

      const slaThreshold = this.getSlaThresholdDays(row.severity_score);
      const slaDeadline = fixAvailableSince !== null
        ? fixAvailableSince + slaThreshold * 24 * 60 * 60 * 1000
        : firstDetectedAt !== null
          ? firstDetectedAt + slaThreshold * 24 * 60 * 60 * 1000
          : null;

      let slaStatus: RemediationStatus['slaStatus'];
      let isOverdue = false;

      if (!row.fixed_version && !fixAvailableSince) {
        slaStatus = 'no_fix';
        isOverdue = false;
      } else if (slaDeadline !== null && now > slaDeadline) {
        slaStatus = 'overdue';
        isOverdue = true;
      } else if (slaDeadline !== null && now > slaDeadline - slaThreshold * 0.5 * 24 * 60 * 60 * 1000) {
        // Over 50% of SLA elapsed
        slaStatus = 'warning';
        isOverdue = false;
      } else {
        slaStatus = 'ok';
        isOverdue = false;
      }

      return {
        cveId: row.cve_id,
        packageName: row.package_name ?? 'unknown',
        severity: row.severity_score,
        riskScore: row.risk_score,
        firstDetectedAt,
        daysOpen,
        fixAvailableSince,
        daysWithFixAvailable,
        isOverdue,
        slaStatus,
        slaDeadline,
      };
    });
  }

  /**
   * SLA thresholds by CVSS severity:
   *   critical (≥ 9)  → 7 days
   *   high (≥ 7)      → 30 days
   *   medium (≥ 4)    → 90 days
   *   low / unknown   → 180 days
   */
  getSlaThresholdDays(severity: number | null): number {
    if (severity === null) return 180;
    if (severity >= 9) return 7;
    if (severity >= 7) return 30;
    if (severity >= 4) return 90;
    return 180;
  }
}
