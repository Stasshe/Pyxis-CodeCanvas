/**
 * TerminalUI - Advanced terminal display API
 *
 * This module provides a systematic and professional API for advanced terminal
 * display capabilities including spinners, progress indicators, status lines,
 * and interactive output. It abstracts xterm.js ANSI escape codes into a
 * clean, reusable interface.
 *
 * Usage:
 *   const ui = new TerminalUI(writeCallback);
 *   await ui.spinner.start('Loading packages...');
 *   // ... do work ...
 *   await ui.spinner.stop();
 *   await ui.status('Completed in 2.3s');
 */

// ANSI escape codes
export const ANSI = {
  // Cursor control
  CURSOR_HIDE: '\x1b[?25l',
  CURSOR_SHOW: '\x1b[?25h',
  CURSOR_SAVE: '\x1b[s',
  CURSOR_RESTORE: '\x1b[u',

  // Line control
  CLEAR_LINE: '\r\x1b[K', // Clear entire line
  CLEAR_TO_END: '\x1b[0K', // Clear from cursor to end of line
  CLEAR_TO_START: '\x1b[1K', // Clear from cursor to start of line

  // Cursor movement
  MOVE_UP: (n: number) => `\x1b[${n}A`,
  MOVE_DOWN: (n: number) => `\x1b[${n}B`,
  MOVE_RIGHT: (n: number) => `\x1b[${n}C`,
  MOVE_LEFT: (n: number) => `\x1b[${n}D`,
  MOVE_TO_COL: (n: number) => `\x1b[${n}G`,
  MOVE_TO: (row: number, col: number) => `\x1b[${row};${col}H`,

  // Colors (foreground)
  FG: {
    BLACK: '\x1b[30m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    BLUE: '\x1b[34m',
    MAGENTA: '\x1b[35m',
    CYAN: '\x1b[36m',
    WHITE: '\x1b[37m',
    GRAY: '\x1b[90m',
    BRIGHT_RED: '\x1b[91m',
    BRIGHT_GREEN: '\x1b[92m',
    BRIGHT_YELLOW: '\x1b[93m',
    BRIGHT_BLUE: '\x1b[94m',
    BRIGHT_MAGENTA: '\x1b[95m',
    BRIGHT_CYAN: '\x1b[96m',
    BRIGHT_WHITE: '\x1b[97m',
  },

  // Colors (background)
  BG: {
    BLACK: '\x1b[40m',
    RED: '\x1b[41m',
    GREEN: '\x1b[42m',
    YELLOW: '\x1b[43m',
    BLUE: '\x1b[44m',
    MAGENTA: '\x1b[45m',
    CYAN: '\x1b[46m',
    WHITE: '\x1b[47m',
  },

  // Text styles
  RESET: '\x1b[0m',
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  ITALIC: '\x1b[3m',
  UNDERLINE: '\x1b[4m',
  BLINK: '\x1b[5m',
  REVERSE: '\x1b[7m',
  HIDDEN: '\x1b[8m',
  STRIKETHROUGH: '\x1b[9m',
} as const;

// Spinner frame sets
export const SPINNERS = {
  // npm-like braille spinner
  BRAILLE: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  // Classic dots
  DOTS: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'],
  // Simple line
  LINE: ['-', '\\', '|', '/'],
  // Growing dots
  GROWING: ['.  ', '.. ', '...', '   '],
  // Arrow
  ARROW: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'],
  // Box bounce
  BOUNCE: ['▖', '▘', '▝', '▗'],
} as const;

export type SpinnerType = keyof typeof SPINNERS;

/**
 * Write callback type - function to write directly to the terminal
 */
export type WriteCallback = (text: string) => Promise<void> | void;

/**
 * Spinner controller for animated loading indicators
 */
export class SpinnerController {
  private frames: string[];
  private frameIndex = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private message = '';
  private write: WriteCallback;
  private color: string;
  private interval: number;
  private isRunning = false;

  constructor(
    write: WriteCallback,
    type: SpinnerType = 'BRAILLE',
    color: string = ANSI.FG.CYAN,
    interval = 80
  ) {
    this.write = write;
    this.frames = [...SPINNERS[type]];
    this.color = color;
    this.interval = interval;
  }

  /**
   * Get the current spinner frame with color
   */
  private getFrame(): string {
    const frame = this.frames[this.frameIndex % this.frames.length];
    return `${this.color}${frame}${ANSI.RESET}`;
  }

  /**
   * Start the spinner with an optional message
   */
  async start(message = ''): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.message = message;
    this.frameIndex = 0;

    // Hide cursor and write initial frame in single write to avoid newline issues
    const display = this.message ? `${this.getFrame()} ${this.message}` : this.getFrame();
    await this.write(ANSI.CURSOR_HIDE + display);

    // Start animation
    this.intervalId = setInterval(async () => {
      this.frameIndex++;
      // Clear line and rewrite in single write to avoid newline issues
      const display = this.message ? `${this.getFrame()} ${this.message}` : this.getFrame();
      await this.write(ANSI.CLEAR_LINE + display);
    }, this.interval);
  }

  /**
   * Update the spinner message while running
   */
  async update(message: string): Promise<void> {
    this.message = message;
    if (!this.isRunning) return;

    // Immediately update display - combine clear and write to avoid newline issues
    const display = this.message ? `${this.getFrame()} ${this.message}` : this.getFrame();
    await this.write(ANSI.CLEAR_LINE + display);
  }

  /**
   * Stop the spinner and optionally show a final message
   */
  async stop(finalMessage?: string): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Clear the spinner line and show cursor - combine into single write
    // If there's a final message, include it with newline
    if (finalMessage) {
      await this.write(`${ANSI.CLEAR_LINE + finalMessage}\n${ANSI.CURSOR_SHOW}`);
    } else {
      await this.write(ANSI.CLEAR_LINE + ANSI.CURSOR_SHOW);
    }
  }

  /**
   * Stop with success indicator
   */
  async success(message: string): Promise<void> {
    await this.stop(`${ANSI.FG.GREEN}✓${ANSI.RESET} ${message}`);
  }

  /**
   * Stop with error indicator
   */
  async error(message: string): Promise<void> {
    await this.stop(`${ANSI.FG.RED}✗${ANSI.RESET} ${message}`);
  }

  /**
   * Stop with warning indicator
   */
  async warn(message: string): Promise<void> {
    await this.stop(`${ANSI.FG.YELLOW}⚠${ANSI.RESET} ${message}`);
  }

  /**
   * Stop with info indicator
   */
  async info(message: string): Promise<void> {
    await this.stop(`${ANSI.FG.CYAN}ℹ${ANSI.RESET} ${message}`);
  }

  /**
   * Check if spinner is currently running
   */
  get running(): boolean {
    return this.isRunning;
  }
}

