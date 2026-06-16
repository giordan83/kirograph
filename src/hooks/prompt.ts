import * as readline from 'readline';

export interface ChoiceOption {
  label: string;
  value: string;
  description?: string;
}

const PAGE_SIZE = 10;

const violet = '\x1b[38;5;99m';
const reset = '\x1b[0m';
const dim = '\x1b[2m';
const bold = '\x1b[1m';
const green = '\x1b[32m';

const CURSOR_UP = '\x1b[A';
const CURSOR_DOWN = '\x1b[B';
const CURSOR_LEFT = '\x1b[D';
const CURSOR_RIGHT = '\x1b[C';
const CLEAR_LINE = '\x1b[2K\x1b[G';

/**
 * Returns true if stdout is a TTY (interactive terminal).
 */
export function isInteractive(): boolean {
  return !!process.stdout.isTTY;
}

function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

function pageSlice<T>(items: T[], page: number): T[] {
  const start = page * PAGE_SIZE;
  return items.slice(start, start + PAGE_SIZE);
}

function descLineCount(desc: string | undefined): number {
  if (!desc) return 0;
  const termWidth = process.stdout.columns || 80;
  return Math.max(1, Math.ceil((desc.length + 4) / termWidth));
}

interface RawKeySession {
  onKey: (handler: (key: string) => void) => void;
  cleanup: () => void;
}

function startRawKeySession(rl: readline.Interface): RawKeySession {
  rl.pause();
  const stdin = process.stdin;
  const wasTTY = stdin.isTTY;
  if (wasTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  let keyHandler: ((key: string) => void) | null = null;

  const onData = (key: string) => {
    keyHandler?.(key);
  };

  stdin.on('data', onData);

  return {
    onKey: (handler) => {
      keyHandler = handler;
    },
    cleanup: () => {
      stdin.removeListener('data', onData);
      if (wasTTY) stdin.setRawMode(false);
      stdin.pause();
      rl.resume();
    },
  };
}

function clearRenderedBlock(lineCount: number): void {
  if (lineCount <= 0) return;
  process.stdout.write(`\x1b[${lineCount}A`);
  for (let i = 0; i < lineCount; i++) {
    process.stdout.write(`${CLEAR_LINE}\n`);
  }
  process.stdout.write(`\x1b[${lineCount}A`);
}

/**
 * Display a single-choice menu with arrow-key navigation.
 * Paginates automatically when there are more than 10 options.
 */
export function singleChoice(
  message: string,
  options: ChoiceOption[]
): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const totalPages = pageCount(options.length);
    let page = 0;
    let selected = 0;
    let prevDescLines = 0;
    let renderedLines = 0;

    const getGlobalIndex = () => page * PAGE_SIZE + selected;
    const getDescription = () => options[getGlobalIndex()]?.description;

    const render = (first: boolean) => {
      const pageOptions = pageSlice(options, page);
      const desc = getDescription();
      const descLines = descLineCount(desc);
      const footer = totalPages > 1
        ? `${dim}Page ${page + 1}/${totalPages} · ←/→ change page · Enter select${reset}`
        : `${dim}↑/↓ navigate · Enter select${reset}`;

      const trailingLines = desc ? descLines : prevDescLines;
      const blockLines = 3 + pageOptions.length + trailingLines;

      if (!first) {
        process.stdout.write(`\x1b[${renderedLines}A`);
      }

      process.stdout.write(`${CLEAR_LINE}\n`);
      process.stdout.write(`${CLEAR_LINE}  ${violet}${message}${reset}\n`);
      process.stdout.write(`${CLEAR_LINE}  ${footer}\n`);

      for (let i = 0; i < pageOptions.length; i++) {
        const active = i === selected;
        const cursor = active ? `${green}${bold}❯${reset}` : ' ';
        const text = active
          ? `${bold}${pageOptions[i]!.label}${reset}`
          : `${dim}${pageOptions[i]!.label}${reset}`;
        process.stdout.write(`${CLEAR_LINE}  ${cursor} ${text}\n`);
      }

      if (desc) {
        process.stdout.write(`${CLEAR_LINE}  ${dim}${desc}${reset}\n`);
      } else if (prevDescLines > 0) {
        for (let i = 0; i < prevDescLines; i++) {
          process.stdout.write(`${CLEAR_LINE}\n`);
        }
      }

      prevDescLines = descLines;
      renderedLines = blockLines;
    };

    const session = startRawKeySession(rl);
    console.log('');
    render(true);

    session.onKey((key) => {
      const pageOptions = pageSlice(options, page);

      if (key === CURSOR_UP || key === '\x1b[A') {
        selected = (selected - 1 + pageOptions.length) % pageOptions.length;
        render(false);
      } else if (key === CURSOR_DOWN || key === '\x1b[B') {
        selected = (selected + 1) % pageOptions.length;
        render(false);
      } else if ((key === CURSOR_LEFT || key === '\x1b[D') && totalPages > 1) {
        page = (page - 1 + totalPages) % totalPages;
        selected = 0;
        render(false);
      } else if ((key === CURSOR_RIGHT || key === '\x1b[C') && totalPages > 1) {
        page = (page + 1) % totalPages;
        selected = 0;
        render(false);
      } else if (key === '\r' || key === '\n' || key === ' ') {
        const choice = options[getGlobalIndex()]!;
        session.cleanup();
        rl.close();
        clearRenderedBlock(renderedLines + 1);
        process.stdout.write(
          `${CLEAR_LINE}  ${green}${bold}✓${reset} ${message} ${green}${bold}${choice.label}${reset}\n`
        );
        resolve(choice.value);
      } else if (key === '\x03') {
        session.cleanup();
        rl.close();
        process.exit(1);
      }
    });
  });
}

