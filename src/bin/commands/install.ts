import { Command } from 'commander';

const INSTALL_TARGETS = [
  'kiro', 'claude', 'codex', 'cursor', 'antigravity', 'opencode',
  'windsurf', 'cline', 'copilot', 'copilot-cli', 'junie', 'gemini-cli',
  'continue', 'roo', 'warp', 'aider', 'trae',
  'augment', 'kilo', 'amp', 'devin', 'replit', 'goose', 'openhands', 'tabnine',
  'mistral-vibe', 'ibm-bob', 'crush', 'droid-factory', 'forgecode', 'iflow', 'qwen', 'rovo', 'qoder',
];

export function register(program: Command): void {
  program
    .command('install')
    .description('Configure KiroGraph for an agent workspace (auto-detects platforms if no --target)')
    .option('--target <target>', `Integration target: ${INSTALL_TARGETS.join(', ')}`)
    .option('--all', 'Install for all auto-detected platforms without prompting')
    .option('--dry-run', 'Show what would be written without making changes')
    .action(async (opts: { target?: string; all?: boolean; dryRun?: boolean }) => {
      if (opts.target) {
        // Explicit target: validate and install
        const target = opts.target.toLowerCase();
        if (target !== 'all' && !INSTALL_TARGETS.includes(target)) {
          console.error(`Unknown install target: ${opts.target}. Choose from: ${INSTALL_TARGETS.join(', ')}`);
          process.exit(1);
        }

        if (target === 'all') {
          // --target all is an alias for --all
          const { runAutoDetectInstaller } = await import('../installer/auto-detect');
          await runAutoDetectInstaller({ skipPrompt: true, dryRun: opts.dryRun });
        } else {
          const { runInstaller } = await import('../installer/index');
          await runInstaller(target as any);
        }
      } else if (opts.all) {
        // --all flag: auto-detect and install all without prompting
        const { runAutoDetectInstaller } = await import('../installer/auto-detect');
        await runAutoDetectInstaller({ skipPrompt: true, dryRun: opts.dryRun });
      } else {
        // No target specified: auto-detect and prompt
        const { runAutoDetectInstaller } = await import('../installer/auto-detect');
        await runAutoDetectInstaller({ skipPrompt: false, dryRun: opts.dryRun });
      }
    });
}
