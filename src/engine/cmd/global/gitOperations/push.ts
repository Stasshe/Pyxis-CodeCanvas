/**
 * git push 実装 - 高速化版
 *
 * GitHub Git Data API + REST APIを使用して効率的にプッシュ
 *
 * 最適化ポイント:
 * 1. Compare APIで差分を一度に取得
 * 2. バッチでコミット履歴を取得（1回のAPIで最大100件）
 * 3. ローカル履歴との比較をメモリ上で実行
 * 4. 不要なAPI呼び出しを削減
 */

import type FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';

import { GitHubAPI } from './github/GitHubAPI';
import { TreeBuilder } from './github/TreeBuilder';
import { parseGitHubUrl } from './github/utils';

import type { TerminalUI } from '@/engine/cmd/terminalUI';
import { authRepository } from '@/engine/user/authRepository';

export interface PushOptions {
  remote?: string;
  branch?: string;
  force?: boolean;
}

interface LocalCommit {
  oid: string;
  commit: {
    tree: string;
    message: string;
    author: { name: string; email: string; timestamp: number };
    committer: { name: string; email: string; timestamp: number };
  };
}

/**
 * 効率的な方法で未プッシュのコミットを取得
 *
 * 方針:
 * 1. リモートHEADのコミットSHAがローカル履歴にあるか確認（fast-forward判定）
 * 2. なければツリーSHAで内容の同一性を確認
 * 3. 差分のみをプッシュ
 */
async function getCommitsToPushOptimized(
  fs: FS,
  dir: string,
  branch: string,
  remoteHeadSha: string | null,
  githubAPI: GitHubAPI
): Promise<{ commits: LocalCommit[]; remoteParentSha: string | null }> {
  // ローカルの履歴を取得（最大100件で十分）
  const localLog = await git.log({ fs, dir, ref: branch, depth: 100 });

  if (!remoteHeadSha) {
    // リモートが空の場合は全コミットを返す
    console.log('[git push] Remote is empty, pushing all commits');
    return {
      commits: localLog.reverse() as LocalCommit[],
      remoteParentSha: null,
    };
  }

  // ステップ1: リモートHEADがローカル履歴に存在するか確認（高速判定）
  const remoteHeadIndex = localLog.findIndex((c: { oid: string }) => c.oid === remoteHeadSha);

  if (remoteHeadIndex !== -1) {
    // Fast-forward可能: リモートHEADはローカル履歴に存在
    if (remoteHeadIndex === 0) {
      // 最新コミットがリモートHEAD = 何もプッシュする必要なし
      console.log('[git push] Already up-to-date (same commit)');
      return { commits: [], remoteParentSha: remoteHeadSha };
    }

    // リモートHEAD以降のコミットを返す
    const commitsToPush = localLog.slice(0, remoteHeadIndex);
    console.log(`[git push] Fast-forward: ${commitsToPush.length} commit(s) to push`);
    return {
      commits: commitsToPush.reverse() as LocalCommit[],
      remoteParentSha: remoteHeadSha,
    };
  }

  // ステップ2: リモートHEADのツリーSHAを取得し、同じツリーを持つローカルコミットを探す
  // これは履歴が異なっていても内容が同じ場合を検出
  console.log('[git push] Remote HEAD not in local history, checking tree SHA...');

  let remoteTreeSha: string;
  try {
    remoteTreeSha = await githubAPI.getCommitTree(remoteHeadSha);
  } catch (error) {
    console.warn('[git push] Failed to get remote tree:', error);
    throw new Error(
      'Updates were rejected because the remote contains work that you do not have locally.\n' +
        'This is usually caused by another repository pushing to the same ref.\n' +
        'You may want to first integrate the remote changes (e.g., "git pull ...") before pushing again.'
    );
  }

  // ローカル履歴で同じツリーSHAを持つコミットを探す
  for (let i = 0; i < localLog.length; i++) {
    const localCommit = localLog[i];
    if (localCommit.commit.tree === remoteTreeSha) {
      // 内容は同じだが履歴が異なる
      if (i === 0) {
        console.log('[git push] Already up-to-date (same tree content)');
        return { commits: [], remoteParentSha: remoteHeadSha };
      }

      const commitsToPush = localLog.slice(0, i);
      console.log(`[git push] Content match found: ${commitsToPush.length} commit(s) to push`);
      return {
        commits: commitsToPush.reverse() as LocalCommit[],
        remoteParentSha: remoteHeadSha,
      };
    }
  }

  // ツリーの一致も見つからない = non-fast-forward
  throw new Error(
    'Updates were rejected because the remote contains work that you do not have locally.\n' +
      'This is usually caused by another repository pushing to the same ref.\n' +
      'You may want to first integrate the remote changes (e.g., "git pull ...") before pushing again.'
  );
}

