/**
 * git push 実装
 * GitHub Git Data API + GraphQL APIを使用して正式なコミットとしてプッシュ
 */

import git from 'isomorphic-git';
import FS from '@isomorphic-git/lightning-fs';
import { authRepository } from '@/engine/core/authRepository';
import { GitHubAPI } from './github/GitHubAPI';
import { TreeBuilder } from './github/TreeBuilder';
import { parseGitHubUrl } from './github/utils';

export interface PushOptions {
  remote?: string;
  branch?: string;
  force?: boolean;
}

export async function push(
  fs: FS,
  dir: string,
  options: PushOptions = {}
): Promise<string> {
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
    const localCommits = await git.log({ fs, dir, depth: 1, ref: targetBranch });
    const localCommit = localCommits[0];
    
    if (!localCommit) {
      throw new Error('No commits found');
    }

    const remoteRef = await githubAPI.getRef(targetBranch);
    
    if (!remoteRef) {
      throw new Error(
        'Push failed: Remote repository is empty.\n\n' +
        'Empty repositories are not supported. Please:\n' +
        '1. Initialize the repository with a README on GitHub, or\n' +
        '2. Push from another Git client first, or\n' +
        '3. Create an initial commit on GitHub web interface'
      );
    }
    
    const remoteCommitSha = remoteRef.object.sha;

    // リモートツリーSHAを取得（差分アップロードのため）
    let remoteTreeSha: string | undefined;
    let remoteCommit;
    try {
      remoteCommit = await githubAPI.getCommit(remoteCommitSha);
      remoteTreeSha = remoteCommit.tree.sha;
    } catch (error) {
      console.warn('[git push] Failed to get remote tree:', error);
    }

    // ローカルとリモートのツリーを比較
    const localCommitObj = await git.readCommit({ fs, dir, oid: localCommit.oid });
    const localTreeSha = localCommitObj.commit.tree;
    
    // コミット履歴もチェック（fast-forward可能か）
    if (remoteCommitSha && !force) {
      try {
        // まず、ローカルのコミットがリモートに存在するかチェック
        try {
          const remoteCommit = await githubAPI.getCommit(localCommit.oid);
          // ローカルのコミットがリモートに存在し、ツリーも同じ場合
          if (remoteCommit.tree.sha === localTreeSha) {
            return 'Everything up-to-date';
          }
        } catch {
          // ローカルのコミットがリモートに存在しない = 新しいコミット
        }
        
        // fast-forwardチェック: リモートコミットがローカルの履歴に含まれているか
        const localLog = await git.log({ fs, dir, depth: 100, ref: targetBranch });
        const isAncestor = localLog.some(c => c.oid === remoteCommitSha);
        
        if (!isAncestor) {
          // リモートがローカルの履歴にない = 競合の可能性
          // ただし、リモート追跡ブランチが最新の場合は許可
          try {
            const trackedRemoteCommit = await git.resolveRef({
              fs,
              dir,
              ref: `refs/remotes/${remote}/${targetBranch}`,
            });
            
            // リモート追跡ブランチがローカルの履歴に含まれているかチェック
            const trackedIsAncestor = localLog.some(c => c.oid === trackedRemoteCommit);
            
            if (!trackedIsAncestor && trackedRemoteCommit !== remoteCommitSha) {
              throw new Error(
                `Updates were rejected because the remote contains work that you do not have locally.\n` +
                `This is usually caused by another repository pushing to the same ref.\n` +
                `You may want to first integrate the remote changes (e.g., 'git pull ...') before pushing again.`
              );
            }
          } catch (resolveError) {
            // リモート追跡ブランチが存在しない場合は、リモートとの比較のみ
            if (!(resolveError as Error).message.includes('Updates were rejected')) {
              console.warn('[git push] Remote tracking branch not found:', resolveError);
            } else {
              throw resolveError;
            }
          }
        }
      } catch (error) {
        if ((error as Error).message.includes('Updates were rejected')) {
          throw error;
        }
        console.warn('[git push] Could not verify ancestry:', error);
      }
    }
    
    if (remoteTreeSha && localTreeSha === remoteTreeSha) {
      return 'Everything up-to-date';
    }

    const treeBuilder = new TreeBuilder(fs, dir, githubAPI);
    const treeSha = await treeBuilder.buildTree(localCommit.oid, remoteTreeSha);
    
    if (remoteTreeSha && treeSha === remoteTreeSha) {
      return 'Everything up-to-date';
    }

    const commitData = await githubAPI.createCommit({
      message: localCommit.commit.message,
      tree: treeSha,
      parents: remoteCommitSha ? [remoteCommitSha] : [],
      author: {
        name: localCommit.commit.author.name,
        email: localCommit.commit.author.email,
        date: new Date(localCommit.commit.author.timestamp * 1000).toISOString(),
      },
      committer: {
        name: localCommit.commit.committer.name,
        email: localCommit.commit.committer.email,
        date: new Date(localCommit.commit.committer.timestamp * 1000).toISOString(),
      },
    });
    
    console.log('[git push] Remote commit created:', commitData.sha.slice(0, 7));

    console.log('[git push] Updating branch reference...');
    await githubAPI.updateRef(targetBranch, commitData.sha, force);

    // ローカルのブランチもリモートのコミットIDに更新
    try {
      await git.writeRef({
        fs,
        dir,
        ref: `refs/heads/${targetBranch}`,
        value: commitData.sha,
        force: true,
      });
      console.log('[git push] Updated local branch to remote commit:', commitData.sha.slice(0, 7));
    } catch (error) {
      console.warn('[git push] Failed to update local branch:', error);
    }

    // ローカルのリモート追跡ブランチも更新（refs/remotes/origin/branch）
    try {
      await git.writeRef({
        fs,
        dir,
        ref: `refs/remotes/${remote}/${targetBranch}`,
        value: commitData.sha,
        force: true,
      });
    } catch (error) {
      console.warn('[git push] Failed to update remote tracking branch:', error);
    }

    const remoteUrl = remoteInfo.url;
    let result = `To ${remoteUrl}\n`;
    
    if (remoteCommitSha) {
      result += `   ${remoteCommitSha.slice(0, 7)}..${commitData.sha.slice(0, 7)}  ${targetBranch} -> ${targetBranch}\n`;
    } else {
      result += ` * [new branch]      ${targetBranch} -> ${targetBranch}\n`;
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
