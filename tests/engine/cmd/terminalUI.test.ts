import stringWidth from 'string-width';
import TerminalOutputManager, { type IXTermInstance } from '@/engine/cmd/terminalOutputManager';
import { SpinnerController } from '@/engine/cmd/terminalUI';

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
