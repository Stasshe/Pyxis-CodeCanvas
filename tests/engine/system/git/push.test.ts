import git from 'isomorphic-git';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubAPI, GitHubAPIError } from '@/engine/system/git/github/GitHubAPI';
import { TreeBuilder } from '@/engine/system/git/github/TreeBuilder';
import { push } from '@/engine/system/git/push';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs } from '@/engine/core/fs/git';
import { directoryTree } from '../../../_helpers/opfs';

afterEach(() => vi.restoreAllMocks());

describe('GitHub new branch push', () => {
  it('pushes a new branch when the repository default branch is master', async () => {
    const core = new FsCore();
    await core.init(directoryTree());
    const dir = '/home/pyxis/push';
    await core.mkdir(dir, { recursive: true });
    const fs = createGitFs(core);
    fs.setCredentials(async () => ({ username: 'token', password: 'test-token' }));
    await git.init({ fs, dir, defaultBranch: 'topic' });
    await core.writeFile(`${dir}/file.txt`, 'content');
    await git.add({ fs, dir, filepath: 'file.txt' });
    const oid = await git.commit({
      fs,
      dir,
      message: 'initial',
      author: { name: 'Stasshe', email: 'stasshe@example.test' },
    });
    await git.addRemote({
      fs,
      dir,
      remote: 'origin',
      url: 'https://github.com/example/repository',
    });
    const { commit } = await git.readCommit({ fs, dir, oid });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === 'https://api.github.com/repos/example/repository') {
          return new Response(JSON.stringify({ default_branch: 'master' }));
        }
        throw new Error(`Unexpected network request: ${url}`);
      })
    );
    const getRef = vi.spyOn(GitHubAPI.prototype, 'getRef').mockImplementation(async branch => {
      if (branch === 'master')
        return { ref: 'refs/heads/master', object: { sha: oid, type: 'commit' } };
      return null;
    });
    vi.spyOn(GitHubAPI.prototype, 'getCommit').mockRejectedValue(
      new GitHubAPIError(404, 'Not Found')
    );
    vi.spyOn(TreeBuilder.prototype, 'buildTree').mockResolvedValue(commit.tree);
    vi.spyOn(GitHubAPI.prototype, 'createCommit').mockResolvedValue({
      sha: oid,
      tree: { sha: commit.tree },
      parents: [],
      message: 'initial',
      author: { name: 'Stasshe', email: 'stasshe@example.test', date: '' },
      committer: { name: 'Stasshe', email: 'stasshe@example.test', date: '' },
    });
    const createRef = vi
      .spyOn(GitHubAPI.prototype, 'createRef')
      .mockResolvedValue({ ref: 'refs/heads/topic', object: { sha: oid, type: 'commit' } });
    try {
      expect(await push(fs, dir)).toContain('[new branch]');
      expect(getRef).toHaveBeenCalledWith('master');
      expect(createRef).toHaveBeenCalledWith('topic', oid);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
