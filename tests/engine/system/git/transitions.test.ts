import git from 'isomorphic-git';
import { describe, expect, it, vi } from 'vitest';
import { GitCheckoutOperations } from '@/engine/system/git/checkout';
import { GitDiffOperations } from '@/engine/system/git/diff';
import { GitResetOperations } from '@/engine/system/git/reset';
import { GitSwitchOperations } from '@/engine/system/git/switch';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs } from '@/engine/core/fs/git';
import { directoryTree } from '../../../_helpers/opfs';

async function fixture() {
  const core = new FsCore();
  await core.init(directoryTree());
  const fs = createGitFs(core);
  const dir = '/home/pyxis/transitions';
  await core.mkdir(dir, { recursive: true });
  await git.init({ fs, dir, defaultBranch: 'main' });
  async function save(bytes: string | Uint8Array) {
    await core.writeFile(`${dir}/file`, bytes);
    await git.add({ fs, dir, filepath: 'file' });
    return git.commit({
      fs,
      dir,
      message: 'save',
      author: { name: 'Stasshe', email: 'stasshe@example.test' },
    });
  }
  return { core, fs, dir, save };
}

describe('Git branch and byte preservation', () => {
  it('prefers an existing local slash branch over a same-named remote ref', async () => {
    const repo = await fixture();
    const base = await repo.save('base');
    await git.branch({ ...repo, ref: 'origin/topic' });
    const remote = await repo.save('remote');
    await git.writeRef({ ...repo, ref: 'refs/remotes/origin/topic', value: remote });
    await new GitCheckoutOperations(repo.fs, repo.dir).checkout('origin/topic');
    expect(await git.currentBranch(repo)).toBe('origin/topic');
    expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(base);
    expect(await repo.fs.promises.readFile(`${repo.dir}/file`, 'utf8')).toBe('base');
  });

  it('creates slash branches through switch instead of resolving them as remotes', async () => {
    const repo = await fixture();
    const base = await repo.save('base');
    await new GitSwitchOperations(repo.fs, repo.dir).switch('feature/topic', { createNew: true });
    expect(await git.currentBranch(repo)).toBe('feature/topic');
    expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(base);
  });

  it('honors switch detach for an existing local branch', async () => {
    const repo = await fixture();
    const oid = await repo.save('base');
    await new GitSwitchOperations(repo.fs, repo.dir).switch('main', { detach: true });
    expect(await git.currentBranch(repo)).toBeUndefined();
    expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(oid);
  });

  it('does not leave a new branch behind if checkout fails', async () => {
    const repo = await fixture();
    const oid = await repo.save('base');
    const checkout = vi
      .spyOn(git, 'checkout')
      .mockRejectedValue(new Error('Worktree write failed'));
    try {
      await expect(
        new GitCheckoutOperations(repo.fs, repo.dir).checkout('feature/new', true)
      ).rejects.toThrow('Worktree write failed');
      expect(await git.listBranches(repo)).toEqual(['main']);
      expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(oid);
      expect(await git.currentBranch(repo)).toBe('main');
    } finally {
      checkout.mockRestore();
    }
  });

  it('preserves the branch when a mixed reset cannot update the index', async () => {
    const repo = await fixture();
    const base = await repo.save('base');
    const head = await repo.save('head');
    const resetIndex = vi
      .spyOn(git, 'resetIndex')
      .mockRejectedValue(new Error('Index write failed'));
    try {
      await expect(
        new GitResetOperations(repo.fs, repo.dir).reset({ commit: base })
      ).rejects.toThrow('Index write failed');
      expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(head);
      expect(await repo.core.readText(`${repo.dir}/file`)).toBe('head');
    } finally {
      resetIndex.mockRestore();
    }
  });

  it('does not report a modification when resetting an unchanged file', async () => {
    const repo = await fixture();
    await repo.save('base');
    expect(await new GitResetOperations(repo.fs, repo.dir).reset({ filepath: 'file' })).toBe('');
    await repo.core.rm(`${repo.dir}/file`);
    expect(await new GitResetOperations(repo.fs, repo.dir).reset({ filepath: 'file' })).toContain(
      'D\tfile'
    );
  });

  it('keeps the original symbolic HEAD if hard-reset checkout fails', async () => {
    const repo = await fixture();
    await repo.save('old');
    const head = await repo.save('new');
    const missing = 'f'.repeat(40);
    const source = await git.readCommit({ ...repo, oid: head });
    const broken = await git.writeCommit({ ...repo, commit: { ...source.commit, tree: missing } });
    await expect(
      new GitResetOperations(repo.fs, repo.dir).reset({ hard: true, commit: broken })
    ).rejects.toThrow();
    expect(await git.currentBranch(repo)).toBe('main');
    expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(head);
    expect(await repo.fs.promises.readFile(`${repo.dir}/file`, 'utf8')).toBe('new');
  });

  it('shows different invalid UTF-8 bytes in staged, worktree, and commit diffs', async () => {
    const repo = await fixture();
    const before = await repo.save(new Uint8Array([255]));
    await repo.core.writeFile(`${repo.dir}/file`, new Uint8Array([254]));
    await git.add({ ...repo, filepath: 'file' });
    const diff = new GitDiffOperations(repo.fs, repo.dir);
    expect(await diff.diff({ staged: true })).toContain('Binary files');
    const after = await repo.save(new Uint8Array([254]));
    expect(await diff.diffCommits(before, after)).toContain('Binary files');
    await repo.core.writeFile(`${repo.dir}/file`, new Uint8Array([253]));
    expect(await diff.diff()).toContain('Binary files');
  });

  it('includes nested changes when a directory is used as the diff pathspec', async () => {
    const repo = await fixture();
    await repo.core.mkdir(`${repo.dir}/packages/app`, { recursive: true });
    await repo.core.mkdir(`${repo.dir}/packages-old`);
    await repo.core.writeFile(`${repo.dir}/packages/app/file.ts`, 'base\n');
    await repo.core.writeFile(`${repo.dir}/packages-old/file.ts`, 'sibling base\n');
    await git.add({ ...repo, filepath: 'packages/app/file.ts' });
    await git.add({ ...repo, filepath: 'packages-old/file.ts' });
    const before = await git.commit({
      ...repo,
      message: 'base',
      author: { name: 'Stasshe', email: 'stasshe@example.test' },
    });

    await repo.core.writeFile(`${repo.dir}/packages/app/file.ts`, 'staged\n');
    await repo.core.writeFile(`${repo.dir}/packages-old/file.ts`, 'sibling staged\n');
    await git.add({ ...repo, filepath: 'packages/app/file.ts' });
    await git.add({ ...repo, filepath: 'packages-old/file.ts' });
    const diff = new GitDiffOperations(repo.fs, repo.dir);
    const staged = await diff.diff({ staged: true, filepath: 'packages' });
    expect(staged).toContain('diff --git a/packages/app/file.ts');
    expect(staged).toContain('+staged');
    expect(staged).not.toContain('packages-old');
    const stagedRoot = await diff.diff({ staged: true, filepath: '.' });
    expect(stagedRoot).toContain('packages/app/file.ts');
    expect(stagedRoot).toContain('packages-old/file.ts');

    await repo.core.writeFile(`${repo.dir}/packages/app/file.ts`, 'worktree\n');
    await repo.core.writeFile(`${repo.dir}/packages-old/file.ts`, 'sibling worktree\n');
    const unstaged = await diff.diff({ filepath: 'packages/app/' });
    expect(unstaged).toContain('diff --git a/packages/app/file.ts');
    expect(unstaged).toContain('+worktree');
    expect(unstaged).not.toContain('packages-old');
    const unstagedRoot = await diff.diff({ filepath: '.' });
    expect(unstagedRoot).toContain('packages/app/file.ts');
    expect(unstagedRoot).toContain('packages-old/file.ts');

    await git.commit({
      ...repo,
      message: 'staged',
      author: { name: 'Stasshe', email: 'stasshe@example.test' },
    });
    const after = await git.resolveRef({ ...repo, ref: 'HEAD' });
    const commits = await diff.diffCommits(before, after, 'packages');
    expect(commits).toContain('diff --git a/packages/app/file.ts');
    expect(commits).toContain('+staged');
  });

  it('compares symlink targets rather than the files they refer to', async () => {
    const repo = await fixture();
    await repo.core.writeFile(`${repo.dir}/old-target`, 'same bytes');
    await repo.core.writeFile(`${repo.dir}/new-target`, 'same bytes');
    await repo.core.symlink('old-target', `${repo.dir}/link`);
    await git.add({ ...repo, filepath: 'link' });
    await git.commit({
      ...repo,
      message: 'link',
      author: { name: 'Stasshe', email: 'stasshe@example.test' },
    });
    await repo.core.rm(`${repo.dir}/link`);
    await repo.core.symlink('new-target', `${repo.dir}/link`);
    const output = await new GitDiffOperations(repo.fs, repo.dir).diff();
    expect(output).toContain('-old-target');
    expect(output).toContain('+new-target');
  });
});
