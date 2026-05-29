/**
 * License Compliance Checker for KiroGraph-Sec
 *
 * Checks project dependencies against a license policy (deny/warn lists).
 * Supports case-insensitive matching and wildcard patterns (e.g. GPL-* matches
 * GPL-2.0, GPL-3.0-only, etc.).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LicenseViolation {
  packageName: string;
  ecosystem: string;
  license: string;
  severity: 'deny' | 'warn';
}

// ── Wildcard matching ─────────────────────────────────────────────────────────

/**
 * Test whether a license string matches a policy pattern.
 * Matching is case-insensitive. The pattern may contain `*` as a wildcard
 * (matches any sequence of characters).
 */
function matchesPattern(license: string, pattern: string): boolean {
  const lowerLicense = license.toLowerCase();
  const lowerPattern = pattern.toLowerCase();

  if (!lowerPattern.includes('*')) {
    return lowerLicense === lowerPattern;
  }

  // Convert wildcard pattern to regex
  // Escape regex special chars except *, then replace * with .*
  const regexStr = lowerPattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(lowerLicense);
}

/**
 * Test whether a license matches any pattern in the list.
 */
function matchesAny(license: string, patterns: string[]): boolean {
  return patterns.some(p => matchesPattern(license, p));
}

// ── Main check function ───────────────────────────────────────────────────────

/**
 * Check a list of dependencies against a license policy.
 *
 * Dependencies with no license are skipped (no violation).
 * A license matched in `deny` produces a 'deny' violation.
 * A license matched in `warn` (and not in `deny`) produces a 'warn' violation.
 *
 * @param deps - Array of dependency rows from sec_dependencies
 * @param policy - The license policy with deny and warn lists
 * @returns Array of violations sorted by severity (deny first) then package name
 */
export function checkLicensePolicy(
  deps: Array<{ package_name: string; ecosystem: string; license: string | null }>,
  policy: { deny: string[]; warn: string[] },
): LicenseViolation[] {
  const violations: LicenseViolation[] = [];

  for (const dep of deps) {
    if (!dep.license) continue;

    const license = dep.license;

    if (policy.deny.length > 0 && matchesAny(license, policy.deny)) {
      violations.push({
        packageName: dep.package_name,
        ecosystem: dep.ecosystem,
        license,
        severity: 'deny',
      });
    } else if (policy.warn.length > 0 && matchesAny(license, policy.warn)) {
      violations.push({
        packageName: dep.package_name,
        ecosystem: dep.ecosystem,
        license,
        severity: 'warn',
      });
    }
  }

  // Sort: deny first, then warn; within each group sort by package name
  violations.sort((a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === 'deny' ? -1 : 1;
    }
    return a.packageName.localeCompare(b.packageName);
  });

  return violations;
}
