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
 * Tree-based comparison: コミットSHAではなく、ツリーSHAで比較
 */
async function getCommitsToPush(
  fs: FS,
  dir: string,
  branch: string,
  remoteHeadSha: string | null,
  githubAPI: GitHubAPI
): Promise<any[]> {
  const localLog = await git.log({ fs, dir, ref: branch });

  if (!remoteHeadSha) {
    // リモートが空の場合は全コミットを返す
    return localLog.reverse();
  }

  // リモートHEADのツリーSHAを取得
  let remoteHeadTreeSha: string;
  try {
    remoteHeadTreeSha = await githubAPI.getCommitTree(remoteHeadSha);
  } catch (error) {
    console.warn('[git push] Failed to get remote HEAD tree, assuming diverged:', error);
    throw new Error(
      `Updates were rejected because the remote contains work that you do not have locally.\\n` +
        `This is usually caused by another repository pushing to the same ref.\\n` +
        `You may want to first integrate the remote changes (e.g., 'git pull ...') before pushing again.`
    );
  }

  // ローカルコミット列でリモートHEADと同じツリーを持つコミットを探す
  let remoteTreeIndex = -1;
  for (let i = 0; i < localLog.length; i++) {
    const localCommit = localLog[i];
    if (localCommit.commit.tree === remoteHeadTreeSha) {
      // 同じツリーSHAを持つコミットが見つかった = 同じ内容
      remoteTreeIndex = i;
      console.log(
        `[git push] Remote tree ${remoteHeadTreeSha.slice(0, 7)} found in local history at commit ${localCommit.oid.slice(0, 7)}`
      );
      break;
    }
  }

  if (remoteTreeIndex === -1) {
    // リモートのツリーがローカル履歴にない = non-fast-forward
    // Note: これはリモートに全く異なる変更があることを意味する
    throw new Error(
      `Updates were rejected because the remote contains work that you do not have locally.\\n` +
        `This is usually caused by another repository pushing to the same ref.\\n` +
        `You may want to first integrate the remote changes (e.g., 'git pull ...') before pushing again.`
    );
  }

  if (remoteTreeIndex === 0) {
    // 最新コミットのツリーがリモートと同じ = up-to-date
    console.log('[git push] Local and remote trees are identical, up-to-date');
    return [];
  }

  // リモートツリー以降のコミットを古い順に返す
  const commitsToPush = localLog.slice(0, remoteTreeIndex);
  console.log(`[git push] Found ${commitsToPush.length} commit(s) to push`);
  return commitsToPush.reverse();
}

/**
 * ローカルとリモートの共通の祖先を探す（tree SHAベース）
 * force push時に使用して、できるだけ既存のコミットを再利用する
 */
async function findCommonAncestor(
  fs: FS,
  dir: string,
  branch: string,
  remoteHeadSha: string,
  githubAPI: GitHubAPI
): Promise<{ sha: string; treeSha: string } | null> {
  try {
    // リモートのコミット履歴を遡って取得（最大100件）
    const remoteCommits: Array<{ sha: string; treeSha: string }> = [];
    let currentSha: string | null = remoteHeadSha;
    
    for (let i = 0; i < 100 && currentSha; i++) {
      try {
        const commit = await githubAPI.getCommit(currentSha);
        remoteCommits.push({
          sha: currentSha,
          treeSha: commit.tree.sha,
        });
        
        // 親コミットに遡る
        if (commit.parents.length > 0) {
          currentSha = commit.parents[0].sha;
        } else {
          currentSha = null; // initial commit
        }
      } catch (error) {
        console.warn(`[git push] Failed to get remote commit ${currentSha}:`, error);
        break;
      }
    }
    
    console.log(`[git push] Fetched ${remoteCommits.length} remote commit(s) for ancestor search`);
    
    // ローカルの履歴を取得
    const localLog = await git.log({ fs, dir, ref: branch });
    
    // ローカルの各コミットのtree SHAとリモートのtree SHAを比較
    for (const localCommit of localLog) {
      const localTreeSha = localCommit.commit.tree;
      
      // リモートコミットで同じtree SHAを持つものを探す
      const matchingRemote = remoteCommits.find(rc => rc.treeSha === localTreeSha);
      
      if (matchingRemote) {
        console.log(
          `[git push] Found common ancestor: remote ${matchingRemote.sha.slice(0, 7)} ` +
          `<-> local ${localCommit.oid.slice(0, 7)} (tree: ${localTreeSha.slice(0, 7)})`
        );
        return matchingRemote;
      }
    }
    
    console.log('[git push] No common ancestor found');
    return null;
  } catch (error) {
    console.warn('[git push] findCommonAncestor failed:', error);
    return null;
  }
}

