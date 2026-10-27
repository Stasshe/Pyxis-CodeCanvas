import { Buffer } from 'buffer';
import git from 'isomorphic-git';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubAPI } from '@/engine/system/git/github/GitHubAPI';
import { TreeBuilder } from '@/engine/system/git/github/TreeBuilder';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs } from '@/engine/core/fs/git';
import { directoryTree } from '../../../_helpers/opfs';

const author = { name: 'Stasshe', email: 'stasshe@example.test' };

async function fixture() {
  const core = new FsCore();
  await core.init(directoryTree());
  const fs = createGitFs(core);
  const dir = '/home/pyxis/tree-bytes';
  await core.mkdir(dir, { recursive: true });
  await git.init({ fs, dir, defaultBranch: 'main' });
  return { core, fs, dir };
}

afterEach(() => vi.restoreAllMocks());

describe('GitHub tree identity', () => {
  it('retains a mode-only change from a regular file to a symlink with identical bytes', async () => {
    const repo = await fixture();
    await repo.core.writeFile(`${repo.dir}/file`, 'target');
    await git.add({ ...repo, filepath: 'file' });
    const before = await git.commit({ ...repo, message: 'regular', author });
    const beforeCommit = await git.readCommit({ ...repo, oid: before });
    const beforeTree = await git.readTree({ ...repo, oid: beforeCommit.commit.tree });
    await repo.core.rm(`${repo.dir}/file`);
    await repo.core.symlink('target', `${repo.dir}/file`);
    await git.add({ ...repo, filepath: 'file' });
    const after = await git.commit({ ...repo, message: 'symlink', author });
    const afterCommit = await git.readCommit({ ...repo, oid: after });
    vi.spyOn(GitHubAPI.prototype, 'treeExists').mockResolvedValue(false);
    vi.spyOn(GitHubAPI.prototype, 'getTree').mockResolvedValue({
      sha: beforeCommit.commit.tree,
      tree: beforeTree.tree.map(entry => ({
        path: entry.path,
        mode: entry.mode,
        type: 'blob',
        sha: entry.oid,
      })),
    });
    const createBlob = vi.spyOn(GitHubAPI.prototype, 'createBlob');
    const createTree = vi
      .spyOn(GitHubAPI.prototype, 'createTree')
      .mockImplementation(async entries => {
        const tree = entries.map(entry => {
          if (!entry.sha) throw new Error('Unexpected deletion');
          return { path: entry.path, mode: entry.mode, type: entry.type, oid: entry.sha };
        });
        return { sha: await git.writeTree({ ...repo, tree }), tree: entries };
      });
    const builder = new TreeBuilder(
      repo.fs,
      repo.dir,
      new GitHubAPI('token', 'owner', 'repository')
    );
    expect(await builder.buildTree(after, beforeCommit.commit.tree)).toBe(afterCommit.commit.tree);
    expect(createTree).toHaveBeenCalledWith(
      [{ path: 'file', mode: '120000', type: 'blob', sha: beforeTree.tree[0].oid }],
      beforeCommit.commit.tree
    );
    expect(createBlob).not.toHaveBeenCalled();
  });

  it('uploads binary and BOM bytes without replacement decoding', async () => {
    const repo = await fixture();
    const binary = new Uint8Array([0, 255, 254, 128]);
    const bom = new Uint8Array([239, 187, 191, 65]);
    await repo.core.writeFile(`${repo.dir}/binary.txt`, binary);
    await repo.core.writeFile(`${repo.dir}/bom.txt`, bom);
    await git.add({ ...repo, filepath: 'binary.txt' });
    await git.add({ ...repo, filepath: 'bom.txt' });
    const head = await git.commit({ ...repo, message: 'bytes', author });
    const expected = await git.readCommit({ ...repo, oid: head });
    const uploaded: Uint8Array[] = [];
    vi.spyOn(GitHubAPI.prototype, 'createBlob').mockImplementation(async (content, encoding) => {
      expect(encoding).toBe('base64');
      const bytes = Buffer.from(content, 'base64');
      uploaded.push(Uint8Array.from(bytes));
      const { oid } = await git.hashBlob({ object: bytes });
      return { sha: oid, content, encoding: 'base64' };
    });
    vi.spyOn(GitHubAPI.prototype, 'createTree').mockImplementation(async entries => {
      const tree = entries.map(entry => {
        if (!entry.sha) throw new Error('Unexpected deletion');
        return { path: entry.path, mode: entry.mode, type: entry.type, oid: entry.sha };
      });
      return { sha: await git.writeTree({ ...repo, tree }), tree: entries };
    });
    const builder = new TreeBuilder(
      repo.fs,
      repo.dir,
      new GitHubAPI('token', 'owner', 'repository')
    );
    expect(await builder.buildTree(head)).toBe(expected.commit.tree);
    expect(uploaded).toEqual([binary, bom]);
  });
});
