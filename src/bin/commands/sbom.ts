import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from '../../config';
import { dim, reset, violet, bold, green } from '../ui';

export function register(program: Command): void {
  program
    .command('sbom [projectPath]')
    .description('Export CycloneDX 1.5 SBOM (Software Bill of Materials)')
    .option('--output <file>', 'Write SBOM to file instead of stdout')
    .action(async (projectPath: string | undefined, opts: { output?: string }) => {
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

      const { SBOMExporter } = await import('../../security/export/sbom');
      const exporter = new SBOMExporter(db, target);
      const json = exporter.exportJSON();

      if (opts.output) {
        const outPath = path.resolve(opts.output);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, json, 'utf-8');
        console.error(`  ${green}✓${reset} SBOM written to ${violet}${bold}${outPath}${reset}`);
      } else {
        process.stdout.write(json + '\n');
      }

      cg.close();
    });
}
