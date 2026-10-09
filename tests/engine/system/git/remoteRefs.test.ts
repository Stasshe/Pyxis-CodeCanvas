import git from 'isomorphic-git';
import { describe, expect, it } from 'vitest';
import { GitLogOperations } from '@/engine/system/git/log';
import { listAllRemoteRefs } from '@/engine/system/git/remoteRefs';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs } from '@/engine/core/fs/git';
import { directoryTree } from '../../../_helpers/opfs';

async function fixture() {
  const core = new FsCore();
  await core.init(directoryTree());
  const fs = createGitFs(core);
  const dir = '/home/pyxis/remote-refs';
  await core.mkdir(dir, { recursive: true });
  await git.init({ fs, dir, defaultBranch: 'feature/local' });
  const tree = await git.writeTree({ fs, dir, tree: [] });
  const person = {
    name: 'Stasshe',
    email: 'stasshe@example.test',
    timestamp: 1000,
    timezoneOffset: 0,
  };
  const oid = await git.writeCommit({
    fs,
    dir,
    commit: { tree, parent: [], message: 'local\n', author: person, committer: person },
  });
  await git.writeRef({ fs, dir, ref: 'refs/heads/feature/local', value: oid });
  return { core, fs, dir, oid };
}

describe('Qualified Git branch references', () => {
  it('lists nested packed references for custom configured remotes', async () => {
    const repo = await fixture();
    await git.addRemote({ ...repo, remote: 'team', url: 'https://github.com/example/repo' });
    await repo.core.writeFile(
      `${repo.dir}/.git/packed-refs`,
      `# pack-refs with: peeled fully-peeled sorted\n${repo.oid} refs/remotes/team/feature/nested\n`
    );
    expect(await listAllRemoteRefs(repo.fs, repo.dir)).toEqual(['team/feature/nested']);
  });

  it('includes a local slash branch in all-branch history and its labels', async () => {
    const repo = await fixture();
    const result = await new GitLogOperations(repo.fs, repo.dir).getFormattedLog(20, {
      mode: 'all',
    });
    expect(result).toContain(repo.oid);
    expect(result).toContain('|feature/local|');
  });
});