/**
 * Progress bar for showing completion percentage
 */
export class ProgressBar {
  private write: WriteCallback;
  private width: number;
  private current = 0;
  private total = 100;
  private message = '';
  private filledChar: string;
  private emptyChar: string;
  private isActive = false;

  constructor(write: WriteCallback, width = 30, filledChar = '█', emptyChar = '░') {
    this.write = write;
    this.width = width;
    this.filledChar = filledChar;
    this.emptyChar = emptyChar;
  }

  /**
   * Start the progress bar
   */
  async start(total = 100, message = ''): Promise<void> {
    this.total = total;
    this.current = 0;
    this.message = message;
    this.isActive = true;

    await this.write(ANSI.CURSOR_HIDE);
    await this.render();
  }

  /**
   * Update progress
   */
  async update(current: number, message?: string): Promise<void> {
    if (!this.isActive) return;
    this.current = Math.min(current, this.total);
    if (message !== undefined) {
      this.message = message;
    }
    await this.render();
  }

  /**
   * Increment progress by a step
   */
  async increment(step = 1, message?: string): Promise<void> {
    await this.update(this.current + step, message);
  }

  /**
   * Render the progress bar
   */
  private async render(): Promise<void> {
    const percent = Math.round((this.current / this.total) * 100);
    const filled = Math.round((this.current / this.total) * this.width);
    const empty = this.width - filled;

    const bar = `${ANSI.FG.GREEN}${this.filledChar.repeat(filled)}${ANSI.FG.GRAY}${this.emptyChar.repeat(empty)}${ANSI.RESET}`;
    const percentStr = `${percent}%`.padStart(4);

    const display = this.message ? `${bar} ${percentStr} ${this.message}` : `${bar} ${percentStr}`;

    await this.write(ANSI.CLEAR_LINE + display);
  }

  /**
   * Complete the progress bar
   */
  async complete(message?: string): Promise<void> {
    this.current = this.total;
    if (message !== undefined) {
      this.message = message;
    }
    await this.render();
    await this.write('\n');
    await this.write(ANSI.CURSOR_SHOW);
    this.isActive = false;
  }
}

