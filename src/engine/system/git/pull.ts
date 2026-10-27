import git from 'isomorphic-git';
import type { GitFs as FS } from '@/engine/core/fs/git';
import { GitMergeOperations } from './merge';

export async function pull(
  fs: FS,
  dir: string,
  options: { remote?: string; branch?: string; rebase?: boolean } = {}
): Promise<string> {
  const { remote = 'origin', branch, rebase = false } = options;

  try {
    if (rebase) {
      throw new Error('git pull --rebase is not yet supported. Use merge instead.');
    }

    let targetBranch = branch;
    if (!targetBranch) {
      const currentBranch = await git.currentBranch({ fs, dir });
      if (!currentBranch) {
        throw new Error('No branch checked out');
      }
      targetBranch = currentBranch;
    }

    console.log(`[git pull] Fetching from ${remote}/${targetBranch}...`);
    const { fetch } = await import('./fetch');
    await fetch(fs, dir, { remote, branch: targetBranch });

    const remoteBranchRef = `refs/remotes/${remote}/${targetBranch}`;
    let remoteCommitOid: string;

    try {
      remoteCommitOid = await git.resolveRef({ fs, dir, ref: remoteBranchRef });
    } catch {
      throw new Error(`Remote branch '${remote}/${targetBranch}' not found after fetch`);
    }

    const localCommitOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });

    if (
      localCommitOid === remoteCommitOid ||
      (await git.isDescendent({ fs, dir, oid: localCommitOid, ancestor: remoteCommitOid }))
    ) {
      return 'Already up to date.';
    }

    const mergeOperations = new GitMergeOperations(fs, dir);
    const mergeResult = await mergeOperations.merge(remoteBranchRef, {
      message: `Merge branch '${remote}/${targetBranch}'`,
    });
    return `From ${remote}\n${mergeResult}`;
  } catch (error) {
    throw new Error(`git pull failed: ${(error as Error).message}`);
  }
}
