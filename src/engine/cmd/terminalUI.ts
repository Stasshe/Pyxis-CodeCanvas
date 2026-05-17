import type TerminalOutputManager from './terminalOutputManager';

export type WriteCallback = (text: string) => Promise<void> | void;

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
export const ANSI = {
  CURSOR_HIDE: '\x1b[?25l',
  CURSOR_SHOW: '\x1b[?25h',
  CURSOR_SAVE: '\x1b[s',
  CURSOR_RESTORE: '\x1b[u',

  CLEAR_LINE: '\r\x1b[K',
  CLEAR_TO_END: '\x1b[0K',
  CLEAR_TO_START: '\x1b[1K',

  MOVE_UP: (n: number) => `\x1b[${n}A`,
  MOVE_DOWN: (n: number) => `\x1b[${n}B`,
  MOVE_RIGHT: (n: number) => `\x1b[${n}C`,
  MOVE_LEFT: (n: number) => `\x1b[${n}D`,
  MOVE_TO_COL: (n: number) => `\x1b[${n}G`,
  MOVE_TO: (row: number, col: number) => `\x1b[${row};${col}H`,

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

export const SPINNERS = {
  BRAILLE: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  DOTS: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'],
  LINE: ['-', '\\', '|', '/'],
  GROWING: ['.  ', '.. ', '...', '   '],
  ARROW: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'],
  BOUNCE: ['▖', '▘', '▝', '▗'],
} as const;

export type SpinnerType = keyof typeof SPINNERS;

export class SpinnerController {
  private frames: string[];
  private frameIndex = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private message = '';
  private outputManager: TerminalOutputManager;
  private color: string;
  private interval: number;
  private isRunning = false;

  constructor(
    outputManager: TerminalOutputManager,
    type: SpinnerType = 'BRAILLE',
    color: string = ANSI.FG.CYAN,
    interval = 80
  ) {
    this.outputManager = outputManager;
    this.frames = [...SPINNERS[type]];
    this.color = color;
    this.interval = interval;
  }

  private renderFrame(): string {
    const frame = `${this.color}${this.frames[this.frameIndex % this.frames.length]}${ANSI.RESET}`;
    return this.message ? `${frame} ${this.message}` : frame;
  }

  async start(message = ''): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.message = message;
    this.frameIndex = 0;
    await this.outputManager.writeRaw(ANSI.CURSOR_HIDE + this.renderFrame());
    this.intervalId = setInterval(async () => {
      this.frameIndex++;
      await this.outputManager.writeRaw(ANSI.CLEAR_LINE + this.renderFrame());
    }, this.interval);
  }

  async update(message: string): Promise<void> {
    this.message = message;
    if (!this.isRunning) return;
    await this.outputManager.writeRaw(ANSI.CLEAR_LINE + this.renderFrame());
  }

  async stop(finalMessage?: string): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    const suffix = finalMessage ? `${finalMessage}\n` : '';
    await this.outputManager.writeRaw(`${ANSI.CLEAR_LINE}${suffix}${ANSI.CURSOR_SHOW}`);
  }

  private async stopWith(badge: string, message: string): Promise<void> {
    await this.stop(`${badge} ${message}`);
  }

  async success(message: string): Promise<void> {
    await this.stopWith(`${ANSI.FG.GREEN}✓${ANSI.RESET}`, message);
  }

  async error(message: string): Promise<void> {
    await this.stopWith(`${ANSI.FG.RED}✗${ANSI.RESET}`, message);
  }

  async warn(message: string): Promise<void> {
    await this.stopWith(`${ANSI.FG.YELLOW}warn:${ANSI.RESET}`, message);
  }

  async info(message: string): Promise<void> {
    await this.stopWith(`${ANSI.FG.CYAN}info:${ANSI.RESET}`, message);
  }

  get running(): boolean {
    return this.isRunning;
  }
}

export class ProgressBar {
  private outputManager: TerminalOutputManager;
  private width: number;
  private current = 0;
  private total = 100;
  private message = '';
  private filledChar: string;
  private emptyChar: string;
  private isActive = false;

  constructor(outputManager: TerminalOutputManager, width = 30, filledChar = '█', emptyChar = '░') {
    this.outputManager = outputManager;
    this.width = width;
    this.filledChar = filledChar;
    this.emptyChar = emptyChar;
  }

  async start(total = 100, message = ''): Promise<void> {
    this.total = total;
    this.current = 0;
    this.message = message;
    this.isActive = true;
    await this.outputManager.writeRaw(ANSI.CURSOR_HIDE);
    await this.render();
  }

