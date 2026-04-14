import { Command } from 'commander';
import * as path from 'path';
import { dim, reset, violet, bold, green, label, value, section, renderTable } from '../ui';

const INSTABILITY_HIGH   = 0.7;
const INSTABILITY_LOW    = 0.3;

function instabilityBar(i: number): string {
  const pct = Math.round(i * 10);
  const filled = '█'.repeat(pct);
  const empty  = '░'.repeat(10 - pct);
  const color  = i >= INSTABILITY_HIGH ? '\x1b[38;5;203m' : i <= INSTABILITY_LOW ? green : '\x1b[33m';
  return `${color}${filled}${dim}${empty}${reset}`;
}

function instabilityLabel(i: number): string {
  if (i >= INSTABILITY_HIGH) return `${'\x1b[38;5;203m'}unstable${reset}`;
  if (i <= INSTABILITY_LOW)  return `${green}stable${reset}`;
  return `${'\x1b[33m'}neutral${reset}`;
}

export function register(program: Command): void {
  program
    .command('coupling [projectPath]')
    .description('Show package coupling metrics (Ca, Ce, instability)')
    .option('--package <id>', 'Show details for a single package (ID or name fragment)')
    .option('--sort <by>', 'Sort by: instability, ca, ce, name', 'instability')
    .option('--format <fmt>', 'Output format: markdown, json', 'markdown')
    .action(async (projectPath: string | undefined, opts: { package?: string; sort: string; format: string }) => {
      const KiroGraph = (await import('../../index')).default;
      const target = path.resolve(projectPath ?? process.cwd());
      const cg = await KiroGraph.open(target);

      if (!cg.isArchitectureEnabled()) {
        console.error(`\n  ${'\x1b[33m'}⚠ Architecture analysis is disabled.${reset}`);
        console.error(`  ${dim}Enable it in .kirograph/config.json:${reset} ${violet}${bold}"enableArchitecture": true${reset}`);
        console.error(`  ${dim}Then re-run:${reset} ${violet}${bold}kirograph index${reset}\n`);
        cg.close(); process.exit(1);
      }

      const arch = cg.getArchitecture();

      if (opts.format === 'json') {
        const out = opts.package
          ? arch.coupling.filter(c => c.packageId.includes(opts.package!) || arch.packages.find(p => p.id === c.packageId)?.name.includes(opts.package!))
          : arch.coupling;
        console.log(JSON.stringify(out, null, 2));
        cg.close(); return;
      }

      // ── Single package detail ────────────────────────────────────────────────
      if (opts.package) {
        const pkg = arch.packages.find(p =>
          p.id.includes(opts.package!) || p.name.toLowerCase().includes(opts.package!.toLowerCase())
        );
        if (!pkg) {
          console.error(`\n  ${'\x1b[38;5;203m'}✗ Package not found: ${opts.package}${reset}\n`);
          cg.close(); process.exit(1);
        }
        const c = arch.coupling.find(x => x.packageId === pkg.id);

        console.log(`\n  ${section(pkg.name)}  ${dim}${pkg.path}${reset}\n`);
        console.log(renderTable([
          ['Afferent Ca',   String(c?.afferent ?? 0)],
          ['Efferent Ce',   String(c?.efferent ?? 0)],
          ['Instability',   c ? `${(c.instability * 100).toFixed(0)}%` : 'n/a'],
        ]));

        // Incoming deps (who depends on this package)
        const incoming = arch.packageDeps.filter(d => d.targetPkg === pkg.id);
        if (incoming.length > 0) {
          console.log(`\n  ${label('Depended on by')}  ${dim}(${incoming.length})${reset}\n`);
          for (const d of incoming) {
            const name = arch.packages.find(p => p.id === d.sourcePkg)?.name ?? d.sourcePkg;
            console.log(`  ${dim}←${reset}  ${violet}${name}${reset}  ${dim}(${d.depCount} import${d.depCount !== 1 ? 's' : ''})${reset}`);
          }
        }

        // Outgoing deps (what this package depends on)
        const outgoing = arch.packageDeps.filter(d => d.sourcePkg === pkg.id);
        if (outgoing.length > 0) {
          console.log(`\n  ${label('Depends on')}  ${dim}(${outgoing.length})${reset}\n`);
          for (const d of outgoing) {
            const name = arch.packages.find(p => p.id === d.targetPkg)?.name ?? d.targetPkg;
            console.log(`  ${dim}→${reset}  ${violet}${name}${reset}  ${dim}(${d.depCount} import${d.depCount !== 1 ? 's' : ''})${reset}`);
          }
        }

        console.log();
        cg.close(); return;
      }

      // ── All packages overview ────────────────────────────────────────────────
      let coupling = arch.coupling.slice();

      // Attach package name for sorting/display
      const pkgById = new Map(arch.packages.map(p => [p.id, p]));

      switch (opts.sort) {
        case 'ca':   coupling.sort((a, b) => b.afferent - a.afferent); break;
        case 'ce':   coupling.sort((a, b) => b.efferent - a.efferent); break;
        case 'name': coupling.sort((a, b) => (pkgById.get(a.packageId)?.name ?? '').localeCompare(pkgById.get(b.packageId)?.name ?? '')); break;
        default:     coupling.sort((a, b) => b.instability - a.instability); break;
      }

      console.log(`\n  ${section('Coupling Metrics')}  ${dim}sorted by ${opts.sort}${reset}\n`);

      if (coupling.length === 0) {
        console.log(`  ${dim}No coupling data. Run ${reset}${violet}${bold}kirograph index${reset}${dim} with enableArchitecture=true.${reset}\n`);
        cg.close(); return;
      }

      const nameW = Math.max(...coupling.map(c => (pkgById.get(c.packageId)?.name ?? c.packageId).length), 4);

      // Header
      console.log(`  ${dim}${'Package'.padEnd(nameW)}  Ca   Ce   Instability${reset}`);
      console.log(`  ${dim}${'─'.repeat(nameW + 26)}${reset}`);

      for (const c of coupling) {
        const pkg = pkgById.get(c.packageId);
        const name = (pkg?.name ?? c.packageId).padEnd(nameW);
        const ca = String(c.afferent).padStart(3);
        const ce = String(c.efferent).padStart(3);
        const pct = `${(c.instability * 100).toFixed(0)}%`.padStart(4);
        const bar = instabilityBar(c.instability);
        const lbl = instabilityLabel(c.instability);
        console.log(`  ${violet}${name}${reset}  ${dim}${ca}${reset}  ${dim}${ce}${reset}  ${bar} ${pct}  ${lbl}`);
      }

      // Summary
      const avgInstability = coupling.length > 0
        ? coupling.reduce((s, c) => s + c.instability, 0) / coupling.length
        : 0;
      console.log(`\n  ${label('Packages')}  ${value(String(coupling.length))}    ${label('Avg instability')}  ${value(`${(avgInstability * 100).toFixed(0)}%`)}\n`);

      cg.close();
    });
}
