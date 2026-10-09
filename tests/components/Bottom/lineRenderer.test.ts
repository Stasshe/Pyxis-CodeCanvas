import { afterEach, describe, expect, it } from 'vitest';
import { insertLineText } from '@/components/Bottom/lineEditor';
import { captureLineAnchor, disposeLineAnchor, renderLine } from '@/components/Bottom/lineRenderer';
import type { UnicodeTerminal } from '@/engine/cmd/unicodeTerminal';
import { createUnicodeTerminal } from '../../_helpers/unicodeTerminal';

const terminals: UnicodeTerminal[] = [];

async function terminal(cols = 12, rows = 4): Promise<UnicodeTerminal> {
  const term = await createUnicodeTerminal({ cols, rows, scrollback: 100 });
  terminals.push(term);
  return term;
}

function write(term: UnicodeTerminal, text: string): Promise<void> {
  return new Promise(resolve => term.write(text, resolve));
}

function visible(term: UnicodeTerminal): string[] {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let row = 0; row < term.rows; row += 1) {
    lines.push(buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? '');
  }
  return lines;
}

afterEach(() => {
  for (const term of terminals.splice(0)) term.dispose();
});

describe('line renderer with actual xterm buffers', () => {
  it('places the cursor using xterm wide and combined cells', async () => {
    const term = await terminal();
    await write(term, '> ');
    const anchor = captureLineAnchor(term);
    const state = { text: '日👩‍💻がx', cursor: 6 };
    await renderLine(term, anchor, state);
    // The production Unicode provider treats the ZWJ emoji as one two-cell grapheme.
    expect(term.buffer.active.cursorX).toBe(6);
    expect(term.buffer.active.getLine(0)?.getCell(2)?.getWidth()).toBe(2);
    expect(term.buffer.active.getLine(0)?.getCell(4)?.getWidth()).toBe(2);
    expect(visible(term)[0]).toContain('日👩‍💻がx');
    disposeLineAnchor(anchor);
  });

  it('materializes exact-column pending wrap without overwriting input', async () => {
    const term = await terminal(8);
    await write(term, '$ ');
    const anchor = captureLineAnchor(term);
    await renderLine(term, anchor, { text: 'abcdef', cursor: 6 });
    expect(term.buffer.active.cursorX).toBe(0);
    expect(term.buffer.active.cursorY).toBe(1);
    await renderLine(term, anchor, { text: 'abcdefgh', cursor: 6 });
    expect(visible(term).slice(0, 2)).toEqual(['$ abcdef', 'gh']);
    expect(term.buffer.active.cursorX).toBe(0);
    disposeLineAnchor(anchor);
  });

  it('places the cursor on a wide glyph after wrap padding', async () => {
    const term = await terminal(8);
    await write(term, '> ');
    const anchor = captureLineAnchor(term);
    await renderLine(term, anchor, { text: 'abcde日x', cursor: 5 });
    expect(term.buffer.active.cursorX).toBe(0);
    expect(term.buffer.active.cursorY).toBe(1);
    expect(visible(term).slice(0, 2)).toEqual(['> abcde', '日x']);
    disposeLineAnchor(anchor);
  });

  it('reflows a right-margin airplane when a later variation selector makes it wide', async () => {
    const term = await terminal(8);
    await write(term, '> ');
    const anchor = captureLineAnchor(term);
    let state = { text: 'abcde✈', cursor: 6 };
    await renderLine(term, anchor, state);
    expect(term.buffer.active.getLine(0)?.getCell(7)?.getWidth()).toBe(1);

    state = insertLineText(state, '\ufe0f');
    await renderLine(term, anchor, state);

    expect(visible(term).slice(0, 2)).toEqual(['> abcde', '✈️']);
    expect(term.buffer.active.getLine(1)?.getCell(0)?.getWidth()).toBe(2);
    expect(state.cursor).toBe(state.text.length);
    disposeLineAnchor(anchor);
  });

  it('keeps a ZWJ emoji intact when its final code point completes at the margin', async () => {
    const term = await terminal(8);
    await write(term, '> ');
    const anchor = captureLineAnchor(term);
    let state = { text: 'abcd👩', cursor: 6 };
    await renderLine(term, anchor, state);
    state = insertLineText(state, '\u200d');
    await renderLine(term, anchor, state);
    state = insertLineText(state, '💻');
    await renderLine(term, anchor, state);

    expect(visible(term).slice(0, 2)).toEqual(['> abcd👩‍💻', '']);
    expect(term.buffer.active.getLine(0)?.getCell(6)?.getWidth()).toBe(2);
    expect(term.buffer.active.cursorY).toBe(1);
    expect(state.cursor).toBe(state.text.length);
    disposeLineAnchor(anchor);
  });

  it('observes terminal tab stops instead of treating tabs as one cell', async () => {
    const term = await terminal(20);
    await write(term, '> ');
    const anchor = captureLineAnchor(term);
    await renderLine(term, anchor, { text: 'a\tb', cursor: 2 });
    expect(term.buffer.active.cursorX).toBe(8);
    expect(visible(term)[0]).toBe('> a     b');
    await renderLine(term, anchor, { text: 'a\tb', cursor: 0 });
    expect(term.buffer.active.cursorX).toBe(2);
    expect(visible(term)[0]).toBe('> a     b');
    disposeLineAnchor(anchor);
  });

  it('clears obsolete wrapped rows after deleting text', async () => {
    const term = await terminal(8);
    await write(term, '> ');
    const anchor = captureLineAnchor(term);
    await renderLine(term, anchor, { text: 'abcdefghijklmn', cursor: 14 });
    await renderLine(term, anchor, { text: 'x', cursor: 1 });
    expect(visible(term)).toEqual(['> x', '', '', '']);
    disposeLineAnchor(anchor);
  });

  it('reanchors an off-screen prompt without requiring scrollback trim', async () => {
    const term = await terminal(20, 3);
    await write(term, '$ ');
    const anchor = captureLineAnchor(term);
    const state = { text: 'draft', cursor: 5 };
    await renderLine(term, anchor, state);
    const output = Array.from({ length: 20 }, (_, index) => `line-${index}`);
    await write(term, `\r\n${output.join('\r\n')}\r\n`);

    expect(anchor.marker.isDisposed).toBe(false);
    expect(anchor.marker.line).toBeLessThan(term.buffer.active.baseY);
    await renderLine(term, anchor, state);

    const buffer = term.buffer.active;
    expect(buffer.getLine(buffer.baseY + buffer.cursorY - 1)?.translateToString(true)).toBe(
      'line-19'
    );
    expect(buffer.getLine(buffer.baseY + buffer.cursorY)?.translateToString(true)).toBe('$ draft');
    disposeLineAnchor(anchor);
  });

  it('keeps recent output when scrollback trims the prompt anchor', async () => {
    const term = await terminal(20, 3);
    await write(term, '$ ');
    const anchor = captureLineAnchor(term);
    const state = { text: 'draft', cursor: 5 };
    await renderLine(term, anchor, state);
    await write(term, '\r\n');
    const output = Array.from({ length: 5105 }, (_, index) => `line-${index}`);
    await write(term, `${output.join('\r\n')}\x1b[1G`);

    expect(anchor.marker.isDisposed).toBe(true);
    await renderLine(term, anchor, state);

    const buffer = term.buffer.active;
    const latestOutput = buffer.getLine(buffer.baseY + buffer.cursorY - 1);
    const activeLine = buffer.getLine(buffer.baseY + buffer.cursorY);
    expect(latestOutput?.translateToString(true)).toBe('line-5104');
    expect(activeLine?.translateToString(true)).toBe('$ draft');
    disposeLineAnchor(anchor);
  });

  it('preserves background output when a cropped input is redrawn after resize', async () => {
    const term = await terminal(20, 3);
    await write(term, '$ ');
    const anchor = captureLineAnchor(term);
    const text = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const state = { text, cursor: 0 };
    await renderLine(term, anchor, state);

    const output = Array.from({ length: 20 }, (_, index) => `line-${index}`);
    await write(term, `\r\n${output.join('\r\n')}\r\n`);
    term.resize(8, 3);
    await renderLine(term, anchor, state);

    const buffer = term.buffer.active;
    const bufferText = Array.from(
      { length: buffer.length },
      (_, row) => buffer.getLine(row)?.translateToString(true) ?? ''
    );
    const visibleOutput = Array.from(
      { length: term.rows },
      (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? ''
    );
    expect(bufferText).toContain('line-19');
    expect(visibleOutput).toContain('line-19');
    expect(visibleOutput.some(line => line.startsWith('$ '))).toBe(true);
    expect(buffer.cursorY).toBeLessThan(term.rows);
    disposeLineAnchor(anchor);
  });

  it('replays a styled wrapped prompt after resizing', async () => {
    const term = await terminal(8);
    await write(term, '\x1b[31mlongprompt> \x1b[0m');
    const anchor = captureLineAnchor(term);
    await renderLine(term, anchor, { text: '日本abc', cursor: 2 });
    term.resize(6, 4);
    await renderLine(term, anchor, { text: '日本abc', cursor: 2 });
    expect(visible(term)).toEqual(['longpr', 'ompt> ', '日本ab', 'c']);
    expect(term.buffer.active.getLine(anchor.marker.line)?.getCell(0)?.getFgColor()).toBe(1);
    disposeLineAnchor(anchor);
  });

  it('preserves wide graphemes when the input reflows narrower and wider', async () => {
    const term = await terminal(14);
    await write(term, '> ');
    const anchor = captureLineAnchor(term);
    const text = 'ab日本👩‍💻xyz';
    const state = { text, cursor: text.length };
    await renderLine(term, anchor, state);

    term.resize(6, 4);
    await renderLine(term, anchor, state);
    expect(visible(term).join('')).toContain(`> ${text}`);

    term.resize(14, 4);
    await renderLine(term, anchor, state);
    expect(visible(term).join('')).toContain(`> ${text}`);
    expect(term.buffer.active.cursorX).toBe(13);
    disposeLineAnchor(anchor);
  });

  it('keeps Home and End editable on input longer than the viewport', async () => {
    const term = await terminal(8, 3);
    await write(term, '> ');
    const anchor = captureLineAnchor(term);
    const text = 'abcdefghijklmnopqrstuvwxyz'.repeat(4);
    const state = { text, cursor: 0 };
    await renderLine(term, anchor, state);
    expect(visible(term)[0]).toBe('> ');
    expect(term.buffer.active.cursorX).toBe(2);
    expect(state.text).toBe(text);
    const edited = `!${text}`;
    await renderLine(term, anchor, { text: edited, cursor: 1 });
    expect(visible(term)[0]).toBe('> !');
    await renderLine(term, anchor, { text: edited, cursor: edited.length });
    expect(visible(term).join('')).toContain(edited.slice(-16));
    expect(term.buffer.active.cursorY).toBeLessThan(term.rows);
    await renderLine(term, anchor, { text: edited, cursor: 0 });
    expect(term.buffer.active.cursorX).toBe(2);
    disposeLineAnchor(anchor);
  });

  it('serializes writes and ignores queued redraws after disposal', async () => {
    const term = await terminal();
    await write(term, '> ');
    const anchor = captureLineAnchor(term);
    const first = renderLine(term, anchor, { text: 'first', cursor: 5 });
    const second = renderLine(term, anchor, { text: 'second', cursor: 6 });
    await Promise.all([first, second]);
    expect(visible(term)[0]).toBe('> second');
    disposeLineAnchor(anchor);
    await renderLine(term, anchor, { text: 'ignored', cursor: 7 });
    expect(visible(term)[0]).toBe('> second');
  });

  it('ignores a normal-screen anchor after the terminal enters the alternate buffer', async () => {
    const term = await terminal();
    await write(term, '$ ');
    const anchor = captureLineAnchor(term);
    await write(term, '\x1b[?1049hRAW');

    await renderLine(term, anchor, { text: 'stale', cursor: 5 });

    expect(term.buffer.active.type).toBe('alternate');
    expect(visible(term)[0].trimStart()).toBe('RAW');
    expect(anchor.disposed).toBe(true);
    await write(term, '\x1b[?1049l');
  });

  it('ignores a queued redraw after its input session ends', async () => {
    const term = await terminal();
    await write(term, '$ ');
    let current = true;
    const anchor = captureLineAnchor(term, () => current);
    const pending = renderLine(term, anchor, { text: 'stale', cursor: 5 });
    current = false;
    await pending;

    expect(visible(term)[0]).toBe('$ ');
    expect(anchor.disposed).toBe(true);
  });
});
