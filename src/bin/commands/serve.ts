import { Command } from 'commander';
import * as path from 'path';
import { dim, reset, violet, bold } from '../ui';

export function register(program: Command): void {
  program
    .command('serve')
    .description('Start the MCP server')
    .option('--mcp', 'Run as MCP stdio server')
    .option('--path <path>', 'Project path')
    .action(async (opts: { mcp?: boolean; path?: string }) => {
      if (!opts.mcp) {
        console.log(`\n  ${dim}Start the KiroGraph MCP server for Kiro.${reset}`);
        console.log(`\n  ${dim}Usage:${reset}  ${violet}${bold}kirograph serve --mcp${reset}`);
        console.log(`\n  ${dim}Add to${reset} ${violet}${bold}.kiro/settings/mcp.json${reset}${dim}:${reset}\n`);
        console.log(`  ${dim}${JSON.stringify({ mcpServers: { kirograph: { command: 'kirograph', args: ['serve', '--mcp'] } } }, null, 2).split('\n').join('\n  ')}${reset}\n`);
        return;
      }
      const { MCPServer } = await import('../../mcp/server');
      const server = new MCPServer(opts.path ? path.resolve(opts.path) : process.cwd());
      await server.start();
    });
}