/**
 * Display a multi-select checkbox menu with arrow-key navigation.
 * Paginates automatically when there are more than 10 options.
 */
export interface MultiSelectOptions {
  /** When Enter is pressed with no checkboxes toggled, save the focused item. */
  emptySelection?: 'none' | 'focused';
}

export function multiSelect(
  message: string,
  options: ChoiceOption[],
  selectOpts: MultiSelectOptions = {}
): Promise<string[]> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const totalPages = pageCount(options.length);
    const selectedValues = new Set<string>();
    let page = 0;
    let cursor = 0;
    let renderedLines = 0;

    const getGlobalIndex = () => page * PAGE_SIZE + cursor;

    const render = (first: boolean) => {
      const pageOptions = pageSlice(options, page);
      const pageHint = totalPages > 1 ? ` · ←/→ page` : '';
      const enterHint = selectOpts.emptySelection === 'focused'
        ? ' · Enter save focused'
        : ' · Enter confirm';
      const footer =
        `${dim}${selectedValues.size} selected${pageHint} · Space toggle${enterHint}${reset}`;

      const blockLines = 3 + pageOptions.length + (totalPages > 1 ? 1 : 0);

      if (!first) {
        process.stdout.write(`\x1b[${renderedLines}A`);
      }

      process.stdout.write(`${CLEAR_LINE}\n`);
      process.stdout.write(`${CLEAR_LINE}  ${violet}${message}${reset}\n`);
      process.stdout.write(`${CLEAR_LINE}  ${footer}\n`);

      for (let i = 0; i < pageOptions.length; i++) {
        const opt = pageOptions[i]!;
        const active = i === cursor;
        const checked = selectedValues.has(opt.value);
        const mark = checked ? `${green}[x]${reset}` : `${dim}[ ]${reset}`;
        const pointer = active ? `${green}${bold}❯${reset}` : ' ';
        const text = active
          ? `${bold}${opt.label}${reset}`
          : `${dim}${opt.label}${reset}`;
        process.stdout.write(`${CLEAR_LINE}  ${pointer} ${mark} ${text}\n`);
      }

      if (totalPages > 1) {
        process.stdout.write(`${CLEAR_LINE}  ${dim}Page ${page + 1}/${totalPages}${reset}\n`);
      }

      renderedLines = blockLines;
    };

    const session = startRawKeySession(rl);
    console.log('');
    render(true);

    session.onKey((key) => {
      const pageOptions = pageSlice(options, page);

      if (key === CURSOR_UP || key === '\x1b[A') {
        cursor = (cursor - 1 + pageOptions.length) % pageOptions.length;
        render(false);
      } else if (key === CURSOR_DOWN || key === '\x1b[B') {
        cursor = (cursor + 1) % pageOptions.length;
        render(false);
      } else if ((key === CURSOR_LEFT || key === '\x1b[D') && totalPages > 1) {
        page = (page - 1 + totalPages) % totalPages;
        cursor = 0;
        render(false);
      } else if ((key === CURSOR_RIGHT || key === '\x1b[C') && totalPages > 1) {
        page = (page + 1) % totalPages;
        cursor = 0;
        render(false);
      } else if (key === ' ') {
        const opt = options[getGlobalIndex()]!;
        if (selectedValues.has(opt.value)) {
          selectedValues.delete(opt.value);
        } else {
          selectedValues.add(opt.value);
        }
        render(false);
      } else if (key === '\r' || key === '\n') {
        let result = options
          .filter((opt) => selectedValues.has(opt.value))
          .map((opt) => opt.value);
        if (result.length === 0 && selectOpts.emptySelection === 'focused') {
          const focused = options[getGlobalIndex()];
          if (focused) result = [focused.value];
        }
        session.cleanup();
        rl.close();
        clearRenderedBlock(renderedLines + 1);
        const summary = result.length === 0
          ? `${dim}none${reset}`
          : `${green}${bold}${result.length}${reset} ${dim}hook${result.length === 1 ? '' : 's'}${reset}`;
        process.stdout.write(
          `${CLEAR_LINE}  ${green}${bold}✓${reset} ${message} ${summary}\n`
        );
        resolve(result);
      } else if (key === '\x03') {
        session.cleanup();
        rl.close();
        process.exit(1);
      }
    });
  });
}
