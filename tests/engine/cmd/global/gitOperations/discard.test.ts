import git from 'isomorphic-git';
import { describe, expect, it, vi } from 'vitest';
import { discardChanges } from '@/engine/cmd/global/gitOperations/discardChanges';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs } from '@/engine/core/fs/git';
import { directoryTree } from '../../../../_helpers/opfs';

async function fixture() {
  const core = new FsCore();
  await core.init(directoryTree());
  const fs = createGitFs(core);
  const dir = '/home/pyxis/discard';
  await core.mkdir(dir, { recursive: true });
  await git.init({ fs, dir, defaultBranch: 'main' });
  return { core, fs, dir };
}

const author = { name: 'Stasshe', email: 'stasshe@example.test' };

describe('Git discard symlink safety', () => {
  it('restores a staged link without changing either referent or the index', async () => {
    const repo = await fixture();
    await repo.core.writeFile(`${repo.dir}/old-target`, 'old target bytes');
    await repo.core.writeFile(`${repo.dir}/new-target`, 'new target bytes');
    await repo.core.symlink('old-target', `${repo.dir}/link`);
    await git.add({ ...repo, filepath: 'link' });
    await git.commit({ ...repo, message: 'link', author });
    await repo.core.rm(`${repo.dir}/link`);
    await repo.core.symlink('new-target', `${repo.dir}/link`);
    await git.add({ ...repo, filepath: 'link' });
    await repo.core.rm(`${repo.dir}/link`);
    await repo.core.symlink('old-target', `${repo.dir}/link`);
    const beforeIndex = await repo.fs.promises.readFile(`${repo.dir}/.git/index`);
    await discardChanges(repo.fs, repo.dir, 'link');
    expect(await repo.core.readlink(`${repo.dir}/link`)).toBe('new-target');
    expect(await repo.fs.promises.readFile(`${repo.dir}/old-target`, 'utf8')).toBe(
      'old target bytes'
    );
    expect(await repo.fs.promises.readFile(`${repo.dir}/new-target`, 'utf8')).toBe(
      'new target bytes'
    );
    expect(await repo.fs.promises.readFile(`${repo.dir}/.git/index`)).toEqual(beforeIndex);
  });

  it('replaces an uncommitted symlink with the committed regular file without writing through it', async () => {
    const repo = await fixture();
    await repo.core.writeFile(`${repo.dir}/file`, 'committed');
    await git.add({ ...repo, filepath: 'file' });
    await git.commit({ ...repo, message: 'file', author });
    await repo.core.writeFile(`${repo.dir}/target`, 'unrelated');
    await repo.core.rm(`${repo.dir}/file`);
    await repo.core.symlink('target', `${repo.dir}/file`);
    await discardChanges(repo.fs, repo.dir, 'file');
    expect((await repo.fs.promises.lstat(`${repo.dir}/file`)).isFile()).toBe(true);
    expect(await repo.fs.promises.readFile(`${repo.dir}/file`, 'utf8')).toBe('committed');
    expect(await repo.fs.promises.readFile(`${repo.dir}/target`, 'utf8')).toBe('unrelated');
  });

  it('keeps a newly staged file and removes a genuinely untracked file', async () => {
    const repo = await fixture();
    await repo.core.writeFile(`${repo.dir}/new`, 'staged');
    await git.add({ ...repo, filepath: 'new' });
    const beforeIndex = await repo.fs.promises.readFile(`${repo.dir}/.git/index`);
    await repo.core.writeFile(`${repo.dir}/new`, 'unstaged');
    await repo.core.writeFile(`${repo.dir}/untracked`, 'untracked');
    await discardChanges(repo.fs, repo.dir, 'new');
    await discardChanges(repo.fs, repo.dir, 'untracked');
    expect(await repo.core.readText(`${repo.dir}/new`)).toBe('staged');
    await expect(repo.core.lstat(`${repo.dir}/untracked`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await repo.fs.promises.readFile(`${repo.dir}/.git/index`)).toEqual(beforeIndex);
  });

  it('preserves worktree and index when the indexed blob cannot be read', async () => {
    const repo = await fixture();
    await repo.core.writeFile(`${repo.dir}/file`, 'staged');
    await git.add({ ...repo, filepath: 'file' });
    await repo.core.writeFile(`${repo.dir}/file`, 'worktree');
    const beforeIndex = await repo.fs.promises.readFile(`${repo.dir}/.git/index`);
    const read = vi.spyOn(git, 'readBlob').mockRejectedValue(new Error('Missing object'));
    try {
      await expect(discardChanges(repo.fs, repo.dir, 'file')).rejects.toThrow('Missing object');
      expect(await repo.core.readText(`${repo.dir}/file`)).toBe('worktree');
      expect(await repo.fs.promises.readFile(`${repo.dir}/.git/index`)).toEqual(beforeIndex);
    } finally {
      read.mockRestore();
    }
  });

  it('rejects restoration through a symlink parent without changing its target', async () => {
    const repo = await fixture();
    await repo.core.mkdir(`${repo.dir}/folder`);
    await repo.core.writeFile(`${repo.dir}/folder/file`, 'staged');
    await git.add({ ...repo, filepath: 'folder/file' });
    await repo.core.mkdir(`${repo.dir}/other`);
    await repo.core.writeFile(`${repo.dir}/other/file`, 'unrelated');
    await repo.core.rm(`${repo.dir}/folder`, { recursive: true });
    await repo.core.symlink('other', `${repo.dir}/folder`);
    const index = await repo.fs.promises.readFile(`${repo.dir}/.git/index`);
    await expect(discardChanges(repo.fs, repo.dir, 'folder/file')).rejects.toThrow(/symlink/i);
    expect(await repo.core.readText(`${repo.dir}/other/file`)).toBe('unrelated');
    expect(await repo.fs.promises.readFile(`${repo.dir}/.git/index`)).toEqual(index);
  });
});
