import git from 'isomorphic-git';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitCloneOperations } from '@/engine/cmd/global/gitOperations/clone';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs } from '@/engine/core/fs/git';
import { directoryTree } from '../../../../_helpers/opfs';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup() {
  const core = new FsCore();
  await core.init(directoryTree());
  const dir = '/home/pyxis/workspace';
  await core.mkdir(dir, { recursive: true });
  const fs = createGitFs(core);
  const clone = new GitCloneOperations({ fs, dir });
  return { core, fs, dir, clone };
}

describe('Git clone transport safety', () => {
  it('clones public repositories through the anonymous proxy without reading saved credentials', async () => {
    const { fs, dir, clone } = await setup();
    const credentials = vi.spyOn(fs, 'credentials');
    const cloneGit = vi.spyOn(git, 'clone').mockResolvedValue(undefined);

    await clone.clone('https://github.com/example/project.git');

    expect(credentials).not.toHaveBeenCalled();
    expect(cloneGit).toHaveBeenCalledOnce();
    const options = cloneGit.mock.calls[0][0];
    expect(options.corsProxy).toBe('https://cors.isomorphic-git.org');
    expect(options.url).toBe('https://github.com/example/project.git');
    expect(options.dir).toBe(`${dir}/project`);
  });

  it('fails authentication challenges without reading or forwarding saved credentials', async () => {
    const { fs, clone } = await setup();
    const credentials = vi.spyOn(fs, 'credentials').mockResolvedValue({
      username: 'token',
      password: 'secret',
    });
    vi.spyOn(git, 'clone').mockImplementation(async options => {
      await expect(options.onAuth?.()).rejects.toThrow(/authentication.*unavailable/i);
    });

    await clone.clone('https://github.com/example/private.git');

    expect(credentials).not.toHaveBeenCalled();
  });

  it('rejects credentials embedded in the repository URL before network access', async () => {
    const { clone } = await setup();
    const cloneGit = vi.spyOn(git, 'clone').mockResolvedValue(undefined);

    await expect(
      clone.clone('https://token:secret@github.com/example/project.git')
    ).rejects.toThrow(/credentials.*URL|URL.*credentials/i);

    expect(cloneGit).not.toHaveBeenCalled();
  });

  it('removes a newly created target after clone failure', async () => {
    const { core, dir, clone } = await setup();
    vi.spyOn(git, 'clone').mockRejectedValue(new Error('network failed'));

    await expect(clone.clone('https://github.com/example/project.git')).rejects.toThrow(
      'network failed'
    );
    await expect(core.stat(`${dir}/project`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps an existing empty target when cloning into it fails', async () => {
    const { core, dir, clone } = await setup();
    await core.mkdir(`${dir}/target`);
    vi.spyOn(git, 'clone').mockRejectedValue(new Error('network failed'));

    await expect(clone.clone('https://github.com/example/project.git', 'target')).rejects.toThrow(
      'network failed'
    );
    expect((await core.stat(`${dir}/target`)).type).toBe('folder');
  });

  it('rejects a nonempty target before network access', async () => {
    const { core, dir, clone } = await setup();
    await core.mkdir(`${dir}/target`);
    await core.writeFile(`${dir}/target/keep.txt`, 'keep');
    const cloneGit = vi.spyOn(git, 'clone').mockResolvedValue(undefined);

    await expect(clone.clone('https://github.com/example/project.git', 'target')).rejects.toThrow(
      /not empty/i
    );

    expect(cloneGit).not.toHaveBeenCalled();
    expect(await core.readText(`${dir}/target/keep.txt`)).toBe('keep');
  });
});