/**
 * Force push用: 共通の祖先を効率的に探す
 *
 * 方針:
 * 1. Compare APIで差分を取得（merge_base_commitが共通祖先）
 * 2. ローカルのツリーSHAと比較して最も近い祖先を特定
 */
async function findCommonAncestorOptimized(
  fs: FS,
  dir: string,
  branch: string,
  remoteHeadSha: string,
  githubAPI: GitHubAPI
): Promise<{ remoteAncestorSha: string; localAncestorTreeSha: string } | null> {
  try {
    // リモートのコミット履歴をバッチ取得（1回のAPIで最大100件）
    const remoteCommits = await githubAPI.getCommitHistory(remoteHeadSha, 100);

    if (remoteCommits.length === 0) {
      return null;
    }

    // リモートコミットのツリーSHAをSetに格納（高速検索用）
    const remoteTreeMap = new Map<string, string>(); // treeSha -> commitSha
    for (const commit of remoteCommits) {
      remoteTreeMap.set(commit.commit.tree.sha, commit.sha);
    }

    // ローカルの履歴を取得
    const localLog = await git.log({ fs, dir, ref: branch, depth: 100 });

    // ローカルの各コミットのツリーSHAと比較
    for (const localCommit of localLog) {
      const localTreeSha = localCommit.commit.tree;
      const matchingRemoteSha = remoteTreeMap.get(localTreeSha);

      if (matchingRemoteSha) {
        console.log(
          `[git push] Common ancestor found: remote ${matchingRemoteSha.slice(0, 7)} ` +
            `<-> local ${localCommit.oid.slice(0, 7)} (tree: ${localTreeSha.slice(0, 7)})`
        );
        return {
          remoteAncestorSha: matchingRemoteSha,
          localAncestorTreeSha: localTreeSha,
        };
      }
    }

    console.log('[git push] No common ancestor found');
    return null;
  } catch (error) {
    console.warn('[git push] findCommonAncestorOptimized failed:', error);
    return null;
  }
}