export async function push(
  fs: FS, 
  dir: string, 
  options: PushOptions = {},
  progressCallback?: (message: string) => Promise<void>
): Promise<string> {
  const { remote = 'origin', branch, force = false } = options;
  
  // Helper to emit progress
  const emitProgress = async (message: string): Promise<void> => {
    if (progressCallback) {
      await progressCallback(message);
    }
  };

  try {
    await emitProgress('Enumerating objects...');
    
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
    await emitProgress('Counting objects...');
    const remoteRef = await githubAPI.getRef(targetBranch);

    let remoteHeadSha: string | null = null;
    let isNewBranch = false;

    if (!remoteRef) {
      // リモートにブランチが存在しない場合
      console.log(
        `[git push] Remote branch '${targetBranch}' does not exist. Creating new branch...`
      );
      await emitProgress(`Creating new branch '${targetBranch}'...`);
      isNewBranch = true;

      // デフォルトブランチ(main/master)が存在するか確認
      const defaultBranch = await githubAPI.getRef('main').catch(() => githubAPI.getRef('master'));

      if (!defaultBranch) {
        throw new Error(
          'Push failed: Remote repository is empty.\\n\\n' +
            'Empty repositories are not supported. Please:\\n' +
            '1. Initialize the repository with a README on GitHub, or\\n' +
            '2. Push from another Git client first, or\\n' +
            '3. Create an initial commit on GitHub web interface'
        );
      }
    } else {
      remoteHeadSha = remoteRef.object.sha;
      console.log('[git push] Remote HEAD:', remoteHeadSha.slice(0, 7));
    }

    // 2. 未pushコミット列を取得（古い順）
    let commitsToPush: any[];
    let commonAncestorSha: string | null = null;

    if (isNewBranch) {
      // 新しいブランチの場合は全コミットをpush
      const localLog = await git.log({ fs, dir, ref: targetBranch });
      commitsToPush = localLog.reverse();
      console.log(`[git push] New branch: pushing all ${commitsToPush.length} commit(s)`);
    } else {
      try {
        commitsToPush = await getCommitsToPush(fs, dir, targetBranch, remoteHeadSha, githubAPI);
      } catch (error: any) {
        if (!force && error.message.includes('Updates were rejected')) {
          throw error;
        }
        // forceの場合: 共通の祖先を探して、そこから続きをpush
        if (force) {
          const localLog = await git.log({ fs, dir, ref: targetBranch });
          
          // リモートとの共通祖先を探す
          const commonAncestor = await findCommonAncestor(
            fs,
            dir,
            targetBranch,
            remoteHeadSha!,
            githubAPI
          );
          
          if (commonAncestor) {
            // 共通祖先が見つかった場合、そのtree SHAを持つローカルコミット以降をpush
            const ancestorIndex = localLog.findIndex(
              c => c.commit.tree === commonAncestor.treeSha
            );
            
            if (ancestorIndex !== -1) {
              commitsToPush = localLog.slice(0, ancestorIndex).reverse();
              commonAncestorSha = commonAncestor.sha;
              console.log(
                `[git push] Force push from common ancestor: ${commitsToPush.length} commit(s) to push`
              );
            } else {
              // 見つからない場合は全コミットをpush
              commitsToPush = localLog.reverse();
              console.log(`[git push] Force push: ancestor not found locally, pushing all ${commitsToPush.length} commit(s)`);
            }
          } else {
            // 共通祖先が見つからない場合は全コミットをpush
            commitsToPush = localLog.reverse();
            console.log(`[git push] Force push: no common ancestor, pushing all ${commitsToPush.length} commit(s)`);
          }
        } else {
          throw error;
        }
      }
    }

    if (commitsToPush.length === 0) {
      // Force pushの場合、コミットがなくてもリモートを巻き戻す必要があるかチェック
      if (force && remoteHeadSha) {
        // ローカルのHEADコミットを取得
        const localHead = await git.resolveRef({ fs, dir, ref: targetBranch });
        
        // リモートHEADと違う場合は、リモートを巻き戻す
        if (localHead !== remoteHeadSha) {
          console.log(
            `[git push] Force push: rewinding remote from ${remoteHeadSha.slice(0, 7)} to ${localHead.slice(0, 7)}`
          );
          await emitProgress(`Force pushing: rewinding remote...`);
          
          // リモートrefを更新
          await githubAPI.updateRef(targetBranch, localHead, true);
          
          // リモート追跡ブランチを更新
          try {
            await git.writeRef({
              fs,
              dir,
              ref: `refs/remotes/${remote}/${targetBranch}`,
              value: localHead,
              force: true,
            });
          } catch (error) {
            console.warn('[git push] Failed to update remote tracking branch:', error);
          }
          
          const remoteUrl = remoteInfo.url;
          return `To ${remoteUrl}\\n + ${remoteHeadSha.slice(0, 7)}...${localHead.slice(0, 7)} ${targetBranch} -> ${targetBranch} (forced update)\\n`;
        }
      }
      
      return 'Everything up-to-date';
    }

    await emitProgress(`Counting objects: ${commitsToPush.length}, done.`);
    console.log(`[git push] Pushing ${commitsToPush.length} commit(s)...`);

    // リモートツリーSHAを取得（差分アップロードのため）
    let remoteTreeSha: string | undefined;
    if (commonAncestorSha) {
      // Force pushで共通祖先が見つかった場合
      try {
        const ancestorCommit = await githubAPI.getCommit(commonAncestorSha);
        remoteTreeSha = ancestorCommit.tree.sha;
      } catch (error) {
        console.warn('[git push] Failed to get ancestor tree:', error);
      }
    } else if (remoteHeadSha) {
      try {
        const remoteCommit = await githubAPI.getCommit(remoteHeadSha);
        remoteTreeSha = remoteCommit.tree.sha;
      } catch (error) {
        console.warn('[git push] Failed to get remote tree:', error);
      }
    }

    // 3. 各コミットを順番にpush
    let parentSha: string | null = commonAncestorSha || remoteHeadSha;
    let lastCommitSha: string | null = commonAncestorSha || remoteHeadSha;
    const treeBuilder = new TreeBuilder(fs, dir, githubAPI);
    
    await emitProgress('Compressing objects...');

    for (let i = 0; i < commitsToPush.length; i++) {
      const commit = commitsToPush[i];
      const progress = Math.round(((i + 1) / commitsToPush.length) * 100);
      
      await emitProgress(`\rWriting objects: ${progress}% (${i + 1}/${commitsToPush.length})`);
      
      console.log(
        `[git push] Processing commit: ${commit.oid.slice(0, 7)} - ${commit.commit.message.split('\\n')[0]}`
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
    
    await emitProgress(`\rWriting objects: 100% (${commitsToPush.length}/${commitsToPush.length}), done.`);

    if (!lastCommitSha) {
      throw new Error('Failed to create commits');
    }

    // 4. ブランチrefを最新のコミットに更新
    console.log('[git push] Updating branch reference...');
    await emitProgress('\nUpdating branch reference...');

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
    let result = `To ${remoteUrl}\\n`;

    if (isNewBranch) {
      result += ` * [new branch]      ${targetBranch} -> ${targetBranch}\\n`;
    } else {
      result += `   ${remoteHeadSha?.slice(0, 7) || '0000000'}..${lastCommitSha.slice(0, 7)}  ${targetBranch} -> ${targetBranch}\\n`;
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
  return remotes.map(r => `${r.remote}\\t${r.url}`).join('\\n');
}

export async function deleteRemote(fs: FS, dir: string, remote: string): Promise<string> {
  await git.deleteRemote({ fs, dir, remote });
  return `Remote '${remote}' deleted.`;
}
