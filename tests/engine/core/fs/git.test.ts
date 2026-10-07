import { describe, expect, it, vi } from 'vitest';
import { WorkerGitCommands } from '@/engine/cmd/global/gitOperations/worker';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs } from '@/engine/core/fs/git';

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

  it('supports real git index and history operations without a native Buffer global', async () => {
    const nativeBuffer = globalThis.Buffer;
    vi.stubGlobal('Buffer', undefined);
    let endpointLoaded = false;

    try {
      vi.resetModules();
      vi.doMock('@/engine/core/fs/endpoint', () => {
        endpointLoaded = true;
        expect(globalThis.Buffer).toBeDefined();
        return {};
      });
      await import('@/engine/core/fs/worker');
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
      vi.doUnmock('@/engine/core/fs/endpoint');
      vi.stubGlobal('Buffer', nativeBuffer);
    }
  });
});
