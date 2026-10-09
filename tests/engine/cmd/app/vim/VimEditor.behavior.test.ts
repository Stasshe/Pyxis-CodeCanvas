import type { Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VimEditor } from '@/engine/cmd/app/vim/VimEditor';
import type { UnicodeTerminal } from '@/engine/cmd/unicodeTerminal';
import { fsClient } from '@/engine/core/fs';
import { createUnicodeTerminal } from '../../../../_helpers/unicodeTerminal';

describe('VimEditor behavior', () => {
  let terminal: UnicodeTerminal;
  let editor: VimEditor;
  let output: string[];
  let press: (input: string) => void;
  let resize: () => void;
  let inputDispose: ReturnType<typeof vi.fn>;
  let resizeDispose: ReturnType<typeof vi.fn>;

  function start(content = 'abc\ndef', fileName = 'sample.txt', path = '/sample.txt') {
    editor = new VimEditor(terminal, fileName, content, path);
    editor.start(vi.fn());
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
    inputDispose = vi.fn();
    resizeDispose = vi.fn();
    vi.spyOn(fsClient, 'writeFile').mockResolvedValue(undefined);
    vi.spyOn(terminal, 'write').mockImplementation(data => {
      output.push(data);
    });
    Object.defineProperty(terminal, 'onData', {
      configurable: true,
      value: (handler: Parameters<Terminal['onData']>[0]) => {
        press = input => handler(input);
        return { dispose: inputDispose };
      },
    });
    Object.defineProperty(terminal, 'onResize', {
      configurable: true,
      value: (handler: Parameters<Terminal['onResize']>[0]) => {
        resize = () => handler({ cols: terminal.cols, rows: terminal.rows });
        return { dispose: resizeDispose };
      },
    });
    start();
  });

  afterEach(() => {
    editor.dispose();
    terminal.dispose();
    vi.restoreAllMocks();
  });

  it('moves the deleted character after the cursor with xp', () => {
    press('x');
    press('p');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'bac\ndef\n');
  });

  it('yanks and pastes whole lines and deletes a line with dd', () => {
    press('y');
    press('y');
    press('p');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'abc\nabc\ndef\n');
    press('d');
    press('d');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenLastCalledWith('/sample.txt', 'abc\ndef\n');
  });

  it('pastes a characterwise selection spanning lines', () => {
    press('v');
    press('j');
    press('l');
    press('y');
    press('p');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'aabc\ndebc\ndef\n');
  });

  it('blocks register commands until Escape without preventing later edits', () => {
    press('"');
    press('_');
    press('d');
    press('d');
    expect(frame()).toContain('Registers and macros are unsupported');
    press('\x1b');
    press('i');
    press('X');
    press('\x1b');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'Xabc\ndef\n');
  });

  it.each(['q', '@'])('blocks the %s macro prefix until Escape', prefix => {
    press(prefix);
    press('a');
    press('X');
    press('q');
    expect(frame()).toContain('Registers and macros are unsupported');
    press('\x1b');
    press('i');
    press('Y');
    press('\x1b');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'Yabc\ndef\n');
  });

  it('blocks unsupported change text objects until Escape', () => {
    press('c');
    press('i');
    press('w');
    press('X');
    expect(frame()).toContain('Change commands are unsupported');
    press('\x1b');
    press('i');
    press('Y');
    press('\x1b');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'Yabc\ndef\n');
  });

  it('blocks visual text objects until Escape without changing the selection', () => {
    press('v');
    press('i');
    press('w');
    press('d');
    expect(frame()).toContain('Visual text objects are unsupported');
    press('\x1b');
    press('i');
    press('Y');
    press('\x1b');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'Yabc\ndef\n');
  });

  it('blocks visual register and macro prefixes before their suffix can change text', () => {
    press('v');
    press('"');
    press('b');
    press('y');
    expect(frame()).toContain('Registers and macros are unsupported');
    press('\x1b');
    press('p');
    press('i');
    press('X');
    press('\x1b');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'Xabc\ndef\n');
  });

  it('blocks a visual macro prefix before a destructive suffix', () => {
    press('v');
    press('@');
    press('d');
    expect(frame()).toContain('Registers and macros are unsupported');
    press('\x1b');
    press('i');
    press('X');
    press('\x1b');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'Xabc\ndef\n');
  });

  it('blocks unsupported count prefixes while preserving the zero motion', () => {
    editor.dispose();
    start('one\ntwo\nthree');
    press('l');
    press('0');
    expect(frame()).toContain('1,1');
    press('2');
    press('d');
    press('d');
    expect(frame()).toContain('Counts are unsupported');
    press('\x1b');
    press('i');
    press('X');
    press('\x1b');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'Xone\ntwo\nthree\n');
  });

  it('blocks visual count prefixes before a destructive command', () => {
    press('v');
    press('2');
    press('d');
    expect(frame()).toContain('Counts are unsupported');
    press('\x1b');
    press('i');
    press('X');
    press('\x1b');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'Xabc\ndef\n');
  });

  it('reports unsupported dot repeat and waits for Escape', () => {
    press('.');
    press('x');
    expect(frame()).toContain('Repeat command is unsupported');
    press('\x1b');
    press('i');
    press('Y');
    press('\x1b');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'Yabc\ndef\n');
  });

  it('reports global substitution matches rather than changed lines', () => {
    editor.dispose();
    start('aaa');
    enterCommand('s/a/x/g');
    expect(frame()).toContain('3 substitutions');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'xxx\n');
  });

  it('counts a non-global match once even when its regex has captures', () => {
    editor.dispose();
    start('aaa');
    enterCommand('s/(a)/x/');
    expect(frame()).toContain('1 substitutions');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'xaa\n');
  });

  it('counts no-op substitutions without adding an undo change', () => {
    editor.dispose();
    start('aaa');
    press('x');
    enterCommand('s/a/a/g');
    expect(frame()).toContain('2 substitutions');
    press('u');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'aaa\n');
  });

  it('repeats case-sensitive search relative to the current cursor across same-line matches', () => {
    editor.dispose();
    start('foo FOO foo');
    press('/');
    for (const key of 'foo') press(key);
    press('\r');
    expect(frame()).toContain('1,9');
    press('N');
    expect(frame()).toContain('1,1');
    press('n');
    expect(frame()).toContain('1,9');
    press('/');
    press('\r');
    expect(frame()).toContain('1,1');
  });

  it('interprets Ctrl-R as redo', () => {
    press('x');
    press('u');
    press('\x12');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'bc\ndef\n');
  });

  it('clears redo history when a new change branches after undo', () => {
    press('x');
    press('u');
    press('i');
    press('X');
    press('\x1b');
    press('\x12');
    expect(frame()).toContain('Already at newest change');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'Xabc\ndef\n');
  });

  it('preserves redo history after an empty insert session', () => {
    press('i');
    press('X');
    press('\x1b');
    press('u');
    press('i');
    press('\x1b');
    press('\x12');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'Xabc\ndef\n');
  });

  it('allows q after undo restores the saved content', () => {
    const onExit = vi.fn();
    editor.dispose();
    editor = new VimEditor(terminal, 'sample.txt', 'abc', '/sample.txt');
    editor.start(onExit);
    press('x');
    press('u');
    enterCommand('q');
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('retains edits made while a save is pending', async () => {
    let resolveWrite: (() => void) | undefined;
    vi.spyOn(fsClient, 'writeFile').mockImplementation(
      () =>
        new Promise<void>(resolve => {
          resolveWrite = resolve;
        })
    );
    enterCommand('w');
    press('i');
    press('X');
    press('\x1b');
    if (!resolveWrite) throw new Error('The pending write did not start');
    resolveWrite();
    await vi.waitFor(() => expect(frame()).toContain('written'));
    enterCommand('q');
    expect(fsClient.writeFile).toHaveBeenCalledOnce();
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'abc\ndef\n');
    expect(frame()).toContain('No write since last change');
  });

  it('does not exit when an unmodified wq write fails', async () => {
    vi.spyOn(fsClient, 'writeFile').mockRejectedValue(new Error('disk full'));
    const onExit = vi.fn();
    editor.dispose();
    editor = new VimEditor(terminal, 'sample.txt', 'abc', '/sample.txt');
    editor.start(onExit);
    enterCommand('wq');
    await vi.waitFor(() => expect(frame()).toContain('disk full'));
    expect(onExit).not.toHaveBeenCalled();
  });

  it('disposes input and resize subscriptions', () => {
    resize();
    editor.dispose();
    expect(inputDispose).toHaveBeenCalledOnce();
    expect(resizeDispose).toHaveBeenCalledOnce();
  });

  it('inserts every character from a multi-character Unicode paste event', () => {
    press('i');
    press('日本語');
    press('\x1b');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', '日本語abc\ndef\n');
  });

  it('inserts a multi-character event into an empty buffer', () => {
    editor.dispose();
    start('');
    press('i');
    press('ab😀cd');
    press('\x1b');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'ab😀cd\n');
  });

  it('inserts a multi-character event at the end of an existing line', () => {
    press('A');
    press('😀xy');
    press('\x1b');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenCalledWith('/sample.txt', 'abc😀xy\ndef\n');
  });

  it('inserts and deletes an astral Unicode character as one character', () => {
    press('i');
    press('😀');
    press('\x1b');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenLastCalledWith('/sample.txt', '😀abc\ndef\n');
    press('x');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenLastCalledWith('/sample.txt', 'abc\ndef\n');
  });

  it('treats punctuation as a word boundary for w and e', () => {
    editor.dispose();
    start('foo.bar baz');
    press('w');
    expect(frame()).toContain('1,4');
    press('e');
    expect(frame()).toContain('1,7');
  });

  it('moves across punctuation runs with w, b, and e', () => {
    editor.dispose();
    start('foo...bar baz');
    press('w');
    expect(frame()).toContain('1,4');
    press('w');
    expect(frame()).toContain('1,7');
    press('b');
    expect(frame()).toContain('1,4');
    press('e');
    expect(frame()).toContain('1,6');
    press('e');
    expect(frame()).toContain('1,9');
  });

  it('pastes and deletes an emoji at a grapheme boundary', () => {
    editor.dispose();
    start('😀ab');
    press('v');
    press('y');
    press('$');
    press('p');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenLastCalledWith('/sample.txt', '😀ab😀\n');
    press('x');
    enterCommand('w');
    expect(fsClient.writeFile).toHaveBeenLastCalledWith('/sample.txt', '😀ab\n');
  });

  it('keeps the visual yank cursor at its original column', () => {
    editor.dispose();
    start('one\ntwo\nthree');
    press('l');
    press('v');
    press('l');
    press('j');
    press('y');
    expect(frame()).toContain('1,2');
  });

  it('moves the visual yank cursor to the selection start after a backward selection', () => {
    editor.dispose();
    start('one\ntwo\nthree');
    press('l');
    press('l');
    press('v');
    press('h');
    press('y');
    expect(frame()).toContain('1,2');
  });
});
