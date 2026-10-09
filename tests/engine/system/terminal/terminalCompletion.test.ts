import { describe, expect, it, vi } from 'vitest';
import {
  completeTerminalLine,
  type TerminalCompletionSource,
} from '@/engine/system/terminal/terminalCompletion';
import { FSError } from '@/engine/core/fs/index';

function completionSource(
  entries: Array<{ path: string; type: string }> = [],
  commandNames: string[] = ['echo', 'exit']
): TerminalCompletionSource {
  return {
    getCommandNames: async () => commandNames,
    pwd: async () => '/workspace',
    normalizePath: path => path,
    readdir: vi.fn(async () => entries),
  };
}

describe('completeTerminalLine', () => {
  it('replaces a partial command token and preserves following arguments', async () => {
    const source = completionSource();
    const result = await completeTerminalLine('ec arg', 2, source);

    expect(result).toEqual({ state: { text: 'echo arg', cursor: 4 } });
  });

  it('includes terminal-only commands in command completion', async () => {
    const result = await completeTerminalLine('cle', 3, completionSource(), [
      'clear',
      'history',
      'vim',
    ]);

    expect(result).toEqual({ state: { text: 'clear ', cursor: 6 } });
  });

  it('uses absolute directories as absolute paths', async () => {
    const source = completionSource([{ path: '/etc/passwd', type: 'file' }], []);
    const result = await completeTerminalLine('/etc/pa', 7, source);

    expect(source.readdir).toHaveBeenCalledWith('/etc/');
    expect(result).toEqual({ state: { text: '/etc/passwd ', cursor: 12 } });
  });

  it('escapes spaces in inserted file names', async () => {
    const source = completionSource([{ path: '/workspace/my file.txt', type: 'file' }], []);
    const result = await completeTerminalLine('my', 2, source);

    expect(result).toEqual({ state: { text: 'my\\ file.txt ', cursor: 13 } });
  });

  it('silently ignores a missing candidate directory', async () => {
    const source = completionSource();
    vi.mocked(source.readdir).mockRejectedValue(new FSError('ENOENT', '/workspace/missing'));

    await expect(completeTerminalLine('missing/file', 12, source)).resolves.toBeUndefined();
  });

  it('sorts candidates and hides dotfiles unless the prefix starts with a dot', async () => {
    const source = completionSource(
      [
        { path: '/workspace/zeta', type: 'file' },
        { path: '/workspace/.hidden', type: 'file' },
        { path: '/workspace/alpha', type: 'file' },
      ],
      []
    );

    await expect(completeTerminalLine('', 0, source)).resolves.toEqual({
      candidates: ['alpha', 'zeta'],
    });
    await expect(completeTerminalLine('.', 1, source)).resolves.toEqual({
      state: { text: '.hidden ', cursor: 8 },
    });
  });

  it('escapes shell operators in inserted file names', async () => {
    const source = completionSource([{ path: '/workspace/a>b', type: 'file' }], []);

    expect(await completeTerminalLine('a', 1, source)).toEqual({
      state: { text: 'a\\>b ', cursor: 5 },
    });
  });

  it('does not complete through an existing shell operator', async () => {
    const source = completionSource([{ path: '/workspace/a>b', type: 'file' }], []);

    expect(await completeTerminalLine('cat a>b', 7, source)).toBeUndefined();
  });

  it('leaves quoted or escaped words untouched', async () => {
    const source = completionSource();

    expect(await completeTerminalLine('"ec"', 3, source)).toBeUndefined();
    expect(await completeTerminalLine('ec\\', 3, source)).toBeUndefined();
    expect(await completeTerminalLine('foo\\ bar', 8, source)).toBeUndefined();
    expect(source.readdir).not.toHaveBeenCalled();
  });
});
