import git from 'isomorphic-git';
import { describe, expect, it, vi } from 'vitest';
import { GitCheckoutOperations } from '@/engine/cmd/global/gitOperations/checkout';
import { GitMergeOperations } from '@/engine/cmd/global/gitOperations/merge';
import { GitResetOperations } from '@/engine/cmd/global/gitOperations/reset';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs } from '@/engine/core/fs/git';
import { directoryTree } from '../../../../_helpers/opfs';

async function fixture() {
  const core = new FsCore();
  await core.init(directoryTree());
  const fs = createGitFs(core);
  const dir = '/home/pyxis/merge-state';
  await core.mkdir(dir, { recursive: true });
  await git.init({ fs, dir, defaultBranch: 'main' });
  await core.writeFile(`${dir}/file`, 'base');
  await git.add({ fs, dir, filepath: 'file' });
  const head = await git.commit({
    fs,
    dir,
    message: 'base',
    author: { name: 'Stasshe', email: 'stasshe@example.test' },
  });
  await git.branch({ fs, dir, ref: 'topic' });
  await fs.promises.writeFile(`${dir}/.git/MERGE_HEAD`, `${head}\n`);
  await fs.promises.writeFile(`${dir}/.git/MERGE_MSG`, 'Merge topic');
  return { core, fs, dir, head };
}

describe('Git merge lifecycle', () => {
  it('rejects branch changes until the pending merge is concluded', async () => {
    const repo = await fixture();
    await expect(new GitCheckoutOperations(repo.fs, repo.dir).checkout('topic')).rejects.toThrow(
      'merge'
    );
    expect(await git.currentBranch(repo)).toBe('main');
    expect(await repo.fs.promises.readFile(`${repo.dir}/.git/MERGE_HEAD`, 'utf8')).toBe(
      `${repo.head}\n`
    );
  });

  it('rejects a second merge without modifying the original pending state', async () => {
    const repo = await fixture();
    await expect(new GitMergeOperations(repo.fs, repo.dir).merge('topic')).rejects.toThrow('merge');
    expect(await repo.fs.promises.readFile(`${repo.dir}/.git/MERGE_MSG`, 'utf8')).toBe(
      'Merge topic'
    );
    expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(repo.head);
  });

  it('clears pending merge metadata after a successful full reset', async () => {
    const repo = await fixture();
    await new GitResetOperations(repo.fs, repo.dir).reset({ hard: true });
    await expect(repo.fs.promises.stat(`${repo.dir}/.git/MERGE_HEAD`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(repo.fs.promises.stat(`${repo.dir}/.git/MERGE_MSG`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await git.currentBranch(repo)).toBe('main');
  });

  it('retains pending merge metadata if abort cannot restore the worktree', async () => {
    const repo = await fixture();
    const checkout = vi.spyOn(git, 'checkout').mockRejectedValueOnce(new Error('disk error'));
    try {
      await expect(new GitMergeOperations(repo.fs, repo.dir).mergeAbort()).rejects.toThrow(
        'disk error'
      );
      expect(await repo.fs.promises.readFile(`${repo.dir}/.git/MERGE_HEAD`, 'utf8')).toBe(
        `${repo.head}\n`
      );
      expect(await repo.fs.promises.readFile(`${repo.dir}/.git/MERGE_MSG`, 'utf8')).toBe(
        'Merge topic'
      );
    } finally {
      checkout.mockRestore();
    }
  });
});
