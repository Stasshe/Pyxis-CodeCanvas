import git from 'isomorphic-git';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetch } from '@/engine/system/git/fetch';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs } from '@/engine/core/fs/git';
import { directoryTree } from '../../../_helpers/opfs';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function repository() {
  const core = new FsCore();
  await core.init(directoryTree());
  const dir = '/home/pyxis/repository';
  await core.mkdir(dir, { recursive: true });
  const fs = createGitFs(core);
  await git.init({ fs, dir, defaultBranch: 'main' });
  await git.addRemote({ fs, dir, remote: 'origin', url: 'https://github.com/example/project.git' });
  return { fs, dir };
}

describe('Git HTTP transport safety', () => {
  it('fetches public repositories through the anonymous proxy without reading saved credentials', async () => {
    const { fs, dir } = await repository();
    vi.stubGlobal('fetch', vi.fn());
    const credentials = vi.spyOn(fs, 'credentials');
    const fetchGit = vi.spyOn(git, 'fetch').mockResolvedValue({ fetchHead: undefined });

    await fetch(fs, dir);

    expect(credentials).not.toHaveBeenCalled();
    expect(fetchGit).toHaveBeenCalledOnce();
    const options = fetchGit.mock.calls[0][0];
    expect(options.corsProxy).toBe('https://cors.isomorphic-git.org');
    expect(options.url).toBe('https://github.com/example/project.git');
    expect(options.onAuth).toBeDefined();
  });

  it('fails authentication challenges without reading or forwarding saved credentials', async () => {
    const { fs, dir } = await repository();
    vi.stubGlobal('fetch', vi.fn());
    const credentials = vi.spyOn(fs, 'credentials').mockResolvedValue({
      username: 'token',
      password: 'secret',
    });
    vi.spyOn(git, 'fetch').mockImplementation(async options => {
      await expect(options.onAuth?.()).rejects.toThrow(/authentication.*unavailable/i);
      return { fetchHead: undefined };
    });

    await fetch(fs, dir);

    expect(credentials).not.toHaveBeenCalled();
  });

  it('rejects remote URL userinfo before contacting the remote', async () => {
    const { fs, dir } = await repository();
    vi.stubGlobal('fetch', vi.fn());
    await git.deleteRemote({ fs, dir, remote: 'origin' });
    await git.addRemote({
      fs,
      dir,
      remote: 'origin',
      url: 'https://token:secret@github.com/example/project.git',
    });
    const fetchGit = vi.spyOn(git, 'fetch').mockResolvedValue({ fetchHead: undefined });

    await expect(fetch(fs, dir)).rejects.toThrow(/credentials.*URL|URL.*credentials/i);

    expect(fetchGit).not.toHaveBeenCalled();
  });
});