/**
 * Status line for updating in-place status messages
 */
export class StatusLine {
  private write: WriteCallback;
  private isActive = false;

  constructor(write: WriteCallback) {
    this.write = write;
  }

  /**
   * Start status line mode
   */
  async start(): Promise<void> {
    this.isActive = true;
    await this.write(ANSI.CURSOR_HIDE);
  }

  /**
   * Update status text (replaces current line)
   */
  async update(text: string): Promise<void> {
    if (!this.isActive) {
      await this.write(text);
      return;
    }
    await this.write(ANSI.CLEAR_LINE + text);
  }

  /**
   * End status line mode and move to new line
   */
  async end(finalText?: string): Promise<void> {
    if (finalText) {
      await this.write(ANSI.CLEAR_LINE + finalText);
    }
    await this.write('\n');
    await this.write(ANSI.CURSOR_SHOW);
    this.isActive = false;
  }
}

/**
 * Main TerminalUI class - provides access to all terminal UI components
 */
export class TerminalUI {
  private write: WriteCallback;

  // UI components
  public spinner: SpinnerController;
  public progress: ProgressBar;
  public status: StatusLine;

  constructor(write: WriteCallback, spinnerType: SpinnerType = 'BRAILLE') {
    this.write = write;
    this.spinner = new SpinnerController(write, spinnerType);
    this.progress = new ProgressBar(write);
    this.status = new StatusLine(write);
  }

  /**
   * Write raw text to terminal
   */
  async print(text: string): Promise<void> {
    await this.write(text);
  }

  /**
   * Write text followed by newline
   */
  async println(text: string): Promise<void> {
    await this.write(`${text}\n`);
  }

  /**
   * Clear the current line
   */
  async clearLine(): Promise<void> {
    await this.write(ANSI.CLEAR_LINE);
  }

  /**
   * Write colored text
   */
  async colored(text: string, color: string): Promise<void> {
    await this.write(`${color}${text}${ANSI.RESET}`);
  }

  /**
   * Write success message (green checkmark)
   */
  async success(message: string): Promise<void> {
    await this.write(`${ANSI.FG.GREEN}✓${ANSI.RESET} ${message}\n`);
  }

  /**
   * Write error message (red X)
   */
  async error(message: string): Promise<void> {
    await this.write(`${ANSI.FG.RED}✗${ANSI.RESET} ${message}\n`);
  }

  /**
   * Write warning message (yellow triangle)
   */
  async warn(message: string): Promise<void> {
    await this.write(`${ANSI.FG.YELLOW}⚠${ANSI.RESET} ${message}\n`);
  }

  /**
   * Write info message (cyan info icon)
   */
  async info(message: string): Promise<void> {
    await this.write(`${ANSI.FG.CYAN}ℹ${ANSI.RESET} ${message}\n`);
  }

  /**
   * Write a tree item (for directory listings, etc)
   */
  async treeItem(text: string, isLast = false, indent = 0): Promise<void> {
    const prefix = '  '.repeat(indent) + (isLast ? '└── ' : '├── ');
    await this.write(`${ANSI.FG.GRAY}${prefix}${ANSI.RESET}${text}\n`);
  }

  /**
   * Write a dimmed/secondary text
   */
  async dim(text: string): Promise<void> {
    await this.write(`${ANSI.FG.GRAY}${text}${ANSI.RESET}`);
  }

  /**
   * Write bold text
   */
  async bold(text: string): Promise<void> {
    await this.write(`${ANSI.BOLD}${text}${ANSI.RESET}`);
  }

  /**
   * Create a new spinner with custom settings
   */
  createSpinner(
    type: SpinnerType = 'BRAILLE',
    color: string = ANSI.FG.CYAN,
    interval = 80
  ): SpinnerController {
    return new SpinnerController(this.write, type, color, interval);
  }

  /**
   * Create a new progress bar with custom settings
   */
  createProgressBar(width = 30, filledChar = '█', emptyChar = '░'): ProgressBar {
    return new ProgressBar(this.write, width, filledChar, emptyChar);
  }
}

/**
 * Create a TerminalUI instance from a write callback
 */
export function createTerminalUI(
  write: WriteCallback,
  spinnerType: SpinnerType = 'BRAILLE'
): TerminalUI {
  return new TerminalUI(write, spinnerType);
}

export default TerminalUI;