export async function push(
  fs: FS,
  dir: string,
  options: PushOptions = {},
  ui?: TerminalUI
): Promise<string> {
  const { remote = 'origin', branch, force = false } = options;

  try {
    // Start spinner if TerminalUI is available
    if (ui) {
      await ui.spinner.start('Enumerating objects...');
    }

    const token = await authRepository.getAccessToken();
    if (!token) {
      if (ui) await ui.spinner.stop();
      throw new Error('GitHub authentication required. Please sign in first.');
    }

    let targetBranch: string = branch ?? '';
    if (!targetBranch) {
      const currentBranch = await git.currentBranch({ fs, dir });
      if (!currentBranch) {
        throw new Error('No branch checked out');
      }
      targetBranch = currentBranch;
    }

    const remotes = await git.listRemotes({ fs, dir });
    const remoteInfo = remotes.find((r: { remote: string }) => r.remote === remote);

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

      // デフォルトブランチが存在するか確認
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

    // 2. 未プッシュコミットを取得
    let commitsToPush: LocalCommit[];
    let remoteParentSha: string | null;

    if (isNewBranch) {
      // 新しいブランチの場合は全コミットをプッシュ
      const localLog = await git.log({ fs, dir, ref: targetBranch });
      commitsToPush = localLog.reverse() as LocalCommit[];
      remoteParentSha = null;
      console.log(`[git push] New branch: pushing all ${commitsToPush.length} commit(s)`);
    } else {
      try {
        const result = await getCommitsToPushOptimized(
          fs,
          dir,
          targetBranch,
          remoteHeadSha,
          githubAPI
        );
        commitsToPush = result.commits;
        remoteParentSha = result.remoteParentSha;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!force && errorMessage.includes('Updates were rejected')) {
          throw error;
        }

        // Force push: 共通祖先を探して、そこからプッシュ
        if (force && remoteHeadSha) {
          const localLog = await git.log({ fs, dir, ref: targetBranch });
          const ancestor = await findCommonAncestorOptimized(
            fs,
            dir,
            targetBranch,
            remoteHeadSha,
            githubAPI
          );

          if (ancestor) {
            // 共通祖先が見つかった
            const ancestorIndex = localLog.findIndex(
              (c: { commit: { tree: string } }) => c.commit.tree === ancestor.localAncestorTreeSha
            );

            if (ancestorIndex !== -1) {
              commitsToPush = localLog.slice(0, ancestorIndex).reverse() as LocalCommit[];
              remoteParentSha = ancestor.remoteAncestorSha;
              console.log(
                `[git push] Force push from common ancestor: ${commitsToPush.length} commit(s)`
              );
            } else {
              commitsToPush = localLog.reverse() as LocalCommit[];
              remoteParentSha = null;
            }
          } else {
            // 共通祖先がない = 全コミットをプッシュ
            commitsToPush = localLog.reverse() as LocalCommit[];
            remoteParentSha = null;
            console.log('[git push] Force push: no common ancestor, pushing all commits');
          }
        } else {
          throw error;
        }
      }
    }

    if (commitsToPush.length === 0) {
      // Force pushの場合、コミットがなくてもリモートを巻き戻す必要があるかチェック
      if (force && remoteHeadSha) {
        const localHead = await git.resolveRef({ fs, dir, ref: targetBranch });

        if (localHead !== remoteHeadSha) {
          console.log(
            `[git push] Force push: rewinding remote from ${remoteHeadSha.slice(0, 7)} to ${localHead.slice(0, 7)}`
          );

          await githubAPI.updateRef(targetBranch, localHead, true);

          // リモート追跡ブランチを更新
          await updateRemoteTrackingBranch(fs, dir, remote, targetBranch, localHead);

          if (ui) await ui.spinner.stop();

          return `To ${remoteInfo.url}\n + ${remoteHeadSha.slice(0, 7)}...${localHead.slice(0, 7)} ${targetBranch} -> ${targetBranch} (forced update)\n`;
        }
      }

      if (ui) await ui.spinner.stop();
      return 'Everything up-to-date';
    }

    console.log(`[git push] Pushing ${commitsToPush.length} commit(s)...`);

    // 3. ツリーを構築してコミットを作成
    const treeBuilder = new TreeBuilder(fs, dir, githubAPI);
    let parentSha = remoteParentSha;
    let lastCommitSha: string | null = remoteParentSha;
    let remoteTreeSha: string | undefined;

    // 親コミットのツリーSHAを取得（差分アップロード用）
    if (remoteParentSha) {
      try {
        remoteTreeSha = await githubAPI.getCommitTree(remoteParentSha);
      } catch (error) {
        console.warn('[git push] Failed to get parent tree:', error);
      }
    }

    for (const commit of commitsToPush) {
      console.log(
        `[git push] Processing: ${commit.oid.slice(0, 7)} - ${commit.commit.message.split('\n')[0]}`
      );

      // ツリーを構築
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

      parentSha = commitData.sha;
      lastCommitSha = commitData.sha;
      remoteTreeSha = treeSha;
    }

    if (!lastCommitSha) {
      throw new Error('Failed to create commits');
    }

    // 4. ブランチrefを更新
    console.log('[git push] Updating branch reference...');

    if (isNewBranch) {
      await githubAPI.createRef(targetBranch, lastCommitSha);
      console.log(`[git push] Created new branch '${targetBranch}'`);
    } else {
      await githubAPI.updateRef(targetBranch, lastCommitSha, force);
    }

    // リモート追跡ブランチを更新
    await updateRemoteTrackingBranch(fs, dir, remote, targetBranch, lastCommitSha);

    if (ui) await ui.spinner.stop();

    let result = `To ${remoteInfo.url}\n`;
    if (isNewBranch) {
      result += ` * [new branch]      ${targetBranch} -> ${targetBranch}\n`;
    } else {
      result += `   ${remoteHeadSha?.slice(0, 7) || '0000000'}..${lastCommitSha.slice(0, 7)}  ${targetBranch} -> ${targetBranch}\n`;
    }

    return result;
  } catch (error) {
    console.error('[git push] Error:', error);
    if (ui) await ui.spinner.stop();
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Push failed: ${errorMessage}`);
  }
}

/**
 * リモート追跡ブランチを更新するヘルパー関数
 */
async function updateRemoteTrackingBranch(
  fs: FS,
  dir: string,
  remote: string,
  branch: string,
  sha: string
): Promise<void> {
  try {
    await git.writeRef({
      fs,
      dir,
      ref: `refs/remotes/${remote}/${branch}`,
      value: sha,
      force: true,
    });
    console.log(`[git push] Updated tracking branch: ${remote}/${branch} -> ${sha.slice(0, 7)}`);
  } catch (error) {
    console.warn('[git push] Failed to update remote tracking branch:', error);
  }
}

export async function addRemote(fs: FS, dir: string, remote: string, url: string): Promise<string> {
  await git.addRemote({ fs, dir, remote, url });
  return `Remote '${remote}' added: ${url}`;
}

export async function listRemotes(fs: FS, dir: string): Promise<string> {
  const remotes = await git.listRemotes({ fs, dir });
  if (remotes.length === 0) return 'No remotes configured.';
  return remotes.map((r: { remote: string; url: string }) => `${r.remote}\t${r.url}`).join('\n');
}

export async function deleteRemote(fs: FS, dir: string, remote: string): Promise<string> {
  await git.deleteRemote({ fs, dir, remote });
  return `Remote '${remote}' deleted.`;
}
