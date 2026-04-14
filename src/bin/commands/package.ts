import { Command } from 'commander';
import * as path from 'path';
import { dim, reset, violet, bold, green, label, value, section, renderTable } from '../ui';

export function register(program: Command): void {
  program
    .command('package <name>')
    .description('Inspect a package: files, coupling, and dependencies')
    .option('--no-files', 'Omit file list')
    .option('--format <fmt>', 'Output format: markdown, json', 'markdown')
    .action(async (name: string, opts: { files: boolean; format: string }, cmd: Command) => {
      // commander puts the project path as the parent option, but we keep it simple
      const KiroGraph = (await import('../../index')).default;
      const cg = await KiroGraph.open(process.cwd());

      if (!cg.isArchitectureEnabled()) {
        console.error(`\n  ${'\x1b[33m'}⚠ Architecture analysis is disabled.${reset}`);
        console.error(`  ${dim}Enable it in .kirograph/config.json:${reset} ${violet}${bold}"enableArchitecture": true${reset}`);
        console.error(`  ${dim}Then re-run:${reset} ${violet}${bold}kirograph index${reset}\n`);
        cg.close(); process.exit(1);
      }

      const arch = cg.getArchitecture();
      const query = name.toLowerCase();
      const pkg = arch.packages.find(p =>
        p.name.toLowerCase().includes(query) ||
        p.path.toLowerCase().includes(query) ||
        p.id.toLowerCase().includes(query)
      );

      if (!pkg) {
        console.error(`\n  ${'\x1b[38;5;203m'}✗ Package "${name}" not found.${reset}`);
        console.error(`  ${dim}Run ${reset}${violet}${bold}kirograph architecture --packages${reset}${dim} to list all packages.${reset}\n`);
        cg.close(); process.exit(1);
      }

      if (opts.format === 'json') {
        const deps      = arch.packageDeps.filter(d => d.sourcePkg === pkg.id);
        const dependents = arch.packageDeps.filter(d => d.targetPkg === pkg.id);
        const coupling  = arch.coupling.find(c => c.packageId === pkg.id);
        const files     = Object.entries(arch.filePackages)
          .filter(([, ids]) => ids.includes(pkg.id))
          .map(([f]) => f)
          .sort();
        console.log(JSON.stringify({ package: pkg, coupling, deps, dependents, files }, null, 2));
        cg.close(); return;
      }

      // ── Header ───────────────────────────────────────────────────────────────
      const srcLabel = pkg.source === 'manifest'
        ? `${green}manifest${reset}`
        : `${dim}directory${reset}`;

      console.log(`\n  ${section(pkg.name)}  ${dim}${pkg.path}${reset}`);
      console.log(`  ${dim}id: ${pkg.id}${reset}\n`);

      const meta: [string, string][] = [
        ['Source', pkg.source === 'manifest' ? 'manifest' : 'directory'],
      ];
      if (pkg.language)     meta.push(['Language', pkg.language]);
      if (pkg.version)      meta.push(['Version', pkg.version]);
      if (pkg.manifestPath) meta.push(['Manifest', pkg.manifestPath]);
      console.log(renderTable(meta));

      // ── Coupling ─────────────────────────────────────────────────────────────
      const coupling = arch.coupling.find(c => c.packageId === pkg.id);
      if (coupling) {
        console.log(`\n  ${section('Coupling')}\n`);
        console.log(renderTable([
          ['Afferent Ca',  String(coupling.afferent)],
          ['Efferent Ce',  String(coupling.efferent)],
          ['Instability',  `${(coupling.instability * 100).toFixed(0)}%`],
        ]));
      }

      // ── Dependencies ─────────────────────────────────────────────────────────
      const deps = arch.packageDeps.filter(d => d.sourcePkg === pkg.id);
      if (deps.length > 0) {
        console.log(`\n  ${label('Depends on')}  ${dim}(${deps.length})${reset}\n`);
        for (const dep of deps) {
          const depName = arch.packages.find(p => p.id === dep.targetPkg)?.name ?? dep.targetPkg;
          console.log(`  ${dim}→${reset}  ${violet}${depName}${reset}  ${dim}(${dep.depCount} import${dep.depCount !== 1 ? 's' : ''})${reset}`);
        }
      }

      const dependents = arch.packageDeps.filter(d => d.targetPkg === pkg.id);
      if (dependents.length > 0) {
        console.log(`\n  ${label('Depended on by')}  ${dim}(${dependents.length})${reset}\n`);
        for (const dep of dependents) {
          const depName = arch.packages.find(p => p.id === dep.sourcePkg)?.name ?? dep.sourcePkg;
          console.log(`  ${dim}←${reset}  ${violet}${depName}${reset}  ${dim}(${dep.depCount} import${dep.depCount !== 1 ? 's' : ''})${reset}`);
        }
      }

      // ── External deps ─────────────────────────────────────────────────────────
      if (pkg.externalDeps && pkg.externalDeps.length > 0) {
        console.log(`\n  ${label('External deps')}  ${dim}(${pkg.externalDeps.length})${reset}\n`);
        const chunks: string[] = [];
        for (let i = 0; i < Math.min(pkg.externalDeps.length, 30); i += 4) {
          chunks.push('  ' + pkg.externalDeps.slice(i, i + 4).map(d => `${violet}${d}${reset}`).join(`  ${dim}·${reset}  `));
        }
        console.log(chunks.join('\n'));
        if (pkg.externalDeps.length > 30) {
          console.log(`  ${dim}…and ${pkg.externalDeps.length - 30} more${reset}`);
        }
      }

      // ── Files ─────────────────────────────────────────────────────────────────
      if (opts.files) {
        const files = Object.entries(arch.filePackages)
          .filter(([, ids]) => ids.includes(pkg.id))
          .map(([f]) => f)
          .sort();

        if (files.length > 0) {
          console.log(`\n  ${label('Files')}  ${dim}(${files.length})${reset}\n`);
          const shown = files.slice(0, 40);
          for (const f of shown) {
            console.log(`  ${dim}${f}${reset}`);
          }
          if (files.length > 40) {
            console.log(`  ${dim}…and ${files.length - 40} more${reset}`);
          }
        }
      }

      console.log();
      cg.close();
    });
}