  async update(current: number, message?: string): Promise<void> {
    if (!this.isActive) return;
    this.current = Math.min(current, this.total);
    if (message !== undefined) this.message = message;
    await this.render();
  }

  async increment(step = 1, message?: string): Promise<void> {
    await this.update(this.current + step, message);
  }

  private async render(): Promise<void> {
    const ratio = this.current / this.total;
    const filled = Math.round(ratio * this.width);
    const bar =
      `${ANSI.FG.GREEN}${this.filledChar.repeat(filled)}` +
      `${ANSI.FG.GRAY}${this.emptyChar.repeat(this.width - filled)}${ANSI.RESET}`;
    const percent = `${Math.round(ratio * 100)}%`.padStart(4);
    const display = this.message ? `${bar} ${percent} ${this.message}` : `${bar} ${percent}`;
    await this.outputManager.writeRaw(ANSI.CLEAR_LINE + display);
  }

  async complete(message?: string): Promise<void> {
    this.current = this.total;
    if (message !== undefined) this.message = message;
    await this.render();
    await this.outputManager.write('\n');
    await this.outputManager.writeRaw(ANSI.CURSOR_SHOW);
    this.isActive = false;
  }
}

export class StatusLine {
  private outputManager: TerminalOutputManager;
  private isActive = false;

  constructor(outputManager: TerminalOutputManager) {
    this.outputManager = outputManager;
  }

  async start(): Promise<void> {
    this.isActive = true;
    await this.outputManager.writeRaw(ANSI.CURSOR_HIDE);
  }

  async update(text: string): Promise<void> {
    if (!this.isActive) {
      await this.outputManager.write(text);
      return;
    }
    await this.outputManager.writeRaw(ANSI.CLEAR_LINE + text);
  }

  async end(finalText?: string): Promise<void> {
    if (finalText) await this.outputManager.writeRaw(ANSI.CLEAR_LINE + finalText);
    await this.outputManager.write('\n');
    await this.outputManager.writeRaw(ANSI.CURSOR_SHOW);
    this.isActive = false;
  }
}

export class TerminalUI {
  private outputManager: TerminalOutputManager;
  public spinner: SpinnerController;
  public progress: ProgressBar;
  public status: StatusLine;

  constructor(outputManager: TerminalOutputManager, spinnerType: SpinnerType = 'BRAILLE') {
    this.outputManager = outputManager;
    this.spinner = new SpinnerController(outputManager, spinnerType);
    this.progress = new ProgressBar(outputManager);
    this.status = new StatusLine(outputManager);
  }

  async print(text: string): Promise<void> {
    await this.outputManager.write(text);
  }

  async println(text: string): Promise<void> {
    await this.outputManager.writeln(text);
  }

  async clearLine(): Promise<void> {
    await this.outputManager.writeRaw(ANSI.CLEAR_LINE);
  }

  async colored(text: string, color: string): Promise<void> {
    await this.outputManager.write(`${color}${text}${ANSI.RESET}`);
  }

  async success(message: string): Promise<void> {
    await this.outputManager.writeSuccess(`✓ ${message}\n`);
  }

  async error(message: string): Promise<void> {
    await this.outputManager.writeError(`✗ ${message}\n`);
  }

  async warn(message: string): Promise<void> {
    await this.outputManager.writeWarning(`warn:  ${message}\n`);
  }

  async info(message: string): Promise<void> {
    await this.outputManager.writeInfo(`info:  ${message}\n`);
  }

  async treeItem(text: string, isLast = false, indent = 0): Promise<void> {
    const prefix = '  '.repeat(indent) + (isLast ? '└── ' : '├── ');
    await this.outputManager.writeDim(prefix);
    await this.outputManager.write(`${text}\n`);
  }

  async dim(text: string): Promise<void> {
    await this.outputManager.writeDim(text);
  }

  async bold(text: string): Promise<void> {
    await this.outputManager.write(`${ANSI.BOLD}${text}${ANSI.RESET}`);
  }

  createSpinner(type: SpinnerType = 'BRAILLE', color: string = ANSI.FG.CYAN, interval = 80): SpinnerController {
    return new SpinnerController(this.outputManager, type, color, interval);
  }

  createProgressBar(width = 30, filledChar = '█', emptyChar = '░'): ProgressBar {
    return new ProgressBar(this.outputManager, width, filledChar, emptyChar);
  }

  get manager(): TerminalOutputManager {
    return this.outputManager;
  }
}

export default TerminalUI;
