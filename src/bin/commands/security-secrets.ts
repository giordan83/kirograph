import { Command } from 'commander';
import * as path from 'path';
import { loadConfig } from '../../config';
import { dim, reset, violet, bold } from '../ui';

// ── Severity helpers ──────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return '\x1b[31m';
    case 'high':     return '\x1b[31m';
    case 'medium':   return '\x1b[33m';
    default:         return dim;
  }
}

function severityLabel(severity: string): string {
  return severity.toUpperCase().padEnd(8);
}

function fixSuggestion(type: string): string {
  if (type.includes('AWS')) return 'Rotate this key immediately and use environment variables or AWS IAM roles';
  if (type.includes('GitHub')) return 'Revoke this token immediately and use GitHub Actions secrets or a vault';
  if (type.includes('Stripe')) return 'Rotate via the Stripe dashboard and store in environment variables';
  if (type.includes('SendGrid')) return 'Revoke via SendGrid settings and store in environment variables';
  if (type.includes('Twilio')) return 'Rotate via the Twilio console and store in environment variables';
  if (type.includes('Slack')) return 'Revoke via Slack app settings and store in environment variables';
  if (type.includes('Private Key')) return 'Remove from source control immediately; generate a new key pair';
  if (type.includes('JWT')) return 'Replace with a runtime-generated token; never hardcode JWTs in source';
  if (type.includes('Database URL')) return 'Move credentials to environment variables or a secrets manager';
  if (type.includes('API Key')) return 'Rotate this key and store it in environment variables or a vault';
  return 'Rotate this credential and store it in environment variables or a secrets manager';
}

// ── Command ───────────────────────────────────────────────────────────────────

export function register(program: Command): void {
  program
    .command('secrets [projectPath]')
    .description('Scan source files for hardcoded secrets and credentials')
    .option('--include-tests', 'Include test files in the scan')
    .option('--severity <level>', 'Filter by severity: critical, high, medium, low')
    .option('--format <fmt>', 'Output format: text (default), json')
    .action(async (
      projectPath: string | undefined,
      opts: { includeTests?: boolean; severity?: string; format?: string },
    ) => {
      const target = path.resolve(projectPath ?? process.cwd());
      const config = await loadConfig(target);

      // Validate --severity early
      const validSeverities = ['critical', 'high', 'medium', 'low'];
      if (opts.severity && !validSeverities.includes(opts.severity.toLowerCase())) {
        console.error(`  ✖ Invalid --severity value: ${opts.severity}. Use: critical, high, medium, low`);
        process.exit(1);
      }

      // Validate --format early
      const validFormats = ['text', 'json'];
      if (opts.format && !validFormats.includes(opts.format.toLowerCase())) {
        console.error(`  ✖ Invalid --format value: ${opts.format}. Use: text, json`);
        process.exit(1);
      }

      if (!config.enableSecurity) {
        console.error(`\n  ${'\x1b[33m'}⚠ Security analysis is disabled.${reset}`);
        console.error(`  ${dim}Enable it in .kirograph/config.json:${reset} ${violet}${bold}"enableSecurity": true${reset}`);
        console.error(`  ${dim}Then re-run:${reset} ${violet}${bold}kirograph index${reset}\n`);
        process.exit(1);
      }

      if (!config.enableArchitecture) {
        console.error(`\n  ${'\x1b[33m'}⚠ Secrets scan requires Architecture analysis to be enabled.${reset}`);
        console.error(`  ${dim}Enable both in .kirograph/config.json:${reset}`);
        console.error(`    ${violet}${bold}"enableArchitecture": true${reset}`);
        console.error(`    ${violet}${bold}"enableSecurity": true${reset}`);
        console.error(`  ${dim}Then re-run:${reset} ${violet}${bold}kirograph index${reset}\n`);
        process.exit(1);
      }

      const KiroGraph = (await import('../../index')).default;
      if (!KiroGraph.isInitialized(target)) {
        console.error('  ✖ KiroGraph not initialized. Run: kirograph init');
        process.exit(1);
      }

      const cg = await KiroGraph.open(target);
      const db = cg.getDatabase();
      db.applySecuritySchema();

      const { SecretsScanner } = await import('../../security/secrets');
      const scanner = new SecretsScanner(db, target);
      const result = await scanner.scan({ includeTests: opts.includeTests });

      // Apply severity filter
      let findings = result.findings;
      if (opts.severity) {
        const minSeverity = opts.severity.toLowerCase();
        const minOrder = SEVERITY_ORDER[minSeverity] ?? 3;
        findings = findings.filter(f => (SEVERITY_ORDER[f.severity] ?? 3) <= minOrder);
      }

      // ── JSON output ──────────────────────────────────────────────────────────

      if (opts.format === 'json') {
        process.stdout.write(JSON.stringify({
          filesScanned: result.filesScanned,
          totalFindings: findings.length,
          criticalCount: findings.filter(f => f.severity === 'critical').length,
          highCount: findings.filter(f => f.severity === 'high').length,
          findings,
        }, null, 2) + '\n');
        cg.close();
        return;
      }

      // ── Text output ──────────────────────────────────────────────────────────

      const filterNote = opts.severity ? ` · filtered to ${opts.severity}+` : '';
      console.log(`\n  ${violet}${bold}🔑 Secrets Scan${reset}  ${dim}(${findings.length} finding${findings.length === 1 ? '' : 's'} in ${result.filesScanned} files${filterNote})${reset}\n`);

      if (findings.length === 0) {
        console.log(`  ${dim}No secrets found.${reset}\n`);
        cg.close();
        return;
      }

      for (const finding of findings) {
        const color = severityColor(finding.severity);
        const label = severityLabel(finding.severity);

        // Relative path for display
        const relPath = path.relative(target, finding.filePath);
        const location = `${relPath}:${finding.line}`;

        // Header line: severity + type + location
        console.log(`  ${color}${bold}${label}${reset}  ${violet}${bold}${finding.type}${reset}  ${dim}${location}${reset}`);

        // Detail line: snippet · function · blast radius
        const snippetPart = `${dim}${finding.snippet}${reset}`;
        const funcPart = finding.nodeName
          ? ` · ${dim}in${reset} ${violet}${finding.nodeName}()${reset}`
          : '';
        const reachabilityPart = finding.entryPointCount > 0
          ? ` · ${'\x1b[33m'}reachable from ${bold}${finding.entryPointCount}${reset}${'\x1b[33m'} entry point${finding.entryPointCount === 1 ? '' : 's'}${reset}`
          : '';

        console.log(`            ${snippetPart}${funcPart}${reachabilityPart}`);

        // Fix suggestion
        const suggestion = fixSuggestion(finding.type);
        console.log(`            ${dim}💡 ${suggestion}${reset}`);

        console.log();
      }

      // Summary line when multiple severities present
      if (findings.length > 1) {
        const crit = findings.filter(f => f.severity === 'critical').length;
        const high = findings.filter(f => f.severity === 'high').length;
        const med  = findings.filter(f => f.severity === 'medium').length;
        const low  = findings.filter(f => f.severity === 'low').length;

        const parts: string[] = [];
        if (crit > 0) parts.push(`${'\x1b[31m'}${bold}${crit} critical${reset}`);
        if (high > 0) parts.push(`${'\x1b[31m'}${bold}${high} high${reset}`);
        if (med  > 0) parts.push(`${'\x1b[33m'}${bold}${med} medium${reset}`);
        if (low  > 0) parts.push(`${dim}${bold}${low} low${reset}`);

        console.log(`  ${dim}Total:${reset} ${parts.join(`${dim}, ${reset}`)}\n`);
      }

      cg.close();
    });
}
