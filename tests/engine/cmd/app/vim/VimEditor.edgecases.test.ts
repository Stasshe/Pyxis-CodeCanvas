import type { Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VimEditor } from '@/engine/cmd/app/vim/VimEditor';
import type { UnicodeTerminal } from '@/engine/cmd/unicodeTerminal';
import { fsClient } from '@/engine/core/fs';
import { createUnicodeTerminal } from '../../../../_helpers/unicodeTerminal';

describe('VimEditor edge cases', () => {
  let terminal: UnicodeTerminal;
  let editor: VimEditor;
  let output: string[];
  let press: (input: string) => void;

  function start(content: string, onExit = vi.fn()) {
    editor = new VimEditor(terminal, 'sample.txt', content, '/sample.txt');
    editor.start(onExit);
  }

  function enterCommand(command: string) {
    press(':');
    for (const key of command) press(key);
    press('\r');
  }

  function frame(): string {
    const ansiSequence = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, 'g');
    return output.at(-1)?.replace(ansiSequence, '') ?? '';
  }

  beforeEach(async () => {
    terminal = await createUnicodeTerminal({ cols: 40, rows: 8 });
    output = [];
    vi.spyOn(fsClient, 'writeFile').mockResolvedValue(undefined);
    vi.spyOn(terminal, 'write').mockImplementation(data => output.push(data));
    Object.defineProperty(terminal, 'onData', {
      configurable: true,
      value: (handler: Parameters<Terminal['onData']>[0]) => {
        press = input => handler(input);
        return { dispose: vi.fn() };
      },
    });
    Object.defineProperty(terminal, 'onResize', {
      configurable: true,
      value: () => ({ dispose: vi.fn() }),
    });
  });

  afterEach(() => {
    editor.dispose();
    terminal.dispose();
    vi.restoreAllMocks();
  });

  it('deletes the final grapheme after moving to the end with $', () => {
    start('a😀x');
    press('$');
    press('x');
    press('x');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'a\n');
  });

  it('deletes whole graphemes through a visual deletion at the end of the line', () => {
    start('a😀x');
    press('$');
    press('v');
    press('d');
    press('x');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'a\n');
  });

  it('searches and deletes at an astral offset', () => {
    start('😀ab');
    press('/');
    press(String.fromCharCode(0xde00));
    press('\r');
    press('x');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'ab\n');
  });

  it('inserts combining and ZWJ graphemes', () => {
    start('x');
    press('i');
    press('e\u0301');
    press('👩‍👩‍👦');
    press('\x1b');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'e\u0301👩‍👩‍👦x\n');
  });

  it('searches for a combining grapheme', () => {
    start('e\u0301x');
    press('/');
    press('e\u0301');
    press('\r');
    expect(frame()).toContain('1 matches');
    expect(frame()).toContain('1,1');
  });

  it('searches for a ZWJ grapheme', () => {
    start('x\n👩‍👩‍👦');
    press('/');
    press('👩‍👩‍👦');
    press('\r');
    expect(frame()).toContain('1 matches');
    expect(frame()).toContain('2,1');
  });

  it('cancels a pending replace with Escape', () => {
    start('abc');
    press('r');
    press('\x1b');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'abc\n');
  });

  it.each(['\r', '\n', '\b', '\x7f'])('ignores %j as a replacement character', control => {
    start('abc');
    press('r');
    press(control);
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'abc\n');
  });

  it('moves e to the native word endpoints in cat dog', () => {
    start('cat dog');
    press('e');
    expect(frame()).toContain('1,3');
    press('e');
    expect(frame()).toContain('1,7');
  });

  it('moves w over a combining mark to the next word', () => {
    start('cafe\u0301 next');
    press('w');
    expect(frame()).toContain('1,7');
  });

  it('moves e to the end of a word with a combining mark', () => {
    start('cafe\u0301 next');
    press('e');
    expect(frame()).toContain('1,4');
  });

  it('keeps astral letters in the same word for e and deletes the native endpoint', () => {
    start('x 𐐀abc');
    press('w');
    press('e');
    press('x');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'x 𐐀ab\n');
  });

  it('moves b across an astral letter that belongs to a word', () => {
    start('x 𐐀abc y');
    press('w');
    press('w');
    press('b');
    press('x');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'x abc y\n');
  });

  it('selects complete astral graphemes with visual motion', () => {
    start('x 𐐀abc def');
    press('w');
    press('v');
    press('l');
    press('x');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'x bc def\n');
  });

  it.each([
    { content: 'ab界x\nq\nab界x', motions: ['l', 'l', 'l'], expected: 'ab界x\nq\nab界\n' },
    { content: 'a😀x\nq\na😀x', motions: ['l', 'l'], expected: 'a😀x\nq\na😀\n' },
    { content: 'abcde\n\tX\nabcdX', motions: ['l', 'l', 'l', 'l'], expected: 'abcde\n\tX\nabcd\n' },
  ])(
    'keeps the display-cell column across a short line in $content',
    ({ content, motions, expected }) => {
      start(content);
      for (const motion of motions) press(motion);
      press('j');
      press('j');
      press('x');
      enterCommand('w');
      expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', expected);
    }
  );

  it('keeps $ as the vertical end-of-line goal', () => {
    start('abcd\nx\nwxyzlong');
    press('$');
    press('j');
    press('j');
    press('x');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'abcd\nx\nwxyzlon\n');
  });

  it('keeps the end-of-line goal through a visual selection', () => {
    start('abcd\nx\nwxyzlong');
    press('$');
    press('v');
    press('j');
    press('j');
    press('x');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'abc\n');
  });

  it('keeps the numeric display goal for visual motion through a short line', () => {
    start('ab界x\nq\nab界x');
    press('l');
    press('l');
    press('l');
    press('v');
    press('j');
    press('j');
    press('x');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'ab界\n');
  });

  it('keeps the insert caret column through a short line', () => {
    start('abcd\nx\nwxyz');
    press('l');
    press('l');
    press('l');
    press('i');
    press('\x1b[B');
    press('\x1b[B');
    press('\x1b');
    press('x');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'abcd\nx\nwxz\n');
  });

  it('resets the insert caret goal after entering from a wide grapheme', () => {
    start('ab界x\nq\nab界x');
    press('l');
    press('l');
    press('l');
    press('i');
    press('\x1b[B');
    press('\x1b[B');
    press('\x1b');
    press('x');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'ab界x\nq\nabx\n');
  });

  it.each([
    { prefix: ['$', 'l'], expected: 'abcd\nx\nwxyzlon\n' },
    { prefix: ['$', 'd', '\x1b'], expected: 'abcd\nx\nwxyzlon\n' },
    { prefix: ['$', ':', '\x1b'], expected: 'abcd\nx\nwxyzlon\n' },
  ])(
    'preserves the end-of-line goal through no-op and cancelled prefixes',
    ({ prefix, expected }) => {
      start('abcd\nx\nwxyzlong');
      for (const key of prefix) press(key);
      press('j');
      press('j');
      press('x');
      enterCommand('w');
      expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', expected);
    }
  );

  it.each([{ motion: ['$', '0', 'j', 'x'] }, { motion: ['$', 'g', 'g', 'j', 'x'] }])(
    'resets the goal for explicit first-column motions',
    ({ motion }) => {
      start('x\nabcdef');
      for (const key of motion) press(key);
      enterCommand('w');
      expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'x\nbcdef\n');
    }
  );

  it('resets the goal when e moves from punctuation to the next line word', () => {
    start('foo...\nx\nabcdef');
    press('$');
    press('e');
    press('j');
    press('j');
    press('x');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'foo...\nx\nbcdef\n');
  });

  it('resets the end-of-line goal when e leaves the cursor unchanged at EOF', () => {
    start('abcdefghi\nx\nfoo...');
    press('G');
    press('$');
    press('e');
    press('k');
    press('k');
    press('x');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'abcdeghi\nx\nfoo...\n');
  });

  it('resets the numeric goal when leaving visual mode', () => {
    start('abcd\nx\nwxyzlong');
    press('$');
    press('v');
    press('\x1b');
    press('j');
    press('j');
    press('x');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'abcd\nx\nwxylong\n');
  });

  it('keeps insert-mode Down movement valid across shorter and longer lines', () => {
    start('abcdef\nxy\n123456');
    press('l');
    press('l');
    press('l');
    press('l');
    press('i');
    press('\x1b[B');
    press('S');
    press('\x1b[B');
    press('T');
    press('\x1b');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'abcdef\nxyS\n123T456\n');
  });

  it('removes a whole emoji from a command-line search with Backspace', () => {
    start('😀x');
    press('/');
    press('😀');
    press('\x7f');
    press('x');
    press('\r');
    expect(frame()).toContain('1,3');
  });

  it('processes an arrow and following character from one input event in insert mode', () => {
    start('ab');
    press('i');
    press('\x1b[CZ');
    press('\x1b');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'aZb\n');
  });

  it('clamps the cursor after a substitution shortens its line', () => {
    start('abcdef');
    press('$');
    enterCommand('s/.*/x/');
    expect(frame()).toContain('1,1');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'x\n');
  });

  it('enters insert mode at the first nonblank character with I', () => {
    start('  abc');
    press('I');
    press('X');
    press('\x1b');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', '  Xabc\n');
  });

  it('saves and exits with :wq!', async () => {
    const onExit = vi.fn();
    start('abc', onExit);
    enterCommand('wq!');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'abc\n');
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce());
  });

  it('saves with :w! followed by whitespace', () => {
    start('abc');
    enterCommand('w! ');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'abc\n');
  });

  it('accepts a substitute command without a trailing slash', () => {
    start('abc');
    enterCommand('s/a/b');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'bbc\n');
  });

  it('preserves a trailing space in a substitute replacement without a closing slash', () => {
    start('a');
    enterCommand('s/a/b ');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'b \n');
  });

  it('rejects an escaped substitute delimiter without changing content', () => {
    start('a/b');
    enterCommand('s/a\\/b/x/');
    expect(frame()).toContain('Invalid substitute command');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'a/b\n');
  });

  it('reports an invalid JavaScript regex without changing content', () => {
    start('abc');
    enterCommand('s/[/x/');
    expect(frame()).toContain('Invalid regex');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'abc\n');
  });

  it('counts and applies zero-width JavaScript matches', () => {
    start('aa');
    enterCommand('s/(?=a)/x/g');
    expect(frame()).toContain('2 substitutions');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'xaxa\n');
  });

  it('keeps zero-width global matches on Unicode code point boundaries', () => {
    start('😀x');
    enterCommand('s/(?=.)/_/g');
    expect(frame()).toContain('2 substitutions');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', '_😀_x\n');
  });

  it('advances zero-width searches by Unicode code point', () => {
    start('😀x');
    press('/');
    for (const key of '(?=.)') press(key);
    press('\r');
    expect(frame()).toContain('2 matches');
    press('n');
    press('x');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'x\n');
  });

  it.each([
    { content: '', pattern: '$', count: 1 },
    { content: 'x', pattern: '$', count: 1 },
    { content: '', pattern: '(?=)', count: 1 },
    { content: 'x', pattern: '(?=)', count: 2 },
  ])('finishes zero-width search for $pattern on $content', ({ content, pattern, count }) => {
    start(content);
    press('/');
    for (const key of pattern) press(key);
    press('\r');
    expect(frame()).toContain(`${count} matches`);
  });

  it.each([
    { content: 'abc\nz', count: 6 },
    { content: 'abc\n\nz', count: 7 },
  ])('starts zero-width searches at each line beginning in $content', ({ content, count }) => {
    start(content);
    press('/');
    for (const key of '(?=)') press(key);
    press('\r');
    expect(frame()).toContain(`${count} matches`);
  });

  it('uses JavaScript replacement tokens for captures and the full match', () => {
    start('ab');
    enterCommand('s/(a)(b)/[$1:$&]/');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', '[a:ab]\n');
  });

  it('rejects an empty substitute pattern after a previous search without changing content', () => {
    start('abc');
    press('/');
    press('b');
    press('\r');
    enterCommand('s//x/');
    expect(frame()).toContain('Empty substitute patterns');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'abc\n');
  });

  it('rejects a split substitute command without applying its first part', () => {
    start('ab');
    enterCommand('s/a/x/ | s/b/y/');
    expect(frame()).toContain('Invalid substitute command');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'ab\n');
  });

  it('reports unsupported window splitting without changing content', () => {
    start('abc');
    enterCommand('split');
    expect(frame()).toContain('Unknown command: split');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'abc\n');
  });

  it('searches for a pattern with a meaningful trailing space', () => {
    start('needle\nneedle ');
    press('/');
    for (const key of 'needle ') press(key);
    press('\r');
    expect(frame()).toContain('2,1');
  });

  it('saves an empty buffer after deleting its only line', () => {
    start('line');
    press('d');
    press('d');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', '');
  });

  it('keeps a completed wq exit after a later forced quit while the write is pending', async () => {
    let resolveWrite: (() => void) | undefined;
    vi.spyOn(fsClient, 'writeFile').mockImplementation(
      () =>
        new Promise<void>(resolve => {
          resolveWrite = resolve;
        })
    );
    const onExit = vi.fn();
    start('abc', onExit);
    enterCommand('wq');
    enterCommand('q!');
    if (!resolveWrite) throw new Error('The pending write did not start');
    resolveWrite();
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce());
  });

  it('does not exit after a pending wq write resolves following dispose', async () => {
    let resolveWrite: (() => void) | undefined;
    vi.spyOn(fsClient, 'writeFile').mockImplementation(
      () =>
        new Promise<void>(resolve => {
          resolveWrite = resolve;
        })
    );
    const onExit = vi.fn();
    start('abc', onExit);
    enterCommand('wq');
    if (!resolveWrite) throw new Error('The pending write did not start');
    editor.dispose();
    resolveWrite();
    await Promise.resolve();
    await Promise.resolve();
    expect(onExit).not.toHaveBeenCalled();
  });

  it('stops processing a batched input event after a forced quit', () => {
    const onExit = vi.fn();
    start('abc', onExit);
    press(':q!\riX\x1b:w\r');
    expect(onExit).toHaveBeenCalledOnce();
    expect(fsClient.writeFile).not.toHaveBeenCalled();
  });
});
