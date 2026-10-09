import git from 'isomorphic-git';
import { afterEach, expect, it, vi } from 'vitest';
import {
  fetchAll,
  listRemoteBranches,
  listRemoteTags,
} from '@/engine/cmd/global/gitOperations/fetch';
import { GitLogOperations } from '@/engine/cmd/global/gitOperations/log';
import { WorkerGitCommands } from '@/engine/cmd/global/gitOperations/worker';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs } from '@/engine/core/fs/git';
import { directoryTree } from '../../../../_helpers/opfs';

afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const core = new FsCore();
  await core.init(directoryTree());
  const dir = '/home/pyxis/read-failures';
  await core.mkdir(dir, { recursive: true });
  const fs = createGitFs(core);
  await git.init({ fs, dir, defaultBranch: 'main' });
  return { core, dir, fs, worker: new WorkerGitCommands(core, dir) };
}

it('reports a corrupt HEAD instead of claiming no repository', async () => {
  const repo = await fixture();
  vi.spyOn(git, 'currentBranch').mockRejectedValue(new Error('Corrupt HEAD'));
  await expect(repo.worker.getCurrentBranch()).rejects.toThrow('Corrupt HEAD');
});

it('reports unavailable parent objects instead of an empty parent list', async () => {
  const repo = await fixture();
  await expect(repo.worker.getParentCommitIds('f'.repeat(40))).rejects.toThrow();
});

it('reports branch listing storage failures instead of empty lists', async () => {
  const repo = await fixture();
  vi.spyOn(git, 'listBranches').mockRejectedValue(new Error('Storage unavailable'));
  await expect(new GitLogOperations(repo.fs, repo.dir).getAvailableBranches()).rejects.toThrow(
    'Storage unavailable'
  );
});

it('reports remote branch and tag enumeration failures', async () => {
  const repo = await fixture();
  vi.spyOn(git, 'listBranches').mockRejectedValue(new Error('Broken refs'));
  vi.spyOn(git, 'listTags').mockRejectedValue(new Error('Broken tags'));
  await expect(listRemoteBranches(repo.fs, repo.dir)).rejects.toThrow('Broken refs');
  await expect(listRemoteTags(repo.fs, repo.dir)).rejects.toThrow('Broken tags');
});

it('rejects fetch-all when a remote fails instead of returning success text', async () => {
  const repo = await fixture();
  await git.addRemote({ ...repo, remote: 'origin', url: 'https://github.com/example/repo' });
  vi.spyOn(git, 'fetch').mockRejectedValue(new Error('Transport unavailable'));
  const network = vi.fn().mockRejectedValue(new Error('Unexpected network request'));
  vi.stubGlobal('fetch', network);
  try {
    await expect(fetchAll(repo.fs, repo.dir)).rejects.toThrow('Transport unavailable');
    expect(network).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
