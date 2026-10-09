import type { IBufferLine, IUnicodeVersionProvider } from '@xterm/xterm';
import { afterEach, describe, expect, it } from 'vitest';
import type { RenderFrameInput, RenderFrameResult } from '@/engine/cmd/app/vim/render';
import { renderFrame } from '@/engine/cmd/app/vim/render';
import type { UnicodeTerminal } from '@/engine/cmd/unicodeTerminal';
import { createUnicodeTerminal } from '../../../../_helpers/unicodeTerminal';

const terminals: UnicodeTerminal[] = [];

afterEach(() => {
  for (const terminal of terminals.splice(0)) terminal.dispose();
});

async function createFrame(
  text: string,
  overrides: Partial<RenderFrameInput> = {}
): Promise<{ frame: RenderFrameResult; line: IBufferLine; terminal: UnicodeTerminal }> {
  const input = {
    lines: [text],
    cursor: { row: 0, col: text.length },
    topLine: 0,
    leftCol: 0,
    rows: 6,
    cols: 20,
    mode: 'NORMAL' as const,
    visualStart: null,
    fileName: 'sample.txt',
    modified: false,
    commandLine: '',
    message: '',
    ...overrides,
  };
  const terminal = await createUnicodeTerminal({ cols: input.cols, rows: input.rows });
  terminals.push(terminal);
  const frame = renderFrame({
    ...input,
    cellWidth: value => terminal.cellWidth(value),
  });
  await new Promise<void>(resolve => terminal.write(frame.output, resolve));
  const line = terminal.buffer.active.getLine(0);
  if (!line) throw new Error('Expected the rendered content row');
  if (line.isWrapped) throw new Error('Rendered content unexpectedly wrapped');
  return { frame, line, terminal };
}

function renderedWidth(line: IBufferLine, cols: number): number {
  let width = 0;
  for (let column = 0; column < cols; column += 1) {
    const cell = line.getCell(column);
    if (cell && cell.getChars()) width = Math.max(width, column + cell.getWidth());
  }
  return width;
}

describe('Vim renderer with the active xterm Unicode provider', () => {
  it.each(['😀', '👩‍💻', '👨‍👩‍👧', '🇯🇵', '1️⃣', 'é', '✈️', '界'])(
    'places the cursor after %s at the cell xterm renders',
    async text => {
      const { frame, line } = await createFrame(text);
      expect(frame.cursorCol - 1).toBe(renderedWidth(line, 20));
    }
  );

  it('uses the active xterm version for code points added after its grapheme table', async () => {
    const { frame, line, terminal } = await createFrame('🫨');
    expect(terminal.cellWidth('🫨')).toBe(1);
    expect(frame.cursorCol - 1).toBe(renderedWidth(line, 20));
  });

  it.each(['15', '15-graphemes'])(
    'measures text with the active %s provider used by xterm',
    async version => {
      const terminal = await createUnicodeTerminal({ cols: 20, rows: 4 });
      terminals.push(terminal);
      terminal.unicode.activeVersion = version;
      const text = '👩‍💻';
      await new Promise<void>(resolve => terminal.write(text, resolve));
      expect(terminal.cellWidth(text)).toBe(terminal.buffer.active.cursorX);
    }
  );

  it('requires a registered active provider instead of silently falling back', async () => {
    const terminal = await createUnicodeTerminal();
    terminals.push(terminal);
    terminal.unicode.activeVersion = '6';
    expect(() => terminal.cellWidth('text')).toThrow(
      'No Unicode provider registered for version: 6'
    );
  });

  it('uses providers registered through the public Unicode API', async () => {
    const terminal = await createUnicodeTerminal({ cols: 20, rows: 4 });
    terminals.push(terminal);
    const provider: IUnicodeVersionProvider = {
      version: 'test-single-cell',
      wcwidth: () => 1,
      charProperties: () => 2,
    };
    terminal.unicode.register(provider);
    terminal.unicode.activeVersion = provider.version;
    await new Promise<void>(resolve => terminal.write('😀', resolve));
    expect(terminal.cellWidth('😀')).toBe(1);
    expect(terminal.buffer.active.cursorX).toBe(1);
  });

  it('clips at display-cell boundaries without splitting wide glyphs', async () => {
    const { frame, line } = await createFrame('ab😀cd', {
      cursor: { row: 0, col: 4 },
      cols: 4,
    });
    expect(frame.leftCol).toBe(1);
    expect(renderedWidth(line, 4)).toBe(4);
    expect(line.getCell(1)?.getChars()).toBe('😀');
  });

  it('keeps content, status, and prompt rows unwrapped in xterm', async () => {
    const { terminal } = await createFrame('ab😀cd', {
      cols: 4,
      fileName: '😀x',
      message: 'ready',
    });
    expect(terminal.buffer.active.getLine(0)?.isWrapped).toBe(false);
    expect(terminal.buffer.active.getLine(1)?.isWrapped).toBe(false);
    expect(terminal.buffer.active.getLine(terminal.rows - 2)?.isWrapped).toBe(false);
    expect(terminal.buffer.active.getLine(terminal.rows - 1)?.isWrapped).toBe(false);
  });

  it('applies visual selection to the complete grapheme in xterm cells', async () => {
    const { line } = await createFrame('A😀B', {
      cursor: { row: 0, col: 2 },
      visualStart: { row: 0, col: 1 },
      mode: 'VISUAL',
    });
    expect(line.getCell(0)?.isInverse()).toBe(0);
    expect(line.getCell(1)?.isInverse()).toBeGreaterThan(0);
    expect(line.getCell(3)?.isInverse()).toBe(0);
  });

  it('fits status text by grapheme width and preserves reverse video', async () => {
    const { terminal } = await createFrame('', {
      cols: 3,
      fileName: '😀x',
    });
    const status = terminal.buffer.active.getLine(4);
    expect(status?.getCell(1)?.getChars()).toBe('😀');
    expect(status?.getCell(1)?.getWidth()).toBe(2);
    expect(status?.getCell(1)?.isInverse()).toBeGreaterThan(0);
  });
});
