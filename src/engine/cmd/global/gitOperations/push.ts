/**
 * git push 実装
 * GitHub Git Data API + GraphQL APIを使用して正式なコミットとしてプッシュ
 */

import FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';

import { GitHubAPI } from './github/GitHubAPI';
import { TreeBuilder } from './github/TreeBuilder';
import { parseGitHubUrl } from './github/utils';

import { authRepository } from '@/engine/user/authRepository';

export interface PushOptions {
  remote?: string;
  branch?: string;
  force?: boolean;
}

/**
 * リモートHEAD以降の未pushコミット列を古い順に取得
 */
async function getCommitsToPush(
  fs: FS,
  dir: string,
  branch: string,
  remoteHeadSha: string | null
): Promise<any[]> {
  const localLog = await git.log({ fs, dir, ref: branch });

  if (!remoteHeadSha) {
    // リモートが空の場合は全コミットを返す
    return localLog.reverse();
  }

  // リモートHEADがローカル履歴に含まれているか確認
  const remoteHeadIndex = localLog.findIndex(c => c.oid === remoteHeadSha);

  if (remoteHeadIndex === -1) {
    // リモートHEADがローカル履歴にない = non-fast-forward
    throw new Error(
      `Updates were rejected because the remote contains work that you do not have locally.\n` +
        `This is usually caused by another repository pushing to the same ref.\n` +
        `You may want to first integrate the remote changes (e.g., 'git pull ...') before pushing again.`
    );
  }

  if (remoteHeadIndex === 0) {
    // 最新コミットがリモートと同じ = up-to-date
    return [];
  }

  // リモートHEAD以降のコミットを古い順に返す
  const commitsToPush = localLog.slice(0, remoteHeadIndex);
  return commitsToPush.reverse();
}

