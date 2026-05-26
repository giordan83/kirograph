/**
 * Auto-detect installer for KiroGraph.
 *
 * When `kirograph install` is run without --target, this module detects
 * all installed AI coding platforms and offers to configure them all.
 */

import * as readline from 'readline';
import { detectPlatforms, type DetectionResult } from './detect';
import { runInstaller } from './index';
import { printBanner } from '../banner';
import type { InstallTarget } from './common';

const dim = '\x1b[2m';
const reset = '\x1b[0m';
const green = '\x1b[32m';
const bold = '\x1b[1m';

export interface AutoDetectOptions {
  /** Skip the confirmation prompt and install all detected platforms */
  skipPrompt?: boolean;
  /** Show what would be written without making changes */
  dryRun?: boolean;
}

export async function runAutoDetectInstaller(opts: AutoDetectOptions = {}): Promise<void> {
  printBanner();

  const cwd = process.cwd();
  const detected = detectPlatforms(cwd);

  if (detected.length === 0) {
    console.log('  No AI coding platforms detected in this environment.');
    console.log('  Use --target <name> to install for a specific platform.');
    console.log(`  Available targets: kiro, claude, cursor, windsurf, codex, copilot, ...`);
    console.log(`  Run ${bold}kirograph install --help${reset} for the full list.\n`);
    return;
  }

  console.log(`  ${bold}Detected platforms:${reset}\n`);
  for (const d of detected) {
    console.log(`    ${green}✓${reset} ${d.label.padEnd(20)} ${dim}(${d.reason})${reset}`);
  }
  console.log();

  if (opts.dryRun) {
    console.log(`  ${dim}[dry-run] Would install KiroGraph for ${detected.length} platform(s).${reset}`);
    console.log(`  ${dim}[dry-run] No files will be written.${reset}\n`);
    return;
  }

  let targets: InstallTarget[] = detected.map(d => d.target);

  if (!opts.skipPrompt) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await new Promise<string>((resolve) => {
        rl.question(`  Install KiroGraph for all ${detected.length} detected platform(s)? [Y/n] `, resolve);
      });
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === 'n' || trimmed === 'no') {
        console.log('  Cancelled. Use --target <name> to install for a specific platform.\n');
        rl.close();
        return;
      }

      // Ask if they want to select specific ones
      if (detected.length > 1) {
        const selectAnswer = await new Promise<string>((resolve) => {
          rl.question(`  Install all, or select specific platforms? [all/select] `, resolve);
        });
        if (selectAnswer.trim().toLowerCase() === 'select') {
          const selectedTargets: InstallTarget[] = [];
          for (const d of detected) {
            const include = await new Promise<string>((resolve) => {
              rl.question(`    Include ${d.label}? [Y/n] `, resolve);
            });
            if (include.trim().toLowerCase() !== 'n') {
              selectedTargets.push(d.target);
            }
          }
          targets = selectedTargets;
          if (targets.length === 0) {
            console.log('  No platforms selected. Cancelled.\n');
            rl.close();
            return;
          }
        }
      }
      rl.close();
    } catch {
      rl.close();
      return;
    }
  }

  console.log(`\n  Installing KiroGraph for ${targets.length} platform(s)...\n`);

  for (const target of targets) {
    const label = detected.find(d => d.target === target)?.label ?? target;
    console.log(`  ── ${bold}${label}${reset} ──\n`);
    await runInstaller(target);
    console.log();
  }

  console.log(`  ${green}✓${reset} ${bold}All done!${reset} Configured ${targets.length} platform(s).`);
  console.log(`  Restart your AI coding tools for the MCP servers to load.\n`);
}
