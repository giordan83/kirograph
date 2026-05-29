import { Command } from 'commander';
import * as path from 'path';
import { loadConfig } from '../../config';
import { dim, reset, violet, bold, green } from '../ui';
import { checkLicensePolicy } from '../../security/license';

export function register(program: Command): void {
  program
    .command('licenses [projectPath]')
    .description('Show license compliance: per-dependency licenses and policy violations')
    .option('--policy', 'Show only policy violations')
    .option('--deny <patterns>', 'Override deny list (comma-separated SPDX patterns)')
    .option('--warn <patterns>', 'Override warn list (comma-separated SPDX patterns)')
    .option('--format <fmt>', 'Output format: table (default) or json')
    .action(async (projectPath: string | undefined, opts: {
      policy?: boolean;
      deny?: string;
      warn?: string;
      format?: string;
    }) => {
      const target = path.resolve(projectPath ?? process.cwd());
      const config = await loadConfig(target);

      if (!config.enableSecurity) {
        console.error(`\n  ${'\x1b[33m'}⚠ Security analysis is disabled.${reset}`);
        console.error(`  ${dim}Enable it in .kirograph/config.json:${reset} ${violet}${bold}"enableSecurity": true${reset}`);
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
      const rawDb = db.getRawDb();

      // Query all dependencies with their license info
      const deps: Array<{
        package_name: string;
        ecosystem: string;
        license: string | null;
      }> = rawDb.all(
        `SELECT package_name, ecosystem, license FROM sec_dependencies ORDER BY ecosystem, package_name`,
      );

      // Build effective policy: CLI overrides take precedence over config
      const denyList = opts.deny
        ? opts.deny.split(',').map(s => s.trim()).filter(Boolean)
        : config.securityLicensePolicy.deny;
      const warnList = opts.warn
        ? opts.warn.split(',').map(s => s.trim()).filter(Boolean)
        : config.securityLicensePolicy.warn;

      const policy = { deny: denyList, warn: warnList };

      // Check for violations
      const violations = checkLicensePolicy(deps, policy);
      const violationMap = new Map<string, 'deny' | 'warn'>();
      for (const v of violations) {
        violationMap.set(`${v.ecosystem}:${v.packageName}`, v.severity);
      }

      // JSON output
      if (opts.format === 'json') {
        if (opts.policy) {
          console.log(JSON.stringify(violations, null, 2));
        } else {
          const output = deps.map(dep => {
            const key = `${dep.ecosystem}:${dep.package_name}`;
            const violation = violationMap.get(key);
            return {
              package: dep.package_name,
              ecosystem: dep.ecosystem,
              license: dep.license ?? null,
              status: violation ?? (dep.license ? 'ok' : 'unknown'),
            };
          });
          console.log(JSON.stringify(output, null, 2));
        }
        cg.close();
        return;
      }

      // Table output
      const red = '\x1b[31m';
      const yellow = '\x1b[33m';

      if (opts.policy) {
        // Show only violations
        if (violations.length === 0) {
          console.log(`\n  ${green}✓${reset} No license policy violations found.\n`);
          cg.close();
          return;
        }

        console.log(`\n  ${bold}License Policy Violations${reset} (${violations.length})\n`);
        for (const v of violations) {
          const color = v.severity === 'deny' ? red : yellow;
          const label = v.severity === 'deny' ? 'DENY' : 'WARN';
          console.log(`  ${color}${label}${reset}  ${violet}${bold}${v.packageName}${reset}  ${dim}[${v.ecosystem}]${reset}  ${v.license}`);
        }
        console.log();
        cg.close();

        // Exit with non-zero if there are deny violations
        if (violations.some(v => v.severity === 'deny')) {
          process.exit(1);
        }
        return;
      }

      // Full table: group violations at top
      if (deps.length === 0) {
        console.log(`\n  ${dim}No dependencies found. Run kirograph index first.${reset}\n`);
        cg.close();
        return;
      }

      console.log(`\n  ${bold}License Compliance${reset}  ${dim}(${deps.length} dependencies)${reset}\n`);

      // Compute column widths
      const pkgWidth = Math.max(7, ...deps.map(d => d.package_name.length));
      const ecoWidth = Math.max(9, ...deps.map(d => d.ecosystem.length));
      const licWidth = Math.max(7, ...deps.map(d => (d.license ?? 'unknown').length));

      const header = `  ${'package'.padEnd(pkgWidth)}  ${'ecosystem'.padEnd(ecoWidth)}  ${'license'.padEnd(licWidth)}  status`;
      const divider = `  ${'─'.repeat(pkgWidth)}  ${'─'.repeat(ecoWidth)}  ${'─'.repeat(licWidth)}  ──────`;
      console.log(`${dim}${header}${reset}`);
      console.log(`${dim}${divider}${reset}`);

      // Sort: violations first, then alphabetical
      const sorted = [...deps].sort((a, b) => {
        const aKey = `${a.ecosystem}:${a.package_name}`;
        const bKey = `${b.ecosystem}:${b.package_name}`;
        const aViol = violationMap.get(aKey);
        const bViol = violationMap.get(bKey);
        if (aViol !== bViol) {
          if (aViol === 'deny') return -1;
          if (bViol === 'deny') return 1;
          if (aViol === 'warn') return -1;
          if (bViol === 'warn') return 1;
        }
        return a.package_name.localeCompare(b.package_name);
      });

      for (const dep of sorted) {
        const key = `${dep.ecosystem}:${dep.package_name}`;
        const violation = violationMap.get(key);
        const license = dep.license ?? 'unknown';

        let statusLabel: string;
        let statusColor: string;
        let nameColor: string;

        if (violation === 'deny') {
          statusLabel = 'deny';
          statusColor = red;
          nameColor = red;
        } else if (violation === 'warn') {
          statusLabel = 'warn';
          statusColor = yellow;
          nameColor = yellow;
        } else if (!dep.license) {
          statusLabel = 'unknown';
          statusColor = dim;
          nameColor = dim;
        } else {
          statusLabel = 'ok';
          statusColor = green;
          nameColor = reset;
        }

        const pkgStr = dep.package_name.padEnd(pkgWidth);
        const ecoStr = dep.ecosystem.padEnd(ecoWidth);
        const licStr = license.padEnd(licWidth);
        console.log(`  ${nameColor}${pkgStr}${reset}  ${dim}${ecoStr}${reset}  ${licStr}  ${statusColor}${statusLabel}${reset}`);
      }

      console.log();

      // Summary
      const denyCount = violations.filter(v => v.severity === 'deny').length;
      const warnCount = violations.filter(v => v.severity === 'warn').length;
      const unknownCount = deps.filter(d => !d.license).length;

      if (denyCount > 0 || warnCount > 0) {
        if (denyCount > 0) {
          console.log(`  ${red}${bold}${denyCount} denied license${denyCount !== 1 ? 's' : ''}${reset}`);
        }
        if (warnCount > 0) {
          console.log(`  ${yellow}${bold}${warnCount} license warning${warnCount !== 1 ? 's' : ''}${reset}`);
        }
      } else {
        console.log(`  ${green}✓${reset} No policy violations`);
      }

      if (unknownCount > 0) {
        console.log(`  ${dim}${unknownCount} unknown license${unknownCount !== 1 ? 's' : ''} (no license info in manifest)${reset}`);
      }
      console.log();

      cg.close();

      // Exit non-zero if deny violations
      if (denyCount > 0) {
        process.exit(1);
      }
    });
}
