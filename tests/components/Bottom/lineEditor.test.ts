import { describe, expect, it } from 'vitest';
import {
  editLine,
  insertLineText,
  type LineAction,
  type LineState,
  lineAction,
} from '@/components/Bottom/lineEditor';

describe('line editor', () => {
  it('moves and edits only at grapheme boundaries', () => {
    const state: LineState = { text: 'a👩‍💻がb', cursor: 1 };
    expect(editLine(state, 'right')).toEqual({ text: state.text, cursor: 6 });
    expect(editLine({ ...state, cursor: 2 }, 'backspace')).toEqual({ text: '👩‍💻がb', cursor: 0 });
  });

  it('inserts multiple characters at the middle cursor', () => {
    expect(insertLineText({ text: 'ac', cursor: 1 }, 'Bか')).toEqual({ text: 'aBかc', cursor: 3 });
  });

  it('places the cursor after a grapheme joined by inserted text', () => {
    expect(insertLineText({ text: '👩💻', cursor: 2 }, '\u200d')).toEqual({
      text: '👩‍💻',
      cursor: 5,
    });
  });

  it('deletes CJK graphemes and keeps empty-line boundaries stable', () => {
    expect(editLine({ text: '日本語', cursor: 2 }, 'delete')).toEqual({ text: '日本', cursor: 2 });
    expect(editLine({ text: '', cursor: 0 }, 'backspace')).toEqual({ text: '', cursor: 0 });
    expect(editLine({ text: '', cursor: 0 }, 'delete')).toEqual({ text: '', cursor: 0 });
    expect(editLine({ text: '', cursor: 0 }, 'home')).toEqual({ text: '', cursor: 0 });
    expect(editLine({ text: '', cursor: 0 }, 'end')).toEqual({ text: '', cursor: 0 });
  });

  it('moves the cursor to a new grapheme boundary when deletion joins flags', () => {
    expect(editLine({ text: '🇦x🇧', cursor: 2 }, 'delete')).toEqual({
      text: '🇦🇧',
      cursor: 4,
    });
  });

  it('keeps Ctrl+W whitespace behavior and moves by Readline word boundaries', () => {
    const state = { text: 'one  two', cursor: 8 };
    expect(editLine(state, 'killWord')).toEqual({ text: 'one  ', cursor: 5 });
    expect(editLine(state, 'wordLeft')).toEqual({ text: 'one  two', cursor: 5 });
    expect(editLine({ ...state, cursor: 0 }, 'wordRight')).toEqual({ text: 'one  two', cursor: 3 });
  });

  it('uses punctuation as a Readline word boundary and keeps Unicode graphemes intact', () => {
    expect(editLine({ text: 'foo/bar', cursor: 7 }, 'wordLeft').cursor).toBe(4);
    expect(editLine({ text: 'foo/bar', cursor: 0 }, 'wordRight').cursor).toBe(3);
    expect(editLine({ text: 'foo_bar', cursor: 7 }, 'wordLeft').cursor).toBe(4);
    expect(editLine({ text: '界a\u0301x', cursor: 4 }, 'wordLeft').cursor).toBe(0);
    expect(editLine({ text: '界a\u0301x', cursor: 0 }, 'wordRight').cursor).toBe(4);
  });

  it('kills text at either line edge', () => {
    expect(editLine({ text: 'abc', cursor: 1 }, 'killStart')).toEqual({ text: 'bc', cursor: 0 });
    expect(editLine({ text: 'abc', cursor: 1 }, 'killEnd')).toEqual({ text: 'a', cursor: 1 });
  });

  it('normalizes pasted newlines and removes controls except tabs', () => {
    expect(insertLineText({ text: '', cursor: 0 }, 'a\r\nb\u0001\t\u007f\u0085')).toEqual({
      text: 'a b\t',
      cursor: 4,
    });
  });

  it('maps supported terminal control sequences to actions', () => {
    const cases: Array<[string, LineAction]> = [
      ['\u0001', 'home'],
      ['\u0005', 'end'],
      ['\u0002', 'left'],
      ['\u0006', 'right'],
      ['\u0004', 'delete'],
      ['\u0015', 'killStart'],
      ['\u0017', 'killWord'],
      ['\u000b', 'killEnd'],
      ['\u007f', 'backspace'],
      ['\u001b[1;5D', 'wordLeft'],
      ['\u001b[1;5C', 'wordRight'],
      ['\u001b[H', 'home'],
      ['\u001b[F', 'end'],
      ['\u001bOH', 'home'],
      ['\u001bOF', 'end'],
      ['\u001b[1~', 'home'],
      ['\u001b[4~', 'end'],
      ['\u001b[7~', 'home'],
      ['\u001b[8~', 'end'],
      ['\u001b[3~', 'delete'],
      ['\u001b[D', 'left'],
      ['\u001b[C', 'right'],
    ];
    for (const [input, expected] of cases) expect(lineAction(input)).toBe(expected);
    expect(lineAction('x')).toBeUndefined();
    expect(lineAction('constructor')).toBeUndefined();
    expect(lineAction('toString')).toBeUndefined();
  });
});
