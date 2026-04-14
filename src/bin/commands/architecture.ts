import { Command } from 'commander';
import * as path from 'path';
import { dim, reset, violet, bold, green, label, value, section, renderTable } from '../ui';

export function register(program: Command): void {
  program
    .command('architecture [projectPath]')
    .description('Show the detected package graph and architectural layers')
    .option('--format <fmt>', 'Output format: markdown, json', 'markdown')
    .option('--packages', 'Show packages only')
    .option('--layers', 'Show layers only')
    .action(async (projectPath: string | undefined, opts: { format: string; packages?: boolean; layers?: boolean }) => {
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
        console.log(JSON.stringify(arch, null, 2));
        cg.close(); return;
      }

      const showPackages = !opts.layers || opts.packages;
      const showLayers   = !opts.packages || opts.layers;

      // ── Packages ──────────────────────────────────────────────────────────────
      if (showPackages) {
        console.log(`\n  ${section('Packages')}  ${dim}(${arch.packages.length})${reset}\n`);
        if (arch.packages.length === 0) {
          console.log(`  ${dim}No packages detected.${reset}`);
        } else {
          for (const pkg of arch.packages) {
            const src = pkg.source === 'manifest'
              ? `${green}manifest${reset}`
              : `${dim}directory${reset}`;
            const lang = pkg.language ? `  ${dim}${pkg.language}${reset}` : '';
            const ver  = pkg.version  ? `  ${dim}v${pkg.version}${reset}`  : '';
            console.log(`  ${violet}${bold}${pkg.name}${reset}${ver}${lang}  ${dim}[${src}${dim}]${reset}`);
            console.log(`  ${dim}  path: ${pkg.path}${reset}`);
            if (pkg.externalDeps && pkg.externalDeps.length > 0) {
              console.log(`  ${dim}  deps: ${pkg.externalDeps.slice(0, 6).join(', ')}${pkg.externalDeps.length > 6 ? ` +${pkg.externalDeps.length - 6} more` : ''}${reset}`);
            }
          }
        }

        if (arch.packageDeps.length > 0) {
          console.log(`\n  ${section('Package Dependencies')}  ${dim}(${arch.packageDeps.length} edges)${reset}\n`);
          for (const dep of arch.packageDeps) {
            const from = dep.sourcePkg.replace(/^pkg:[^:]+:/, '');
            const to   = dep.targetPkg.replace(/^pkg:[^:]+:/, '');
            console.log(`  ${violet}${from}${reset}  ${dim}→${reset}  ${violet}${to}${reset}  ${dim}(${dep.depCount} import${dep.depCount !== 1 ? 's' : ''})${reset}`);
          }
        }
      }

      // ── Layers ────────────────────────────────────────────────────────────────
      if (showLayers) {
        console.log(`\n  ${section('Layers')}  ${dim}(${arch.layers.length})${reset}\n`);
        if (arch.layers.length === 0) {
          console.log(`  ${dim}No layers detected.${reset}`);
        } else {
          // Count files per layer
          const layerFileCounts: Record<string, number> = {};
          for (const assignments of Object.values(arch.fileLayers)) {
            for (const a of assignments) {
              layerFileCounts[a.layerId] = (layerFileCounts[a.layerId] ?? 0) + 1;
            }
          }

          const rows: [string, string][] = arch.layers.map(l => [
            l.name,
            `${layerFileCounts[l.id] ?? 0} files`,
          ]);
          console.log(renderTable(rows));
        }

        if (arch.layerDeps.length > 0) {
          console.log(`\n  ${section('Layer Dependencies')}  ${dim}(${arch.layerDeps.length} edges)${reset}\n`);
          for (const dep of arch.layerDeps) {
            const from = dep.sourceLayer.replace(/^layer:/, '');
            const to   = dep.targetLayer.replace(/^layer:/, '');
            console.log(`  ${violet}${from}${reset}  ${dim}→${reset}  ${violet}${to}${reset}  ${dim}(${dep.depCount})${reset}`);
          }
        }
      }

      console.log();
      cg.close();
    });
}
