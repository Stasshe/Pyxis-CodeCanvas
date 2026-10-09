import git from 'isomorphic-git';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type GitCommit,
  GitHubAPI,
  GitHubAPIError,
} from '@/engine/system/git/github/GitHubAPI';
import { TreeBuilder } from '@/engine/system/git/github/TreeBuilder';
import { push } from '@/engine/system/git/push';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs } from '@/engine/core/fs/git';
import { directoryTree } from '../../../_helpers/opfs';

type CommitRequest = Parameters<GitHubAPI['createCommit']>[0] & { signature?: string };

function identity(date: string) {
  let timezoneOffset = 0;
  const offset = date.match(/([+-])(\d{2}):(\d{2})$/);
  if (offset) {
    timezoneOffset = Number(offset[2]) * 60 + Number(offset[3]);
    if (offset[1] === '+' && timezoneOffset !== 0) timezoneOffset *= -1;
    if (offset[1] === '-' && timezoneOffset === 0) timezoneOffset = -0;
  }
  return { timestamp: Date.parse(date) / 1000, timezoneOffset };
}

async function fixture() {
  const core = new FsCore();
  await core.init(directoryTree());
  const fs = createGitFs(core);
  const dir = '/home/pyxis/push-history';
  await core.mkdir(dir, { recursive: true });
  await git.init({ fs, dir, defaultBranch: 'main' });
  fs.setCredentials(async () => ({ username: 'token', password: 'test-token' }));
  await git.addRemote({ fs, dir, remote: 'origin', url: 'https://github.com/example/repository' });
  const tree = await git.writeTree({ fs, dir, tree: [] });
  const commits = new Map<string, GitCommit>();
  const requests: CommitRequest[] = [];
  let remoteHead: string | null = null;
  async function save(
    parent: string[],
    message: string,
    timestamp = 1000,
    timezoneOffset = 0,
    gpgsig?: string
  ) {
    const person = { name: 'Stasshe', email: 'stasshe@example.test', timestamp, timezoneOffset };
    const oid = await git.writeCommit({
      fs,
      dir,
      commit: { tree, parent, message: `${message}\n`, author: person, committer: person, gpgsig },
    });
    await git.writeRef({ fs, dir, ref: 'refs/heads/main', value: oid, force: true });
    return oid;
  }
  async function seedRemote(oid: string) {
    const { commit } = await git.readCommit({ fs, dir, oid });
    commits.set(oid, {
      sha: oid,
      tree: { sha: commit.tree },
      parents: commit.parent.map(sha => ({ sha })),
      message: commit.message,
      author: { name: commit.author.name, email: commit.author.email, date: '' },
      committer: { name: commit.committer.name, email: commit.committer.email, date: '' },
    });
    remoteHead = oid;
  }
  vi.spyOn(GitHubAPI.prototype, 'getRef').mockImplementation(async branch => {
    if (branch === 'main' && remoteHead)
      return { ref: 'refs/heads/main', object: { sha: remoteHead, type: 'commit' } };
    return null;
  });
  vi.spyOn(GitHubAPI.prototype, 'getDefaultBranch').mockResolvedValue('main');
  vi.spyOn(GitHubAPI.prototype, 'getCommit').mockImplementation(async oid => {
    const commit = commits.get(oid);
    if (!commit) throw new GitHubAPIError(404, 'Not Found');
    return commit;
  });
  vi.spyOn(TreeBuilder.prototype, 'buildTree').mockResolvedValue(tree);
  const create = vi
    .spyOn(GitHubAPI.prototype, 'createCommit')
    .mockImplementation(async (request: CommitRequest) => {
      requests.push(request);
      for (const parent of request.parents) {
        if (!commits.has(parent)) throw new Error(`Parent was not uploaded: ${parent}`);
      }
      const oid = await git.writeCommit({
        fs,
        dir,
        commit: {
          tree: request.tree,
          parent: request.parents,
          message: request.message,
          author: {
            name: request.author.name,
            email: request.author.email,
            ...identity(request.author.date),
          },
          committer: {
            name: request.committer.name,
            email: request.committer.email,
            ...identity(request.committer.date),
          },
          gpgsig: request.signature,
        },
      });
      const result = {
        sha: oid,
        tree: { sha: request.tree },
        parents: request.parents.map(sha => ({ sha })),
        message: request.message,
        author: request.author,
        committer: request.committer,
      };
      commits.set(oid, result);
      return result;
    });
  const update = vi
    .spyOn(GitHubAPI.prototype, 'updateRef')
    .mockImplementation(async (branch, oid) => {
      remoteHead = oid;
      return { ref: `refs/heads/${branch}`, object: { sha: oid, type: 'commit' } };
    });
  const createRef = vi
    .spyOn(GitHubAPI.prototype, 'createRef')
    .mockImplementation(async (branch, oid) => ({
      ref: `refs/heads/${branch}`,
      object: { sha: oid, type: 'commit' },
    }));
  return {
    core,
    fs,
    dir,
    tree,
    save,
    seedRemote,
    requests,
    create,
    update,
    createRef,
    remoteHead: () => remoteHead,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('GitHub history identity', () => {
  it('uploads both merge parents before the merge even with skewed timestamps', async () => {
    const repo = await fixture();
    const base = await repo.save([], 'base');
    await repo.seedRemote(base);
    const ours = await repo.save([base], 'ours', 5000);
    const theirs = await repo.save([base], 'theirs', 3000);
    const merge = await repo.save([ours, theirs], 'merge', 2000);
    await push(repo.fs, repo.dir);
    expect(repo.remoteHead()).toBe(merge);
    expect(repo.requests.find(request => request.message === 'merge\n')?.parents).toEqual([
      ours,
      theirs,
    ]);
    expect(repo.requests).toHaveLength(3);
    expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(merge);
  });

  it('pushes more than 100 commits without truncating ancestry', async () => {
    const repo = await fixture();
    let head = await repo.save([], 'base');
    await repo.seedRemote(head);
    for (let index = 0; index < 101; index++)
      head = await repo.save([head], `change ${index}`, 2000 + index);
    await push(repo.fs, repo.dir);
    expect(repo.requests).toHaveLength(101);
    expect(repo.remoteHead()).toBe(head);
  });

  it('rejects unrelated history even when its tree matches exactly', async () => {
    const repo = await fixture();
    const remote = await repo.save([], 'remote');
    await repo.seedRemote(remote);
    const local = await repo.save([], 'unrelated');
    await expect(push(repo.fs, repo.dir)).rejects.toThrow('Updates were rejected');
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.remoteHead()).toBe(remote);
    expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(local);
  });

  it('preserves author timezone and the signed commit header', async () => {
    const repo = await fixture();
    const base = await repo.save([], 'base');
    await repo.seedRemote(base);
    const signature = '-----BEGIN PGP SIGNATURE-----\nproof\n-----END PGP SIGNATURE-----';
    const head = await repo.save([base], 'signed', 1700000000, -540, signature);
    await push(repo.fs, repo.dir);
    expect(repo.requests[0].author.date).toMatch(/\+09:00$/);
    expect(repo.requests[0].signature).toBe(signature);
    expect(repo.remoteHead()).toBe(head);
  });

  it('never updates refs when the API changes an object identity', async () => {
    const repo = await fixture();
    const base = await repo.save([], 'base');
    await repo.seedRemote(base);
    const head = await repo.save([base], 'new');
    await repo.core.writeFile(`${repo.dir}/untracked.bin`, new Uint8Array([0, 255, 128]));
    repo.create.mockImplementationOnce(async request => ({
      sha: 'f'.repeat(40),
      tree: { sha: request.tree },
      parents: request.parents.map(sha => ({ sha })),
      message: request.message,
      author: request.author,
      committer: request.committer,
    }));
    await expect(push(repo.fs, repo.dir)).rejects.toThrow('identity');
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.remoteHead()).toBe(base);
    expect(await git.resolveRef({ ...repo, ref: 'HEAD' })).toBe(head);
    expect(await repo.fs.promises.readFile(`${repo.dir}/untracked.bin`)).toEqual(
      new Uint8Array([0, 255, 128])
    );
  });
});
