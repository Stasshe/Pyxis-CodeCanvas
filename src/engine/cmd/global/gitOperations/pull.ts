import { syncManager } from '@/engine/core/syncManager';
// src/engine/cmd/global/gitOperations/pull.ts
import git from 'isomorphic-git';
import { GitMergeOperations } from './merge';

export async function pull(
  fs: any,
  dir: string,
  projectId: string,
  projectName: string,
  options: { remote?: string; branch?: string; rebase?: boolean } = {}
): Promise<string> {
  const { remote = 'origin', branch, rebase = false } = options;

  try {
    // 現在のブランチを取得
    let targetBranch = branch;
    if (!targetBranch) {
      const currentBranch = await git.currentBranch({ fs, dir });
      if (!currentBranch) {
        throw new Error('No branch checked out');
      }
      targetBranch = currentBranch;
    }

    // 1. fetch実行
    console.log(`[git pull] Fetching from ${remote}/${targetBranch}...`);
    const { fetch } = await import('./fetch');
    await fetch(fs, dir, { remote, branch: targetBranch });

    // 2. リモート追跡ブランチのコミットIDを取得
    const remoteBranchRef = `refs/remotes/${remote}/${targetBranch}`;
    let remoteCommitOid: string;

    try {
      remoteCommitOid = await git.resolveRef({ fs, dir, ref: remoteBranchRef });
    } catch {
      throw new Error(`Remote branch '${remote}/${targetBranch}' not found after fetch`);
    }

    // 3. ローカルのコミットIDを取得
    const localCommitOid = await git.resolveRef({ fs, dir, ref: `refs/heads/${targetBranch}` });

    // 4. すでに最新の場合
    if (localCommitOid === remoteCommitOid) {
      return 'Already up to date.';
    }

    console.log(`[git pull] Merging ${remote}/${targetBranch} into ${targetBranch}...`);

    if (rebase) {
      throw new Error('git pull --rebase is not yet supported. Use merge instead.');
    }

    // 5. Fast-forward可能かチェック
    const localLog = await git.log({ fs, dir, depth: 100, ref: targetBranch });
    const isAncestor = localLog.some(c => c.oid === remoteCommitOid);

    if (!isAncestor) {
      // マージ実行（リモートコミットをマージ）
      const mergeOperations = new GitMergeOperations(fs, dir, projectId, projectName);
      const mergeResult = await mergeOperations.merge(remoteBranchRef, {
        message: `Merge branch '${remote}/${targetBranch}'`,
      });

      return `From ${remote}\n${mergeResult}`;
    }

    // Fast-forward
    console.log('[git pull] Fast-forwarding...');

    await git.writeRef({
      fs,
      dir,
      ref: `refs/heads/${targetBranch}`,
      value: remoteCommitOid,
      force: true,
    });

    await git.checkout({ fs, dir, ref: targetBranch, force: true });

    // IndexedDBに同期
    await syncManager.syncFromFSToIndexedDB(projectId, projectName);

    const shortLocal = localCommitOid.slice(0, 7);
    const shortRemote = remoteCommitOid.slice(0, 7);

    return `Updating ${shortLocal}..${shortRemote}\nFast-forward`;
  } catch (error) {
    throw new Error(`git pull failed: ${(error as Error).message}`);
  }
}
