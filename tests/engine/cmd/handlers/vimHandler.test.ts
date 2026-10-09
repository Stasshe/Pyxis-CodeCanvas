import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VimEditor } from '@/engine/cmd/app/vim/VimEditor';
import { handleVimCommand } from '@/engine/cmd/handlers/vimHandler';
import { fsClient } from '@/engine/core/fs';
import { setupTestProject } from '../../../_helpers/testProject';
import { createUnicodeTerminal } from '../../../_helpers/unicodeTerminal';

describe('Vim file loading', () => {
  let terminal: Awaited<ReturnType<typeof createUnicodeTerminal>>;
  let project: Awaited<ReturnType<typeof setupTestProject>>;
  let output: string[];

  beforeEach(async () => {
    project = await setupTestProject('VimFileLoading');
    terminal = await createUnicodeTerminal();
    vi.spyOn(terminal, 'clear').mockImplementation(() => {});
    vi.spyOn(terminal, 'write').mockImplementation(() => {});
    vi.spyOn(VimEditor.prototype, 'start').mockImplementation(() => {});
    output = [];
  });

  afterEach(() => {
    terminal.dispose();
    vi.restoreAllMocks();
  });

  async function open(path: string) {
    return handleVimCommand(
      [path],
      null,
      text => {
        output.push(text);
      },
      project.rootPath,
      terminal
    );
  }

  it('rejects binary files before creating an editor and preserves their bytes', async () => {
    const path = `${project.rootPath}/binary.txt`;
    await project.repo.writeFile(path, new Uint8Array([0, 255, 128]));
    const write = vi.spyOn(fsClient, 'writeFile');
    expect(await open('binary.txt')).toBeNull();
    expect(output.join('')).toContain('Cannot edit binary file');
    expect(VimEditor.prototype.start).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(Array.from(await project.repo.readFile(path))).toEqual([0, 255, 128]);
  });

  it('reports read errors without opening an empty editor', async () => {
    vi.spyOn(fsClient, 'readFile').mockRejectedValue(
      Object.assign(new Error('Read failed'), { code: 'EIO' })
    );
    expect(await open('unreadable.txt')).toBeNull();
    expect(output.join('')).toContain('Read failed');
    expect(VimEditor.prototype.start).not.toHaveBeenCalled();
  });

  it('allows a new file only when the file is missing', async () => {
    expect(await open('new.txt')).toBeInstanceOf(VimEditor);
    expect(VimEditor.prototype.start).toHaveBeenCalledOnce();
    expect(await project.repo.exists(`${project.rootPath}/new.txt`)).toBe(false);
  });

  it('rejects multiple file arguments instead of silently ignoring later paths', async () => {
    const result = await handleVimCommand(
      ['first.txt', 'second.txt'],
      null,
      text => output.push(text),
      project.rootPath,
      terminal
    );

    expect(result).toBeNull();
    expect(output.join('')).toContain('Multiple files are not supported');
    expect(VimEditor.prototype.start).not.toHaveBeenCalled();
  });
});
