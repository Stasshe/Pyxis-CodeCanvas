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

    const localCommitOid = await git.resolveRef({ fs, dir, ref: `refs/heads/${targetBranch}` });

    if (localCommitOid === remoteCommitOid) {
      return 'Already up to date.';
    }

    console.log(`[git pull] Merging ${remote}/${targetBranch} into ${targetBranch}...`);

    if (rebase) {
      throw new Error('git pull --rebase is not yet supported. Use merge instead.');
    }

    const localLog = await git.log({ fs, dir, depth: 100, ref: targetBranch });
    const isAncestor = localLog.some(c => c.oid === remoteCommitOid);

    if (!isAncestor) {
      const mergeOperations = new GitMergeOperations(fs, dir);
      const mergeResult = await mergeOperations.merge(remoteBranchRef, {
        message: `Merge branch '${remote}/${targetBranch}'`,
      });

      return `From ${remote}\n${mergeResult}`;
    }

    console.log('[git pull] Fast-forwarding...');

    await git.writeRef({
      fs,
      dir,
      ref: `refs/heads/${targetBranch}`,
      value: remoteCommitOid,
      force: true,
    });

    await git.checkout({ fs, dir, ref: targetBranch, force: true });

    const shortLocal = localCommitOid.slice(0, 7);
    const shortRemote = remoteCommitOid.slice(0, 7);

    return `Updating ${shortLocal}..${shortRemote}\nFast-forward`;
  } catch (error) {
    throw new Error(`git pull failed: ${(error as Error).message}`);
  }
}
