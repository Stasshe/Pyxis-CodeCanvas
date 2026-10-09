import git from 'isomorphic-git';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commit } from '@/engine/cmd/global/gitOperations/commit';
import { GitDiffOperations } from '@/engine/cmd/global/gitOperations/diff';
import { fetch } from '@/engine/cmd/global/gitOperations/fetch';
import { GitMergeOperations } from '@/engine/cmd/global/gitOperations/merge';
import { pull } from '@/engine/cmd/global/gitOperations/pull';
import { GitResetOperations } from '@/engine/cmd/global/gitOperations/reset';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs } from '@/engine/core/fs/git';
import { directoryTree } from '../../../../_helpers/opfs';

vi.mock('@/engine/cmd/global/gitOperations/fetch', () => ({ fetch: vi.fn() }));

const author = { name: 'Stasshe', email: 'stasshe@example.test' };

async function repository() {
  const core = new FsCore();
  await core.init(directoryTree());
  const dir = '/home/pyxis/repository';
  await core.mkdir(dir, { recursive: true });
  const fs = createGitFs(core);
  await git.init({ fs, dir, defaultBranch: 'main' });
  async function save(content: string) {
    await core.writeFile(`${dir}/file.txt`, content);
    await git.add({ fs, dir, filepath: 'file.txt' });
    return git.commit({ fs, dir, message: content, author });
  }
  return { core, fs, dir, save };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Git data preservation', () => {
  it('rejects pull --rebase before fetching', async () => {
    const repo = await repository();
    const head = await repo.save('already up to date');
    await git.writeRef({ ...repo, ref: 'refs/remotes/origin/main', value: head });

    await expect(pull(repo.fs, repo.dir, { rebase: true })).rejects.toThrow(
      'git pull failed: git pull --rebase is not yet supported. Use merge instead.'
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps local commits when the fetched remote is behind', async () => {
    const repo = await repository();
    const base = await repo.save('base');
    const head = await repo.save('local');
    await git.writeRef({ ...repo, ref: 'refs/remotes/origin/main', value: base });
    expect(await pull(repo.fs, repo.dir)).toBe('Already up to date.');
    expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(head);
    expect(await repo.fs.promises.readFile(`${repo.dir}/file.txt`, 'utf8')).toBe('local');
  });

  it('merges the requested remote branch into the checked-out local branch', async () => {
    const repo = await repository();
    await repo.save('base');
    const remote = await repo.save('remote');
    await git.writeRef({ ...repo, ref: 'refs/remotes/origin/release', value: remote });
    await git.checkout({ ...repo, ref: 'main' });
    await git.writeRef({
      ...repo,
      ref: 'refs/heads/main',
      value: (await git.readCommit({ ...repo, oid: remote })).commit.parent[0],
      force: true,
    });
    await git.checkout({ ...repo, ref: 'main', force: true });
    expect(await pull(repo.fs, repo.dir, { branch: 'release' })).toContain('Fast-forward');
    expect(await git.currentBranch(repo)).toBe('main');
    expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(remote);
  });

  it('restores the worktree when a fast-forward branch ref update fails', async () => {
    const repo = await repository();
    const base = await repo.save('base');
    await git.branch({ ...repo, ref: 'incoming' });
    await git.checkout({ ...repo, ref: 'incoming' });
    const incoming = await repo.save('incoming');
    await git.checkout({ ...repo, ref: 'main' });
    await repo.core.writeFile(`${repo.dir}/untracked.txt`, 'keep me');

    const writeRef = git.writeRef;
    vi.spyOn(git, 'writeRef').mockImplementation(async options => {
      if (options.ref === 'refs/heads/main' && options.value === incoming) {
        throw new Error('branch ref write failed');
      }
      return writeRef(options);
    });

    await expect(new GitMergeOperations(repo.fs, repo.dir).merge('incoming')).rejects.toThrow(
      'git merge failed: branch ref write failed'
    );
    expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(base);
    expect(await repo.fs.promises.readFile(`${repo.dir}/file.txt`, 'utf8')).toBe('base');
    expect(await repo.fs.promises.readFile(`${repo.dir}/untracked.txt`, 'utf8')).toBe('keep me');
  });

  it('reports both ref update and worktree rollback failures', async () => {
    const repo = await repository();
    await repo.save('base');
    await git.branch({ ...repo, ref: 'incoming' });
    await git.checkout({ ...repo, ref: 'incoming' });
    const incoming = await repo.save('incoming');
    await git.checkout({ ...repo, ref: 'main' });

    const writeRef = git.writeRef;
    vi.spyOn(git, 'writeRef').mockImplementation(async options => {
      if (options.ref === 'refs/heads/main' && options.value === incoming) {
        throw new Error('branch ref write failed');
      }
      return writeRef(options);
    });
    const checkout = git.checkout;
    let checkoutCalls = 0;
    vi.spyOn(git, 'checkout').mockImplementation(async options => {
      checkoutCalls += 1;
      if (checkoutCalls === 2) throw new Error('worktree rollback failed');
      return checkout(options);
    });

    await expect(new GitMergeOperations(repo.fs, repo.dir).merge('incoming')).rejects.toThrow(
      'git merge failed: Branch ref update failed: branch ref write failed; worktree rollback failed: worktree rollback failed'
    );
  });

  it('restores a conflict-free merge worktree when the branch ref update fails', async () => {
    const repo = await repository();
    const base = await repo.save('base');
    await git.branch({ ...repo, ref: 'incoming' });
    await repo.core.writeFile(`${repo.dir}/local.txt`, 'local');
    await git.add({ ...repo, filepath: 'local.txt' });
    const local = await git.commit({ ...repo, message: 'local', author });

    await git.checkout({ ...repo, ref: 'incoming' });
    await repo.core.writeFile(`${repo.dir}/incoming.txt`, 'incoming');
    await git.add({ ...repo, filepath: 'incoming.txt' });
    await git.commit({ ...repo, message: 'incoming', author });
    await git.checkout({ ...repo, ref: 'main' });
    await repo.core.writeFile(`${repo.dir}/untracked.txt`, 'keep me');

    const writeRef = git.writeRef;
    vi.spyOn(git, 'writeRef').mockImplementation(async options => {
      if (options.ref === 'refs/heads/main' && options.value !== local) {
        throw new Error('branch ref write failed');
      }
      return writeRef(options);
    });

    await expect(new GitMergeOperations(repo.fs, repo.dir).merge('incoming')).rejects.toThrow(
      'git merge failed: branch ref write failed'
    );
    expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(local);
    expect(await repo.fs.promises.readFile(`${repo.dir}/local.txt`, 'utf8')).toBe('local');
    await expect(repo.fs.promises.stat(`${repo.dir}/incoming.txt`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await repo.fs.promises.readFile(`${repo.dir}/untracked.txt`, 'utf8')).toBe('keep me');
    expect((await git.readCommit({ ...repo, oid: local })).commit.parent).toEqual([base]);
  });

  it('merges divergent pull histories with 100 incoming files and keeps the local branch', async () => {
    const repo = await repository();
    await repo.save('base');
    await git.branch({ ...repo, ref: 'incoming' });
    const local = await repo.save('local');

    await git.checkout({ ...repo, ref: 'incoming' });
    const incomingFiles = Array.from({ length: 100 }, (_, index) => `incoming-${index}.txt`);
    for (const filepath of incomingFiles) {
      const content = `content for ${filepath}`;
      await repo.core.writeFile(`${repo.dir}/${filepath}`, content);
      await git.add({ ...repo, filepath });
    }
    const incoming = await git.commit({
      ...repo,
      message: 'many incoming files',
      author,
    });

    await git.checkout({ ...repo, ref: 'main' });
    await git.writeRef({ ...repo, ref: 'refs/remotes/origin/main', value: incoming });

    expect(await pull(repo.fs, repo.dir)).toContain('Merge commit:');

    const head = await git.resolveRef({ ...repo, ref: 'HEAD' });
    expect((await git.readCommit({ ...repo, oid: head })).commit.parent).toEqual([local, incoming]);
    expect(await git.currentBranch(repo)).toBe('main');
    expect(await repo.fs.promises.readFile(`${repo.dir}/file.txt`, 'utf8')).toBe('local');
    for (const filepath of incomingFiles) {
      expect(await repo.fs.promises.readFile(`${repo.dir}/${filepath}`, 'utf8')).toBe(
        `content for ${filepath}`
      );
    }
  });

  it('unstages all files on reset without altering worktree or HEAD', async () => {
    const repo = await repository();
    const head = await repo.save('base');
    await repo.core.writeFile(`${repo.dir}/file.txt`, 'staged');
    await git.add({ ...repo, filepath: 'file.txt' });
    await new GitResetOperations(repo.fs, repo.dir).reset();
    expect(await git.statusMatrix(repo)).toEqual([['file.txt', 1, 2, 1]]);
    expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(head);
    expect(await repo.fs.promises.readFile(`${repo.dir}/file.txt`, 'utf8')).toBe('staged');
  });

  it('restores tracked content on hard reset without an explicit commit', async () => {
    const repo = await repository();
    const head = await repo.save('base');
    await repo.core.writeFile(`${repo.dir}/file.txt`, 'staged');
    await git.add({ ...repo, filepath: 'file.txt' });
    await repo.core.writeFile(`${repo.dir}/file.txt`, 'unstaged');
    await new GitResetOperations(repo.fs, repo.dir).reset({ hard: true });
    expect(await git.statusMatrix(repo)).toEqual([['file.txt', 1, 1, 1]]);
    expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(head);
    expect(await git.currentBranch(repo)).toBe('main');
    expect(await repo.fs.promises.readFile(`${repo.dir}/file.txt`, 'utf8')).toBe('base');
  });

  it('leaves local edits and refs intact when pull cannot update a dirty worktree', async () => {
    const repo = await repository();
    const base = await repo.save('base');
    const remote = await repo.save('remote');
    await git.writeRef({ ...repo, ref: 'refs/remotes/origin/main', value: remote });
    await new GitResetOperations(repo.fs, repo.dir).reset({ hard: true, commit: base });
    await repo.core.writeFile(`${repo.dir}/file.txt`, 'uncommitted');
    await expect(pull(repo.fs, repo.dir)).rejects.toThrow('local changes');
    expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(base);
    expect(await repo.fs.promises.readFile(`${repo.dir}/file.txt`, 'utf8')).toBe('uncommitted');
  });

  it('shows index content when a staged edit is edited again', async () => {
    const repo = await repository();
    await repo.save('base');
    await repo.core.writeFile(`${repo.dir}/file.txt`, 'staged');
    await git.add({ ...repo, filepath: 'file.txt' });
    await repo.core.writeFile(`${repo.dir}/file.txt`, 'unstaged');
    const output = await new GitDiffOperations(repo.fs, repo.dir).diff({ staged: true });
    expect(output).toContain('-base');
    expect(output).toContain('+staged');
    expect(output).not.toContain('unstaged');
  });

  it('shows staged deletions and additions before the first commit', async () => {
    const repo = await repository();
    await repo.core.writeFile(`${repo.dir}/file.txt`, 'initial');
    await git.add({ ...repo, filepath: 'file.txt' });
    const diff = new GitDiffOperations(repo.fs, repo.dir);
    expect(await diff.diff({ staged: true })).toContain('+initial');
    await repo.save('base');
    await repo.core.rm(`${repo.dir}/file.txt`);
    await git.remove({ ...repo, filepath: 'file.txt' });
    expect(await diff.diff({ staged: true })).toContain('-base');
  });

  it('records both parents after conflict resolution and keeps the branch attached', async () => {
    const repo = await repository();
    await repo.save('base\n');
    await git.branch({ ...repo, ref: 'topic' });
    const ours = await repo.save('ours\n');
    await git.checkout({ ...repo, ref: 'topic' });
    const theirs = await repo.save('theirs\n');
    await git.checkout({ ...repo, ref: 'main' });
    repo.fs.setConflictReporter(async () => {});
    const output = await new GitMergeOperations(repo.fs, repo.dir).merge('topic');
    expect(output).toContain('CONFLICT');
    await repo.core.writeFile(`${repo.dir}/file.txt`, 'resolved\n');
    await git.add({ ...repo, filepath: 'file.txt' });
    await commit(repo.fs, repo.dir, 'Resolve merge', author);
    const head = await git.resolveRef({ ...repo, ref: 'HEAD' });
    expect((await git.readCommit({ ...repo, oid: head })).commit.parent).toEqual([ours, theirs]);
    expect(await git.currentBranch(repo)).toBe('main');
    await expect(repo.fs.promises.stat(`${repo.dir}/.git/MERGE_HEAD`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
