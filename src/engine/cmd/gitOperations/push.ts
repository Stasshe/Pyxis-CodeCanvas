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

    console.log('[git push] Repository:', `${repoInfo.owner}/${repoInfo.repo}`);
    console.log('[git push] Target branch:', targetBranch);

    const githubAPI = new GitHubAPI(token, repoInfo.owner, repoInfo.repo);

    console.log('[git push] Analyzing commits...');
    const localCommits = await git.log({ fs, dir, depth: 1, ref: targetBranch });
    const localCommit = localCommits[0];
    
    if (!localCommit) {
      throw new Error('No commits found');
    }

    console.log('[git push] Local commit:', localCommit.oid.slice(0, 7));

    console.log('[git push] Checking remote state...');
    const remoteRef = await githubAPI.getRef(targetBranch);
    const remoteCommitSha = remoteRef?.object.sha;

    // リモートツリーSHAを取得（差分アップロードのため - vscode.dev方式）
    let remoteTreeSha: string | undefined;
    let remoteCommit;
    if (remoteCommitSha) {
      try {
        console.log('[git push] Fetching remote tree (for differential upload)...');
        remoteCommit = await githubAPI.getCommit(remoteCommitSha);
        remoteTreeSha = remoteCommit.tree.sha;
        console.log('[git push] Remote tree:', remoteTreeSha.slice(0, 7));
      } catch (error) {
        console.warn('[git push] Failed to get remote tree, will upload all files:', error);
      }
    }

    // ローカルとリモートのツリーを比較
    const localCommitObj = await git.readCommit({ fs, dir, oid: localCommit.oid });
    const localTreeSha = localCommitObj.commit.tree;
    
    // コミット履歴もチェック（fast-forward可能か）
    if (remoteCommitSha) {
      // リモートコミットがローカルの履歴に含まれているかチェック
      try {
        const localLog = await git.log({ fs, dir, depth: 100, ref: targetBranch });
        const isAncestor = localLog.some(c => c.oid === remoteCommitSha);
        
        if (!isAncestor && !force) {
          throw new Error(
            `Updates were rejected because the remote contains work that you do not have locally.\n` +
            `This is usually caused by another repository pushing to the same ref.\n` +
            `You may want to first integrate the remote changes (e.g., 'git pull ...') before pushing again.`
          );
        }
      } catch (error) {
        if ((error as Error).message.includes('Updates were rejected')) {
          throw error;
        }
        console.warn('[git push] Could not verify ancestry:', error);
      }
    }
    
    if (remoteTreeSha && localTreeSha === remoteTreeSha) {
      // ツリーが同じ = 内容に変更なし
      console.log('[git push] No changes detected (tree match)');
      return 'Everything up-to-date';
    }

    const startTime = Date.now();
    console.log(
      remoteTreeSha 
        ? '[git push] Uploading changes (differential)...' 
        : '[git push] Uploading all files (initial push)...'
    );
    
    const treeBuilder = new TreeBuilder(fs, dir, githubAPI);
    const treeSha = await treeBuilder.buildTree(localCommit.oid, remoteTreeSha);
    
    const uploadTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[git push] Tree built in ${uploadTime}s`);
    
    // ツリーが同じ場合は変更なし（ツリー構築後の最終チェック）
    if (remoteTreeSha && treeSha === remoteTreeSha) {
      console.log('[git push] No changes detected after tree build');
      return 'Everything up-to-date';
    }
    
    console.log('[git push] Creating commit on remote...');
    // 注意: ローカルのコミットIDは使用せず、リモートに新しいコミットを作成
    // これにより、リモートとローカルで異なるコミットIDになる（git pushの正常な動作）
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

    // ローカルのリモート追跡ブランチも更新（refs/remotes/origin/branch）
    try {
      await git.writeRef({
        fs,
        dir,
        ref: `refs/remotes/${remote}/${targetBranch}`,
        value: commitData.sha,
        force: true,
      });
      console.log('[git push] Updated remote tracking branch');
    } catch (error) {
      console.warn('[git push] Failed to update remote tracking branch:', error);
      // エラーでも続行（重要な操作ではない）
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[git push] Push completed in ${totalTime}s`);
    
    // 本物のgitコマンドと同じフォーマット
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
