import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderFrame } from '@/engine/system/commands/vim/render';
import { createUnicodeTerminal } from '../../../../_helpers/unicodeTerminal';

let cellWidth: (text: string) => number;
let terminal: Awaited<ReturnType<typeof createUnicodeTerminal>>;

beforeAll(async () => {
  terminal = await createUnicodeTerminal();
  cellWidth = text => terminal.cellWidth(text);
});

afterAll(() => terminal.dispose());

function frame(overrides: Partial<Parameters<typeof renderFrame>[0]> = {}) {
  return renderFrame({
    lines: ['cat'],
    cursor: { row: 0, col: 0 },
    topLine: 0,
    leftCol: 0,
    rows: 6,
    cols: 20,
    mode: 'NORMAL',
    visualStart: null,
    fileName: 'sample.txt',
    modified: false,
    commandLine: '',
    message: '',
    cellWidth,
    ...overrides,
  });
}

describe('renderFrame', () => {
  it('expands tabs at eight-cell stops and displays control bytes safely', () => {
    const result = frame({ lines: ['a\tb\x1b\x7f'] });
    expect(result.output).toContain('a       b^[^?');
  });

  it('renders C1 control bytes as visible ASCII text', () => {
    const result = frame({ lines: ['\u009b31m'] });
    expect(result.output).toContain('<9b>31m');
    expect(result.output).not.toContain('\u009b');
  });

  it('selects a tab by its source offset while highlighting its expanded cells', () => {
    const result = frame({
      lines: ['a\tb'],
      cursor: { row: 0, col: 1 },
      visualStart: { row: 0, col: 1 },
      mode: 'VISUAL',
    });
    expect(result.output).toContain('\x1b[7m       \x1b[27m');
  });

  it('maps UTF-16 cursor offsets to Unicode display cells without splitting surrogate pairs', () => {
    const result = frame({ lines: ['A😀B'], cursor: { row: 0, col: 4 }, cols: 8 });
    expect(result.cursorCol).toBe(5);
  });

  it('keeps combining marks and joined emoji together for display-cell mapping', () => {
    const line = 'e\u0301👩‍💻x';
    const result = frame({ lines: [line], cursor: { row: 0, col: 7 }, cols: 8 });
    expect(result.output).toContain(line);
    expect(result.cursorCol).toBe(4);
  });

  it('scrolls horizontally until a wide-character cursor remains visible', () => {
    const result = frame({ lines: ['ab界de'], cursor: { row: 0, col: 4 }, cols: 3 });
    expect(result.leftCol).toBe(3);
    expect(result.cursorCol).toBe(3);
  });

  it('highlights the visual endpoint inclusively by source offset', () => {
    const result = frame({
      lines: ['A😀B'],
      cursor: { row: 0, col: 2 },
      visualStart: { row: 0, col: 1 },
      mode: 'VISUAL',
    });
    expect(result.output).toContain('\x1b[7m😀\x1b[27m');
    expect(result.output).not.toContain('\x1b[7mA');
  });

  it('keeps cursor coordinates inside resized terminal dimensions', () => {
    const result = frame({
      lines: ['one', 'two', 'three'],
      cursor: { row: 2, col: 5 },
      topLine: 0,
      rows: 2,
      cols: 2,
      mode: 'COMMAND',
      commandLine: 'write',
    });
    expect(result.cursorRow).toBe(2);
    expect(result.cursorCol).toBe(2);
    expect(result.output).toContain('\x1b[2;2H');
  });

  it('moves the vertical viewport to keep the cursor visible', () => {
    const result = frame({
      lines: ['0', '1', '2', '3', '4'],
      cursor: { row: 4, col: 0 },
      topLine: 0,
      rows: 5,
    });
    expect(result.topLine).toBe(2);
    expect(result.cursorRow).toBe(3);
  });

  it('renders search command lines with their slash prefix', () => {
    const result = frame({ mode: 'COMMAND', commandLine: '/needle' });
    expect(result.output).toContain('H\x1b[2K/needle');
    expect(result.output).not.toContain(': /needle');
  });
});
