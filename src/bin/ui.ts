export const violet = '\x1b[38;5;99m';
export const bold   = '\x1b[1m';
export const dim    = '\x1b[2m';
export const green  = '\x1b[38;5;114m';
export const reset  = '\x1b[0m';

export function label(text: string): string { return `${dim}${text}${reset}`; }
export function value(text: string): string { return `${violet}${bold}${text}${reset}`; }
export function section(text: string): string { return `${violet}${bold}${text}${reset}`; }

/** Render a two-column table with violet borders. Entries: [label, value] pairs. */
export function renderTable(entries: [string, string][], indent = '  '): string {
  if (entries.length === 0) return '';
  const colW = Math.max(...entries.map(([k]) => k.length));
  const top    = `${indent}${violet}┌${'─'.repeat(colW + 2)}┬${'─'.repeat(18)}┐${reset}`;
  const bottom = `${indent}${violet}└${'─'.repeat(colW + 2)}┴${'─'.repeat(18)}┘${reset}`;
  const rows = entries.map(([k, v], i) => {
    const sep = i < entries.length - 1
      ? `\n${indent}${violet}├${'─'.repeat(colW + 2)}┼${'─'.repeat(18)}┤${reset}`
      : '';
    const pad = ' '.repeat(colW - k.length);
    return `${indent}${violet}│${reset} ${dim}${k}${reset}${pad} ${violet}│${reset} ${violet}${bold}${v}${reset}${' '.repeat(Math.max(0, 16 - v.length))} ${violet}│${reset}${sep}`;
  });
  return [top, ...rows, bottom].join('\n');
}
