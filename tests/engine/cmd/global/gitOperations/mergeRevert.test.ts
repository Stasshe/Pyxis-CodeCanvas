import git from 'isomorphic-git';
import { describe, expect, it, vi } from 'vitest';
import { add } from '@/engine/cmd/global/gitOperations/add';
import { commit } from '@/engine/cmd/global/gitOperations/commit';
import { GitMergeOperations } from '@/engine/cmd/global/gitOperations/merge';
import { GitRevertOperations } from '@/engine/cmd/global/gitOperations/revert';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs } from '@/engine/core/fs/git';
import { directoryTree } from '../../../../_helpers/opfs';

async function fixture() {
  const core = new FsCore();
  await core.init(directoryTree());
  const fs = createGitFs(core);
  const dir = '/home/pyxis/merge-revert';
  await core.mkdir(dir, { recursive: true });
  await git.init({ fs, dir, defaultBranch: 'main' });
  const author = { name: 'Stasshe', email: 'stasshe@example.test' };
  async function save(files: Record<string, string | Uint8Array>, message: string) {
    for (const [filepath, content] of Object.entries(files)) {
      await core.writeFile(`${dir}/${filepath}`, content);
      await git.add({ fs, dir, filepath });
    }
    return git.commit({ fs, dir, message, author });
  }
  return { core, fs, dir, save };
}

