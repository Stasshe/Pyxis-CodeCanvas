import type { Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VimEditor } from '@/engine/cmd/app/vim/VimEditor';
import { fsClient } from '@/engine/core/fs';
import { createUnicodeTerminal } from '../../../../_helpers/unicodeTerminal';

describe('VimEditor', () => {
  let terminal: Awaited<ReturnType<typeof createUnicodeTerminal>>;
  let editor: VimEditor;
  let output: string[];
  let press: (key: string) => void;

  beforeEach(async () => {
    terminal = await createUnicodeTerminal({ cols: 20, rows: 6 });
    output = [];
    vi.spyOn(terminal, 'write').mockImplementation(data => {
      output.push(data);
    });
    Object.defineProperty(terminal, 'onData', {
      configurable: true,
      value: (handler: Parameters<Terminal['onData']>[0]) => {
        press = key => handler(key);
        return { dispose: vi.fn() };
      },
    });
    editor = new VimEditor(terminal, 'sample.txt', 'cat\ndog', '/sample.txt');
    editor.start(vi.fn());
  });

  afterEach(() => {
    editor.dispose();
    terminal.dispose();
    vi.restoreAllMocks();
  });

  it('renders the cursor with one-based terminal coordinates and keeps scrollback intact', () => {
    expect(output.join('')).toContain('\x1b[1;1H');
    expect(output.join('')).not.toContain('\x1b[3J');
  });

  it('waits for dd and yy instead of applying a timed single-key action', () => {
    press('d');
    expect(output.at(-1)).toContain('cat');
    press('d');
    expect(output.at(-1)).toContain('dog');
    press('y');
    press('y');
    press('p');
    expect(output.at(-1)).toContain('dog');
  });

  it('groups insert changes into undoable input events and writes the resulting file', async () => {
    const writeFile = vi.spyOn(fsClient, 'writeFile').mockResolvedValue(undefined);
    press('i');
    press('X');
    press('\x1b');
    press('u');
    press(':');
    for (const key of 'w') press(key);
    press('\r');
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledWith('/sample.txt', 'cat\ndog\n'));
  });

  it('does not exit after a failed write', async () => {
    vi.spyOn(fsClient, 'writeFile').mockRejectedValue(new Error('disk full'));
    const onExit = vi.fn();
    editor.dispose();
    editor = new VimEditor(terminal, 'sample.txt', 'cat', '/sample.txt');
    editor.start(onExit);
    press(':');
    press('w');
    press('q');
    press('\r');
    await vi.waitFor(() => expect(output.join('')).toContain('disk full'));
    expect(onExit).not.toHaveBeenCalled();
  });

  it('preserves CRLF and does not display a phantom line for a trailing newline', async () => {
    const writeFile = vi.spyOn(fsClient, 'writeFile').mockResolvedValue(undefined);
    editor.dispose();
    editor = new VimEditor(terminal, 'windows.txt', 'first\r\nsecond\r\n', '/windows.txt');
    editor.start(vi.fn());
    press(':');
    press('w');
    press('\r');
    await vi.waitFor(() =>
      expect(writeFile).toHaveBeenCalledWith('/windows.txt', 'first\r\nsecond\r\n')
    );
    expect(output.at(-1)).not.toContain('~\r\n~');
  });

  it('preserves a lone carriage return in an LF file', async () => {
    const writeFile = vi.spyOn(fsClient, 'writeFile').mockResolvedValue(undefined);
    editor.dispose();
    editor = new VimEditor(terminal, 'carriage-return.txt', 'ab\rcd\n', '/carriage-return.txt');
    editor.start(vi.fn());
    press(':');
    press('w');
    press('\r');
    await vi.waitFor(() =>
      expect(writeFile).toHaveBeenCalledWith('/carriage-return.txt', 'ab\rcd\n')
    );
  });

  it.each([
    ['first\r\nsecond\n', 'first\r\nsecond\n'],
    ['first\nsecond\r\n', 'first\nsecond\r\n'],
  ])('preserves mixed LF and CRLF line endings', async (content, expected) => {
    const writeFile = vi.spyOn(fsClient, 'writeFile').mockResolvedValue(undefined);
    editor.dispose();
    editor = new VimEditor(terminal, 'mixed.txt', content, '/mixed.txt');
    editor.start(vi.fn());
    press(':');
    press('w');
    press('\r');
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledWith('/mixed.txt', expected));
  });

  it('adds Vim’s default final newline to a nonempty file and leaves an empty new file empty', async () => {
    const writeFile = vi.spyOn(fsClient, 'writeFile').mockResolvedValue(undefined);
    editor.dispose();
    editor = new VimEditor(terminal, 'no-eol.txt', 'content', '/no-eol.txt');
    editor.start(vi.fn());
    press(':');
    press('w');
    press('\r');
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledWith('/no-eol.txt', 'content\n'));

    editor.dispose();
    editor = new VimEditor(terminal, 'empty.txt', '', '/empty.txt');
    editor.start(vi.fn());
    press(':');
    press('w');
    press('\r');
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledWith('/empty.txt', ''));
  });
});
