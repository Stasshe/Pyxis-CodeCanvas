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

    const localCommits = await git.log({ fs, dir, depth: 1, ref: targetBranch });
    const localCommit = localCommits[0];
    
    if (!localCommit) {
      throw new Error('No commits found');
    }

    console.log('[git push] Local commit:', localCommit.oid);

    const remoteRef = await githubAPI.getRef(targetBranch);
    const remoteCommitSha = remoteRef?.object.sha;

    if (remoteCommitSha && localCommit.oid === remoteCommitSha) {
      return 'Everything up-to-date';
    }

    console.log('[git push] Building tree...');
    const treeBuilder = new TreeBuilder(fs, dir, githubAPI);
    const treeSha = await treeBuilder.buildTree(localCommit.oid);
    
    console.log('[git push] Creating commit...');
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

    console.log('[git push] Updating ref...');
    await githubAPI.updateRef(targetBranch, commitData.sha, force);

    return `Successfully pushed to ${remote}/${targetBranch}`;
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