describe('merge and revert preserve complete changes', () => {
  it('keeps automatic text edits and theirs-only additions/deletions after resolving a conflict', async () => {
    const repo = await fixture();
    await repo.save({ file: 'base\nkeep\nthird\n', removed: 'old' }, 'base');
    await git.branch({ ...repo, ref: 'topic' });
    await repo.save({ file: 'ours\nkeep\nthird\n' }, 'ours');
    await git.checkout({ ...repo, ref: 'topic' });
    await repo.save({ file: 'theirs\nkeep\nnew third\n', added: 'added' }, 'theirs');
    await repo.core.rm(`${repo.dir}/removed`);
    await git.remove({ ...repo, filepath: 'removed' });
    await git.commit({
      ...repo,
      message: 'remove',
      author: { name: 'Stasshe', email: 'stasshe@example.test' },
    });
    await git.checkout({ ...repo, ref: 'main' });
    const reports: Parameters<typeof repo.fs.reportMergeConflict>[0][] = [];
    repo.fs.reportMergeConflict = async report => {
      reports.push(report);
    };
    await new GitMergeOperations(repo.fs, repo.dir).merge('topic');
    expect(reports).toHaveLength(1);
    expect(reports[0].conflicts).toHaveLength(1);
    expect(reports[0].conflicts[0].resolvedContent).toBe('ours\nkeep\nnew third\n');
    expect(await repo.fs.promises.readFile(`${repo.dir}/added`, 'utf8')).toBe('added');
    await expect(repo.core.stat(`${repo.dir}/removed`)).rejects.toMatchObject({ code: 'ENOENT' });
    await repo.core.writeFile(`${repo.dir}/file`, 'resolved\nkeep\nnew third\n');
    await git.add({ ...repo, filepath: 'file' });
    await commit(repo.fs, repo.dir, 'complete');
    const tree = await git.readTree({
      ...repo,
      oid: await git.resolveRef({ ...repo, ref: 'HEAD' }),
    });
    expect(tree.tree.map(entry => entry.path)).toEqual(['added', 'file']);
  });

  it('rejects dirty tracked files while allowing unrelated untracked files', async () => {
    const repo = await fixture();
    await repo.save({ file: 'base' }, 'base');
    await git.branch({ ...repo, ref: 'topic' });
    await git.checkout({ ...repo, ref: 'topic' });
    await repo.save({ file: 'topic' }, 'topic');
    await git.checkout({ ...repo, ref: 'main' });
    await repo.core.writeFile(`${repo.dir}/file`, 'local');
    await expect(new GitMergeOperations(repo.fs, repo.dir).merge('topic')).rejects.toThrow(
      'local changes'
    );
    await repo.core.writeFile(`${repo.dir}/file`, 'base');
    await repo.core.writeFile(`${repo.dir}/untracked`, 'keep');
    await new GitMergeOperations(repo.fs, repo.dir).merge('topic');
    expect(await repo.fs.promises.readFile(`${repo.dir}/file`, 'utf8')).toBe('topic');
    expect(await repo.fs.promises.readFile(`${repo.dir}/untracked`, 'utf8')).toBe('keep');
  });

  it('reverts only the selected patch and preserves later edits in the same file', async () => {
    const repo = await fixture();
    await repo.save({ file: 'first\nsecond\nthird\n' }, 'base');
    const target = await repo.save({ file: 'changed\nsecond\nthird\n' }, 'target');
    await repo.save({ file: 'changed\nsecond\nlater\n' }, 'later');
    await new GitRevertOperations(repo.fs, repo.dir).revert(target);
    expect(await repo.fs.promises.readFile(`${repo.dir}/file`, 'utf8')).toBe(
      'first\nsecond\nlater\n'
    );
    expect(
      (await git.statusMatrix(repo)).every(
        ([, head, workdir, stage]) => head === workdir && head === stage
      )
    ).toBe(true);
  });

  it('rejects overlapping revert without altering worktree, index or HEAD', async () => {
    const repo = await fixture();
    await repo.save({ file: 'base\n' }, 'base');
    const target = await repo.save({ file: 'target\n' }, 'target');
    const head = await repo.save({ file: 'later\n' }, 'later');
    const index = await repo.fs.promises.readFile(`${repo.dir}/.git/index`);
    await expect(new GitRevertOperations(repo.fs, repo.dir).revert(target)).rejects.toThrow();
    expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(head);
    expect(await repo.fs.promises.readFile(`${repo.dir}/file`, 'utf8')).toBe('later\n');
    expect(await repo.fs.promises.readFile(`${repo.dir}/.git/index`)).toEqual(index);
  });
  it('refuses incoming paths that collide with untracked content before changing the index', async () => {
    const repo = await fixture();
    await repo.save({ file: 'base' }, 'base');
    await git.branch({ ...repo, ref: 'topic' });
    const head = await repo.save({ file: 'ours' }, 'ours');
    await git.checkout({ ...repo, ref: 'topic' });
    await repo.save({ file: 'theirs', added: 'incoming' }, 'theirs');
    await git.checkout({ ...repo, ref: 'main' });
    await repo.core.writeFile(`${repo.dir}/added`, 'untracked');
    const index = await repo.fs.promises.readFile(`${repo.dir}/.git/index`);
    await expect(new GitMergeOperations(repo.fs, repo.dir).merge('topic')).rejects.toThrow(
      'Untracked'
    );
    expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(head);
    expect(await repo.fs.promises.readFile(`${repo.dir}/added`, 'utf8')).toBe('untracked');
    expect(await repo.fs.promises.readFile(`${repo.dir}/file`, 'utf8')).toBe('ours');
    expect(await repo.fs.promises.readFile(`${repo.dir}/.git/index`)).toEqual(index);
  });

  it('keeps undecodable conflicting binary bytes exact even when decoded text is identical', async () => {
    const repo = await fixture();
    await repo.save({ 'file.bin': new Uint8Array([0, 255]) }, 'base');
    await git.branch({ ...repo, ref: 'topic' });
    const ours = new Uint8Array([0, 254]);
    await repo.save({ 'file.bin': ours }, 'ours');
    await git.checkout({ ...repo, ref: 'topic' });
    const theirs = new Uint8Array([0, 253]);
    await repo.save({ 'file.bin': theirs, added: 'incoming' }, 'theirs');
    await git.checkout({ ...repo, ref: 'main' });
    const reports: Parameters<typeof repo.fs.reportMergeConflict>[0][] = [];
    repo.fs.reportMergeConflict = async report => {
      reports.push(report);
    };
    await new GitMergeOperations(repo.fs, repo.dir).merge('topic');
    expect(reports).toHaveLength(1);
    expect(reports[0].conflicts[0].binary?.ours).toEqual(ours);
    expect(reports[0].conflicts[0].binary?.theirs).toEqual(theirs);
    expect(await repo.fs.promises.readFile(`${repo.dir}/file.bin`)).toEqual(ours);
    expect(await repo.fs.promises.readFile(`${repo.dir}/added`, 'utf8')).toBe('incoming');
  });

  it('restores a deleted nested file while reverting', async () => {
    const repo = await fixture();
    await repo.core.mkdir(`${repo.dir}/nested`, { recursive: true });
    await repo.save({ 'nested/file': 'original' }, 'base');
    await repo.core.rm(`${repo.dir}/nested/file`);
    await git.remove({ ...repo, filepath: 'nested/file' });
    const target = await git.commit({
      ...repo,
      message: 'delete',
      author: { name: 'Stasshe', email: 'stasshe@example.test' },
    });
    await repo.core.rm(`${repo.dir}/nested`, { recursive: true });
    await new GitRevertOperations(repo.fs, repo.dir).revert(target);
    expect(await repo.fs.promises.readFile(`${repo.dir}/nested/file`, 'utf8')).toBe('original');
  });

  it('leaves HEAD unchanged when checkout fails during revert', async () => {
    const repo = await fixture();
    await repo.save({ file: 'base' }, 'base');
    const head = await repo.save({ file: 'target' }, 'target');
    const checkout = vi.spyOn(git, 'checkout').mockRejectedValueOnce(new Error('disk error'));
    try {
      await expect(new GitRevertOperations(repo.fs, repo.dir).revert(head)).rejects.toThrow(
        'disk error'
      );
      expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(head);
      expect(await repo.fs.promises.readFile(`${repo.dir}/file`, 'utf8')).toBe('target');
    } finally {
      checkout.mockRestore();
    }
  });
  it('reports the actual branch and tolerates an absent MERGE_MSG after completing a merge commit', async () => {
    const repo = await fixture();
    const base = await repo.save({ file: 'base' }, 'base');
    await git.branch({ ...repo, ref: 'topic', checkout: true });
    const topic = await repo.save({ file: 'topic' }, 'topic');
    await repo.fs.promises.writeFile(`${repo.dir}/.git/MERGE_HEAD`, `${base}\n`);
    const result = await commit(repo.fs, repo.dir, 'complete');
    expect(result).toMatch(/^\[topic [a-f0-9]{7}\] complete$/);
    const completed = await git.readCommit({
      ...repo,
      oid: await git.resolveRef({ ...repo, ref: 'HEAD' }),
    });
    expect(completed.commit.parent).toEqual([topic, base]);
    await expect(repo.fs.promises.stat(`${repo.dir}/.git/MERGE_HEAD`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not duplicate a merge commit when cleanup fails and commit is retried', async () => {
    const repo = await fixture();
    const base = await repo.save({ file: 'base' }, 'base');
    await git.branch({ ...repo, ref: 'topic', checkout: true });
    const topic = await repo.save({ file: 'topic' }, 'topic');
    await repo.fs.promises.writeFile(`${repo.dir}/.git/MERGE_HEAD`, `${base}\n`);
    await repo.fs.promises.writeFile(`${repo.dir}/.git/MERGE_MSG`, 'Merge topic');

    const mergeHeadPath = `${repo.dir}/.git/MERGE_HEAD`;
    const originalUnlink = repo.fs.promises.unlink.bind(repo.fs.promises);
    let failed = false;
    const unlink = vi.spyOn(repo.fs.promises, 'unlink').mockImplementation(async path => {
      if (path === mergeHeadPath && !failed) {
        failed = true;
        throw new Error('unlink failure');
      }
      return originalUnlink(path);
    });

    try {
      await expect(commit(repo.fs, repo.dir, 'complete')).rejects.toThrow(
        /commit .* was created, but merge state cleanup failed/
      );
    } finally {
      unlink.mockRestore();
    }

    const mergedHead = await git.resolveRef({ ...repo, ref: 'HEAD' });
    expect(mergedHead).not.toBe(topic);
    expect(await repo.fs.promises.readFile(mergeHeadPath, 'utf8')).toBe(`${base}\n`);

    const result = await commit(repo.fs, repo.dir, 'complete');
    expect(result).toBe(`[topic ${mergedHead.slice(0, 7)}] complete`);
    expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(mergedHead);
    const completed = await git.readCommit({ ...repo, oid: mergedHead });
    expect(completed.commit.parent).toEqual([topic, base]);
    await expect(repo.fs.promises.stat(mergeHeadPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('commits new staged edits as a child after a merge cleanup retry', async () => {
    const repo = await fixture();
    const base = await repo.save({ file: 'base' }, 'base');
    await git.branch({ ...repo, ref: 'topic', checkout: true });
    await repo.save({ file: 'topic' }, 'topic');
    const mergeHeadPath = `${repo.dir}/.git/MERGE_HEAD`;
    await repo.fs.promises.writeFile(mergeHeadPath, `${base}\n`);
    await repo.fs.promises.writeFile(`${repo.dir}/.git/MERGE_MSG`, 'Merge topic');

    const originalUnlink = repo.fs.promises.unlink.bind(repo.fs.promises);
    let failed = false;
    const unlink = vi.spyOn(repo.fs.promises, 'unlink').mockImplementation(async path => {
      if (path === mergeHeadPath && !failed) {
        failed = true;
        throw new Error('unlink failure');
      }
      return originalUnlink(path);
    });
    try {
      await expect(commit(repo.fs, repo.dir, 'complete')).rejects.toThrow(
        /commit .* was created, but merge state cleanup failed/
      );
    } finally {
      unlink.mockRestore();
    }

    const mergeCommit = await git.resolveRef({ ...repo, ref: 'HEAD' });
    await repo.core.writeFile(`${repo.dir}/file`, 'follow-up');
    await git.add({ ...repo, filepath: 'file' });

    await commit(repo.fs, repo.dir, 'follow-up edit');

    const followUp = await git.resolveRef({ ...repo, ref: 'HEAD' });
    const commitObject = await git.readCommit({ ...repo, oid: followUp });
    expect(followUp).not.toBe(mergeCommit);
    expect(commitObject.commit.parent).toEqual([mergeCommit]);
    const tree = await git.readTree({ ...repo, oid: followUp });
    expect(tree.tree.map(entry => entry.path)).toEqual(['file']);
    expect(await repo.fs.promises.readFile(`${repo.dir}/file`, 'utf8')).toBe('follow-up');
    await expect(repo.fs.promises.stat(mergeHeadPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uses the same authenticated author for merge and revert commits', async () => {
    const repo = await fixture();
    await repo.save({ file: 'base', other: 'base' }, 'base');
    await git.branch({ ...repo, ref: 'topic' });
    await repo.save({ file: 'ours' }, 'ours');
    await git.checkout({ ...repo, ref: 'topic' });
    await repo.save({ other: 'theirs' }, 'theirs');
    await git.checkout({ ...repo, ref: 'main' });
    repo.fs.setCredentials(async () => ({ username: 'Stasshe', password: 'test-token' }));
    const fetchUser = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ login: 'Stasshe', name: 'Stasshe', email: 'stasshe@example.test' }),
            { status: 200 }
          )
      );
    try {
      await new GitMergeOperations(repo.fs, repo.dir).merge('topic');
      const merged = await git.readCommit({
        ...repo,
        oid: await git.resolveRef({ ...repo, ref: 'HEAD' }),
      });
      expect(merged.commit.author.name).toBe('Stasshe');
      expect(merged.commit.author.email).toBe('stasshe@example.test');
      const target = await repo.save({ file: 'target' }, 'target');
      await new GitRevertOperations(repo.fs, repo.dir).revert(target);
      const reverted = await git.readCommit({
        ...repo,
        oid: await git.resolveRef({ ...repo, ref: 'HEAD' }),
      });
      expect(reverted.commit.author.name).toBe('Stasshe');
      expect(reverted.commit.author.email).toBe('stasshe@example.test');
      expect(fetchUser).toHaveBeenCalledTimes(2);
    } finally {
      fetchUser.mockRestore();
    }
  });
  it('preserves the executable mode of a binary conflict through resolution and commit', async () => {
    const repo = await fixture();
    const author = { name: 'Stasshe', email: 'stasshe@example.test' };
    async function saveExecutable(bytes: Uint8Array, message: string) {
      await repo.core.writeFile(`${repo.dir}/file.bin`, bytes);
      const oid = await git.writeBlob({ ...repo, blob: bytes });
      await git.updateIndex({ ...repo, filepath: 'file.bin', oid, mode: 0o100755, add: true });
      return git.commit({ ...repo, message, author });
    }
    await saveExecutable(new Uint8Array([0, 255]), 'base');
    await git.branch({ ...repo, ref: 'topic' });
    const ours = new Uint8Array([0, 254]);
    const oursHead = await saveExecutable(ours, 'ours');
    const oursTree = await git.readTree({ ...repo, oid: oursHead });
    const oursEntry = oursTree.tree.find(entry => entry.path === 'file.bin');
    expect(oursEntry?.mode).toBe('100755');
    const oursOid = oursEntry?.oid;
    await git.checkout({ ...repo, ref: 'topic' });
    await saveExecutable(new Uint8Array([0, 253]), 'theirs');
    await git.checkout({ ...repo, ref: 'main' });
    repo.fs.reportMergeConflict = async () => {};
    await new GitMergeOperations(repo.fs, repo.dir).merge('topic');
    let stagedMode: number | undefined;
    let stagedOid: string | undefined;
    await git.walk({
      ...repo,
      trees: [git.STAGE()],
      map: async (path, [entry]) => {
        if (path === 'file.bin' && entry) {
          stagedMode = await entry.mode();
          stagedOid = await entry.oid();
        }
      },
    });
    expect(stagedMode).toBe(0o100755);
    expect(stagedOid).toBe(oursOid);
    expect(await repo.fs.promises.readFile(`${repo.dir}/file.bin`)).toEqual(ours);
    await add(repo.fs, repo.dir, 'file.bin');
    await commit(repo.fs, repo.dir, 'resolve binary', author);
    const completed = await git.readTree({
      ...repo,
      oid: await git.resolveRef({ ...repo, ref: 'HEAD' }),
    });
    expect(completed.tree.find(entry => entry.path === 'file.bin')?.mode).toBe('100755');
  });
});
