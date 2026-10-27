import { describe, expect, it, vi } from 'vitest';

import type { ProjectFile } from '../../../../extensions/_shared/systemModuleTypes';
import { scanTodos } from '../../../../extensions/todo-panel/todoScanner';

function file(path: string, type: ProjectFile['type'] = 'file'): ProjectFile {
  return { path, type, size: 0, mtime: 0 };
}

function textBytes(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

describe('scanTodos', () => {
  it('prunes excluded directories and scans valid text only', async () => {
    const readFile = vi.fn(async (path: string) => {
      if (path.endsWith('.png')) return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff]);
      if (path.endsWith('.invalid')) return new Uint8Array([0xff, 0xfe]);
      if (path.endsWith('.nul')) return new Uint8Array([0x54, 0x4f, 0, 0x44, 0x4f]);
      return textBytes('// TODO: keep this item');
    });
    const fsClient = {
      readdir: vi.fn(async (path: string) => {
        const entries: Record<string, ProjectFile[]> = {
          '/workspace': [
            file('/workspace/.git', 'folder'),
            file('/workspace/node_modules', 'folder'),
            file('/workspace/src', 'folder'),
          ],
          '/workspace/src': [
            file('/workspace/src/node_modules-helper.ts'),
            file('/workspace/src/.git'),
            file('/workspace/src/pipe', 'fifo'),
            file('/workspace/src/device', 'characterDevice'),
            file('/workspace/src/link', 'symlink'),
            file('/workspace/src/keep.png'),
            file('/workspace/src/keep.invalid'),
            file('/workspace/src/keep.nul'),
            file('/workspace/src/keep.ts'),
          ],
        };
        return entries[path] ?? [];
      }),
      readFile,
    };

    const todos = await scanTodos(fsClient, '/workspace', () => true);

    expect(fsClient.readdir.mock.calls.map(([path]) => path)).toEqual([
      '/workspace',
      '/workspace/src',
    ]);
    expect(readFile.mock.calls.map(([path]) => path)).toEqual([
      '/workspace/src/node_modules-helper.ts',
      '/workspace/src/keep.png',
      '/workspace/src/keep.invalid',
      '/workspace/src/keep.nul',
      '/workspace/src/keep.ts',
    ]);
    expect(
      todos?.map(({ text, filePath, line, projectName }) => ({ text, filePath, line, projectName }))
    ).toEqual([
      {
        text: 'keep this item',
        filePath: '/workspace/src/node_modules-helper.ts',
        line: 1,
        projectName: 'workspace',
      },
      {
        text: 'keep this item',
        filePath: '/workspace/src/keep.ts',
        line: 1,
        projectName: 'workspace',
      },
    ]);
  });

  it('discards results and stops reading after a scan is invalidated', async () => {
    let resolveRead!: (bytes: Uint8Array) => void;
    let current = true;
    const readFile = vi.fn(
      () =>
        new Promise<Uint8Array>(resolve => {
          resolveRead = resolve;
        })
    );
    const fsClient = {
      readdir: vi.fn(async () => [file('/workspace/first.ts'), file('/workspace/second.ts')]),
      readFile,
    };

    const scan = scanTodos(fsClient, '/workspace', () => current);
    while (!resolveRead) await Promise.resolve();
    current = false;
    resolveRead(textBytes('// TODO: stale result'));

    await expect(scan).resolves.toBeNull();
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith('/workspace/first.ts');
  });
});
