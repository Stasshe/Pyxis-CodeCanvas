import { describe, expect, it, vi } from 'vitest';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs, repositoryPath } from '@/engine/core/fs/git';
import { WorkerGitCommands } from '@/engine/system/git/worker';

describe('Git filesystem encodings', () => {
  it('keeps null encodings raw and encodes empty files', async () => {
    const core = new FsCore();
    const path = '/tmp/repo/empty.bin';
    await core.mkdir('/tmp/repo', { recursive: true });
    await core.writeFile(path, new Uint8Array());
    const fs = createGitFs(core);

    expect(await fs.promises.readFile(path, null)).toEqual(new Uint8Array());
    expect(await fs.promises.readFile(path, { encoding: null })).toEqual(new Uint8Array());
    expect(await fs.promises.readFile(path, 'base64')).toBe('');
  });

  it('preserves binary data and reports missing files and unsupported encodings', async () => {
    const core = new FsCore();
    const path = '/tmp/repo/data.bin';
    const bytes = new Uint8Array([0, 255, 16, 128]);
    await core.mkdir('/tmp/repo', { recursive: true });
    await core.writeFile(path, bytes);
    const fs = createGitFs(core).promises;

    expect(await fs.readFile(path)).toEqual(bytes);
    expect(await fs.readFile(path, { encoding: null })).toEqual(bytes);
    expect(await fs.readFile(path, 'hex')).toBe('00ff1080');
    await expect(fs.readFile(path, 'not-an-encoding')).rejects.toThrow(
      'Unknown encoding: not-an-encoding'
    );
    await expect(fs.readFile('/tmp/repo/missing')).rejects.toMatchObject({
      code: 'ENOENT',
      path: '/tmp/repo/missing',
    });
  });

  it('maps directory entries to names and distinguishes stat from lstat', async () => {
    const core = new FsCore();
    await core.mkdir('/tmp/repo/nested', { recursive: true });
    await core.writeFile('/tmp/repo/nested/file.txt', 'contents');
    await core.symlink('/tmp/repo/nested', '/tmp/repo/linked');
    const fs = createGitFs(core).promises;

    expect((await fs.readdir('/tmp/repo')).sort()).toEqual(['linked', 'nested']);
    expect((await fs.stat('/tmp/repo/linked')).isDirectory()).toBe(true);
    expect((await fs.lstat('/tmp/repo/linked')).isSymbolicLink()).toBe(true);
    expect((await fs.lstat('/tmp/repo/linked')).mode).toBe(0o120777);
    expect((await fs.stat('/tmp/repo/nested/file.txt')).isFile()).toBe(true);
    await expect(fs.stat('/tmp/repo/missing')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('enforces unlink and rmdir filesystem contracts', async () => {
    const core = new FsCore();
    await core.mkdir('/tmp/repo/nonempty', { recursive: true });
    await core.writeFile('/tmp/repo/nonempty/file.txt', 'contents');
    await core.writeFile('/tmp/repo/file.txt', 'contents');
    const fs = createGitFs(core).promises;

    await expect(fs.rmdir('/tmp/repo/nonempty')).rejects.toMatchObject({
      code: 'ENOTEMPTY',
      path: '/tmp/repo/nonempty',
    });
    await expect(fs.unlink('/tmp/repo/nonempty')).rejects.toMatchObject({
      code: 'EISDIR',
      path: '/tmp/repo/nonempty',
    });
    await fs.unlink('/tmp/repo/file.txt');
    await fs.unlink('/tmp/repo/nonempty/file.txt');
    await fs.rmdir('/tmp/repo/nonempty');
    await expect(fs.unlink('/tmp/repo/file.txt')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.rmdir('/tmp/repo/nonempty')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('converts repository paths and rejects paths outside the repository', () => {
    expect(repositoryPath('/workspace/repo', '.')).toBe('.');
    expect(repositoryPath('/workspace/repo/', 'src/../README.md')).toBe('README.md');
    expect(repositoryPath('/workspace/repo', '/workspace/repo/src/index.ts')).toBe('src/index.ts');
    expect(() => repositoryPath('/workspace/repo', '../outside')).toThrow(
      'Path is outside repository: ../outside'
    );
    expect(() => repositoryPath('/workspace/repo', '/workspace/repository/file')).toThrow(
      'Path is outside repository: /workspace/repository/file'
    );
  });

  it('supports real git index and history operations without a native Buffer global', async () => {
    const nativeBuffer = globalThis.Buffer;
    vi.stubGlobal('Buffer', undefined);
    let endpointLoaded = false;

    try {
      vi.resetModules();
      vi.doMock('@/engine/system/runtime/fs/endpoint', () => {
        endpointLoaded = true;
        expect(globalThis.Buffer).toBeDefined();
        return {};
      });
      await import('@/engine/system/runtime/fs/worker');
      expect(endpointLoaded).toBe(true);

      const core = new FsCore();
      const git = new WorkerGitCommands(core, '/tmp/git-buffer');

      await git.init();
      await core.writeFile('/tmp/git-buffer/readme.txt', 'hello');
      await git.add('readme.txt');
      await git.commit('Initial commit');

      expect(await git.status()).toContain('nothing to commit');
      expect(await git.log()).toContain('Initial commit');
    } finally {
      vi.doUnmock('@/engine/system/runtime/fs/endpoint');
      vi.stubGlobal('Buffer', nativeBuffer);
    }
  });
});
