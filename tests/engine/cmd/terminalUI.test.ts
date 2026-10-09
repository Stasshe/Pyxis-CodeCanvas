import { Terminal as XTerm } from '@xterm/xterm';
import stringWidth from 'string-width';
import { describe, expect, it, vi } from 'vitest';
import TerminalOutputManager, { type IXTermInstance } from '@/engine/cmd/terminalOutputManager';
import { ProgressBar, SpinnerController, TerminalUI } from '@/engine/cmd/terminalUI';

class TestTerminal implements IXTermInstance {
  cols = 80;
  buffer = { active: { cursorX: 0, cursorY: 0 } };
  writes: string[] = [];

  write(data: string, callback?: () => void): void {
    this.writes.push(data);
    callback?.();
  }

  writeln(data: string): void {
    this.writes.push(`${data}\r\n`);
  }
}

describe('SpinnerController', () => {
  it('keeps the spinner and message within the terminal width', async () => {
    const terminal = new TestTerminal();
    terminal.cols = 12;
    const spinner = new SpinnerController(new TerminalOutputManager(terminal));

    await spinner.start('Installing a-very-long-package-name@1.0.0');
    const frame = terminal.writes.at(-1) ?? '';

    expect(stringWidth(frame)).toBeLessThanOrEqual(terminal.cols - 1);
    expect(frame).toContain('Install');
    await spinner.stop();
  });

  it('truncates only at grapheme boundaries and adapts to narrower columns', async () => {
    const terminal = new TestTerminal();
    terminal.cols = 12;
    const spinner = new SpinnerController(new TerminalOutputManager(terminal));
    const family = '👩‍👩‍👧‍👦';

    await spinner.start(`a${family}bcdefgh`);
    const firstFrame = terminal.writes.at(-1) ?? '';
    expect(firstFrame).toContain(family);
    expect(stringWidth(firstFrame)).toBeLessThanOrEqual(terminal.cols - 1);

    terminal.cols = 2;
    await spinner.update('message too long');
    const narrowFrame = terminal.writes.at(-1) ?? '';
    expect(stringWidth(narrowFrame)).toBeLessThanOrEqual(terminal.cols - 1);
    await spinner.stop();
  });
});

describe('TerminalUI', () => {
  it('stops its active spinner when disposed', async () => {
    vi.useFakeTimers();
    const terminal = new TestTerminal();
    const ui = new TerminalUI(new TerminalOutputManager(terminal));

    try {
      await ui.spinner.start('working');
      await ui.dispose();
      const writeCount = terminal.writes.length;
      await vi.advanceTimersByTimeAsync(200);

      expect(ui.spinner.running).toBe(false);
      expect(terminal.writes).toHaveLength(writeCount);
    } finally {
      await ui.dispose();
      vi.useRealTimers();
    }
  });
});

describe('ProgressBar', () => {
  it('keeps progress within terminal width and handles an empty total', async () => {
    const terminal = new TestTerminal();
    terminal.cols = 12;
    const progress = new ProgressBar(new TerminalOutputManager(terminal), 30);

    await progress.start(0, 'Done');
    await progress.update(-4);
    const frame = terminal.writes.at(-1) ?? '';

    expect(frame).toContain('0%');
    expect(stringWidth(frame)).toBeLessThanOrEqual(terminal.cols);
  });

  it('keeps non-finite progress inputs and wide custom glyphs within the terminal width', async () => {
    const terminal = new TestTerminal();
    terminal.cols = 12;
    const progress = new ProgressBar(new TerminalOutputManager(terminal), 30, '界', '界');

    await progress.start(Number.POSITIVE_INFINITY, 'Done');
    await progress.update(Number.NaN);

    const frame = terminal.writes.at(-1) ?? '';
    expect(frame).toContain('0%');
    expect(stringWidth(frame)).toBeLessThanOrEqual(terminal.cols - 1);
  });

  it('renders safely when the terminal has fewer columns than the percentage label', async () => {
    const terminal = new TestTerminal();
    const progress = new ProgressBar(new TerminalOutputManager(terminal));

    for (const columns of [0, 1, 2]) {
      terminal.cols = columns;
      await progress.start(100);
      const frame = terminal.writes.at(-1) ?? '';
      expect(stringWidth(frame)).toBeLessThanOrEqual(Math.max(0, columns - 1));
      await progress.complete();
    }
  });
});

describe('TerminalOutputManager', () => {
  it('preserves a CRLF split across write calls', async () => {
    const terminal = new TestTerminal();
    const manager = new TerminalOutputManager(terminal);

    await manager.writeRaw('partial\r');
    await manager.write('\nnext');

    expect(terminal.writes).toEqual(['partial\r', '\nnext']);
  });

  it('uses xterm cursor state after pending output before inserting a prompt newline', async () => {
    const terminal = new XTerm({ cols: 20, rows: 3 });
    const manager = new TerminalOutputManager(terminal);

    await manager.write('partial');
    await manager.ensureNewline();

    expect(manager.getCursorState()).toMatchObject({ atLineStart: true, x: 0, y: 1 });
    terminal.dispose();
  });
});
