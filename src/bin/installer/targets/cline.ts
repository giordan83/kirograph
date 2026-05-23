/**
 * Cline target.
 *
 * MCP: .cline/mcp_settings.json
 * Rules: .clinerules/kirograph.md (directory-based, not a flat file)
 * Hooks: .cline/hooks/task_completed (executable script)
 */

import * as fs from 'fs';
import * as path from 'path';
import { CavemanMode } from '../caveman';
import {
  ensureDir,
  buildInstructionOpts,
  printMcpSetup,
} from '../common';
import { buildAgentInstructions } from '../instructions';

const CLINE_RULES_FILE = 'kirograph.md';
const CLINE_HOOK_SCRIPT = '#!/bin/sh\nkirograph sync --quiet 2>/dev/null || true\n';

export function installClineEarly(_projectRoot: string): void {
  // Cline MCP is user-scoped at ~/.cline/mcp.json.
  // We print the setup instructions in printNextSteps.
}

export function installClineLate(projectRoot: string, cavemanMode?: CavemanMode | 'off', shellCompressionLevel?: string, enableMemory?: boolean): void {
  const opts = buildInstructionOpts(cavemanMode, shellCompressionLevel, enableMemory, true);

  const instructionsPath = path.join(projectRoot, '.kirograph', 'cline.md');
  ensureDir(path.dirname(instructionsPath));
  fs.writeFileSync(instructionsPath, buildAgentInstructions(opts));
  console.log(`  ✓ Cline instructions written to ${instructionsPath}`);

  // Write rules file inside .clinerules/ directory
  const rulesDir = path.join(projectRoot, '.clinerules');
  // If .clinerules exists as a flat file (legacy), remove it first
  if (fs.existsSync(rulesDir) && fs.statSync(rulesDir).isFile()) {
    fs.unlinkSync(rulesDir);
  }
  ensureDir(rulesDir);
  const rulePath = path.join(rulesDir, CLINE_RULES_FILE);
  fs.writeFileSync(rulePath, buildAgentInstructions(opts));
  console.log(`  ✓ Cline rule written to ${rulePath}`);

  // Write hook script
  const hooksDir = path.join(projectRoot, '.clinerules', 'hooks');
  ensureDir(hooksDir);
  const hookPath = path.join(hooksDir, 'task_completed');
  fs.writeFileSync(hookPath, CLINE_HOOK_SCRIPT, { mode: 0o755 });
  console.log(`  ✓ Cline hook written to ${hookPath}`);
}

export function uninitCline(projectRoot: string): void {
  // Remove rule file
  const rulePath = path.join(projectRoot, '.clinerules', CLINE_RULES_FILE);
  if (fs.existsSync(rulePath)) {
    fs.unlinkSync(rulePath);
    console.log(`  ✓ Removed .clinerules/${CLINE_RULES_FILE}`);
  }

  // Remove hook
  const hookPath = path.join(projectRoot, '.clinerules', 'hooks', 'task_completed');
  if (fs.existsSync(hookPath)) {
    const content = fs.readFileSync(hookPath, 'utf8');
    if (content.includes('kirograph')) {
      fs.unlinkSync(hookPath);
      console.log(`  ✓ Removed Cline hook .clinerules/hooks/task_completed`);
    }
  }
}

export function printClineNextSteps(projectRoot: string): void {
  console.log('\n  Done! KiroGraph rule and hook are in .clinerules/');
  printMcpSetup('~/.cline/mcp.json', projectRoot);
}