export async function push(fs: FS, dir: string, options: PushOptions = {}): Promise<string> {
  const { remote = 'origin', branch, force = false } = options;

  try {
    const token = await authRepository.getAccessToken();
    if (!token) {
      throw new Error('GitHub authentication required. Please sign in first.');
    }

    let targetBranch = branch;
    if (!targetBranch) {
      const currentBranch = await git.currentBranch({ fs, dir });
      if (!currentBranch) {
        throw new Error('No branch checked out');
      }
      targetBranch = currentBranch;
    }

    const remotes = await git.listRemotes({ fs, dir });
    const remoteInfo = remotes.find(r => r.remote === remote);

    if (!remoteInfo) {
      throw new Error(`Remote '${remote}' not found.`);
    }

    const repoInfo = parseGitHubUrl(remoteInfo.url);
    if (!repoInfo) {
      throw new Error('Only GitHub repositories are supported');
    }

    const githubAPI = new GitHubAPI(token, repoInfo.owner, repoInfo.repo);

    // 1. リモートHEADを取得
    const remoteRef = await githubAPI.getRef(targetBranch);

    let remoteHeadSha: string | null = null;
    let isNewBranch = false;

    if (!remoteRef) {
      // リモートにブランチが存在しない場合
      console.log(
        `[git push] Remote branch '${targetBranch}' does not exist. Creating new branch...`
      );
      isNewBranch = true;

      // デフォルトブランチ(main/master)が存在するか確認
      const defaultBranch = await githubAPI.getRef('main').catch(() => githubAPI.getRef('master'));

      if (!defaultBranch) {
        throw new Error(
          'Push failed: Remote repository is empty.\n\n' +
            'Empty repositories are not supported. Please:\n' +
            '1. Initialize the repository with a README on GitHub, or\n' +
            '2. Push from another Git client first, or\n' +
            '3. Create an initial commit on GitHub web interface'
        );
      }
    } else {
      remoteHeadSha = remoteRef.object.sha;
      console.log('[git push] Remote HEAD:', remoteHeadSha.slice(0, 7));
    }

    // 2. 未pushコミット列を取得（古い順）
    let commitsToPush: any[];

    if (isNewBranch) {
      // 新しいブランチの場合は全コミットをpush
      const localLog = await git.log({ fs, dir, ref: targetBranch });
      commitsToPush = localLog.reverse();
      console.log(`[git push] New branch: pushing all ${commitsToPush.length} commit(s)`);
    } else {
      try {
        commitsToPush = await getCommitsToPush(fs, dir, targetBranch, remoteHeadSha);
      } catch (error: any) {
        if (!force && error.message.includes('Updates were rejected')) {
          throw error;
        }
        // forceの場合は全コミットをpush
        if (force) {
          const localLog = await git.log({ fs, dir, ref: targetBranch });
          commitsToPush = localLog.reverse();
        } else {
          throw error;
        }
      }
    }

    if (commitsToPush.length === 0) {
      return 'Everything up-to-date';
    }

    console.log(`[git push] Pushing ${commitsToPush.length} commit(s)...`);

    // リモートツリーSHAを取得（差分アップロードのため）
    let remoteTreeSha: string | undefined;
    if (remoteHeadSha) {
      try {
        const remoteCommit = await githubAPI.getCommit(remoteHeadSha);
        remoteTreeSha = remoteCommit.tree.sha;
      } catch (error) {
        console.warn('[git push] Failed to get remote tree:', error);
      }
    }

    // 3. 各コミットを順番にpush
    let parentSha: string | null = remoteHeadSha;
    let lastCommitSha: string | null = remoteHeadSha;
    const treeBuilder = new TreeBuilder(fs, dir, githubAPI);
    // Optimize: if some of the local commits already exist on the remote, don't recreate them.
    // Find the latest commit in `commitsToPush` that already exists remotely and only create
    // the commits after it. This avoids re-creating history that already exists on GitHub
    // (common when resetting to an older commit and force-pushing).
    if (commitsToPush.length > 0) {
      let lastExistingIndex = -1;
      // Iterate from newest to oldest to find the latest one that exists remotely
      for (let i = commitsToPush.length - 1; i >= 0; i--) {
        const c = commitsToPush[i];
        try {
          // If the commit exists remotely, getCommit will succeed
          await githubAPI.getCommit(c.oid);
          lastExistingIndex = i;
          break;
        } catch (err) {
          // not found -> keep searching earlier commits
        }
      }

      if (lastExistingIndex >= 0) {
        // Use the existing commit as the parent and only create later commits
        parentSha = commitsToPush[lastExistingIndex].oid;
        // Slice commitsToPush to only include commits that don't exist remotely
        commitsToPush = commitsToPush.slice(lastExistingIndex + 1);
        console.log(
          `[git push] Detected ${lastExistingIndex + 1} existing commit(s) on remote; creating ${commitsToPush.length} new commit(s)`
        );
      } else {
        // None of the local commits exist remotely. In this case, if remoteHeadSha is not
        // part of the local history (non-fast-forward), we should start creating commits
        // with no parent (initial commit) rather than trying to attach to an unknown remote parent.
        if (!remoteHeadSha) {
          parentSha = null;
        } else {
          // If remoteHeadSha exists but wasn't found in local history, reset parent to null
          // to avoid creating commits that reference an unrelated remote parent.
          parentSha = null;
        }
      }
    }

    for (const commit of commitsToPush) {
      console.log(
        `[git push] Processing commit: ${commit.oid.slice(0, 7)} - ${commit.commit.message.split('\n')[0]}`
      );

      // ツリーを構築（差分アップロード）
      const treeSha = await treeBuilder.buildTree(commit.oid, remoteTreeSha);

      // コミットを作成
      const commitData = await githubAPI.createCommit({
        message: commit.commit.message,
        tree: treeSha,
        parents: parentSha ? [parentSha] : [],
        author: {
          name: commit.commit.author.name,
          email: commit.commit.author.email,
          date: new Date(commit.commit.author.timestamp * 1000).toISOString(),
        },
        committer: {
          name: commit.commit.committer.name,
          email: commit.commit.committer.email,
          date: new Date(commit.commit.committer.timestamp * 1000).toISOString(),
        },
      });

      console.log(`[git push] Created remote commit: ${commitData.sha.slice(0, 7)}`);

      // 次のコミットのparentとして使用
      parentSha = commitData.sha;
      lastCommitSha = commitData.sha;

      // 次の差分アップロード用にremoteTreeShaを更新
      remoteTreeSha = treeSha;
    }

    if (!lastCommitSha) {
      throw new Error('Failed to create commits');
    }

    // 4. ブランチrefを最新のコミットに更新
    console.log('[git push] Updating branch reference...');

    if (isNewBranch) {
      // 新しいブランチを作成
      await githubAPI.createRef(targetBranch, lastCommitSha);
      console.log(`[git push] Created new branch '${targetBranch}'`);
    } else {
      // 既存のブランチを更新
      await githubAPI.updateRef(targetBranch, lastCommitSha, force);
    }

    // リモート追跡ブランチを更新
    try {
      await git.writeRef({
        fs,
        dir,
        ref: `refs/remotes/${remote}/${targetBranch}`,
        value: lastCommitSha,
        force: true,
      });
      console.log(
        '[git push] Updated remote tracking branch:',
        `${remote}/${targetBranch} -> ${lastCommitSha.slice(0, 7)}`
      );
    } catch (error) {
      console.warn('[git push] Failed to update remote tracking branch:', error);
    }

    const remoteUrl = remoteInfo.url;
    let result = `To ${remoteUrl}\n`;

    if (isNewBranch) {
      result += ` * [new branch]      ${targetBranch} -> ${targetBranch}\n`;
    } else {
      result += `   ${remoteHeadSha?.slice(0, 7) || '0000000'}..${lastCommitSha.slice(0, 7)}  ${targetBranch} -> ${targetBranch}\n`;
    }

    return result;
  } catch (error: any) {
    console.error('[git push] Error:', error);
    throw new Error(`Push failed: ${error.message}`);
  }
}

export async function addRemote(fs: FS, dir: string, remote: string, url: string): Promise<string> {
  await git.addRemote({ fs, dir, remote, url });
  return `Remote '${remote}' added: ${url}`;
}

export async function listRemotes(fs: FS, dir: string): Promise<string> {
  const remotes = await git.listRemotes({ fs, dir });
  if (remotes.length === 0) return 'No remotes configured.';
  return remotes.map(r => `${r.remote}\t${r.url}`).join('\n');
}

export async function deleteRemote(fs: FS, dir: string, remote: string): Promise<string> {
  await git.deleteRemote({ fs, dir, remote });
  return `Remote '${remote}' deleted.`;
}
