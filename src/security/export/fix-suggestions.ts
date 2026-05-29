/**
 * Fix Suggestion Builder
 *
 * Generates ecosystem-appropriate upgrade commands for vulnerabilities
 * that have a known fixed version. Reusable by CLI and MCP tools.
 */

/**
 * Build an ecosystem-appropriate fix suggestion command.
 *
 * @param ecosystem - The package ecosystem (npm, maven, go, pypi, cargo)
 * @param packageName - The package name (for maven: groupId:artifactId)
 * @param fixedVersion - The version that fixes the vulnerability
 * @returns A formatted fix command string, or empty string if ecosystem is unknown
 */
export function buildFixSuggestion(ecosystem: string, packageName: string, fixedVersion: string): string {
  switch (ecosystem.toLowerCase()) {
    case 'npm':
      return `npm install ${packageName}@${fixedVersion}`;
    case 'maven': {
      // Maven packageName is typically "groupId:artifactId"
      const parts = packageName.split(':');
      if (parts.length === 2) {
        return `Update ${parts[0]}:${parts[1]} to ${fixedVersion} in pom.xml`;
      }
      return `Update ${packageName} to ${fixedVersion} in pom.xml`;
    }
    case 'go':
    case 'golang':
      return `go get ${packageName}@v${fixedVersion}`;
    case 'pypi':
    case 'pip':
      return `pip install ${packageName}==${fixedVersion}`;
    case 'cargo':
      return `cargo update -p ${packageName} --precise ${fixedVersion}`;
    default:
      return `Upgrade ${packageName} to ${fixedVersion}`;
  }
}

/**
 * Format a fix suggestion line for display.
 * Returns the formatted line with the 💡 prefix, or empty string if no fixed version.
 */
export function formatFixSuggestion(ecosystem: string, packageName: string, fixedVersion: string | null | undefined): string {
  if (!fixedVersion) return '';
  const command = buildFixSuggestion(ecosystem, packageName, fixedVersion);
  return `💡 Fix: ${command}`;
}
