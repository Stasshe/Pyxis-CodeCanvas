import { describe, expect, it } from 'vitest';
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
});
