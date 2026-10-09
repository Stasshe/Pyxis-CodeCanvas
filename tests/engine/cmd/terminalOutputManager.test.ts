import type { Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it } from 'vitest';
import { TerminalOutputManager } from '@/engine/cmd/terminalOutputManager';
import { createUnicodeTerminal } from '../../_helpers/unicodeTerminal';

const terminals: Terminal[] = [];

afterEach(() => {
  for (const term of terminals.splice(0)) term.dispose();
});

describe('terminal output manager', () => {
  it('preserves ANSI control sequences split across process stderr chunks', async () => {
    const term = await createUnicodeTerminal({ cols: 20, rows: 3 });
    terminals.push(term);
    const output = new TerminalOutputManager(term);

    await output.write('\x1b[');
    await output.write('2K\rFAIL');

    expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe('FAIL');
  });

  it('waits for large output before placing the next prompt and keeps xterm scrollback bounded', async () => {
    const term = await createUnicodeTerminal({ cols: 20, rows: 3, scrollback: 5000 });
    terminals.push(term);
    const output = new TerminalOutputManager(term);
    const lines = Array.from(
      { length: 5100 },
      (_, index) => `line-${index.toString().padStart(5, '0')}`
    );

    await output.write(lines.join('\n'));
    await output.ensureNewline();
    await output.writeRaw('$ ');
    await output.flush();

    const buffer = term.buffer.active;
    expect(buffer.length).toBe(5003);
    expect(buffer.baseY).toBeLessThanOrEqual(5000);
    expect(buffer.getLine(buffer.baseY + buffer.cursorY)?.translateToString(true)).toBe('$ ');
  });

  it('resets ANSI color across separate output chunks', async () => {
    const term = await createUnicodeTerminal({ cols: 20, rows: 3 });
    terminals.push(term);
    const output = new TerminalOutputManager(term);

    await output.write('\x1b[31mred\x1b[');
    await output.write('0mplain');

    const line = term.buffer.active.getLine(0);
    expect(line?.getCell(0)?.getFgColor()).toBe(1);
    expect(line?.getCell(3)?.isFgDefault()).toBe(true);
    expect(line?.translateToString(true)).toBe('redplain');
  });
});
