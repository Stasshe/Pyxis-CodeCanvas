import git from 'isomorphic-git';
import type { GitFs as FS } from '@/engine/core/fs/git';
import { GitHubAPI } from './github/GitHubAPI';
import { TreeBuilder } from './github/TreeBuilder';
import { parseGitHubUrl } from './github/utils';

export interface PushOptions {
  remote?: string;
  branch?: string;
  force?: boolean;
}

const MAX_COMMIT_HISTORY_DEPTH = 100;

interface LocalCommit {
  oid: string;
  commit: {
    tree: string;
    message: string;
    author: { name: string; email: string; timestamp: number };
    committer: { name: string; email: string; timestamp: number };
  };
}

async function getCommitsToPushOptimized(
  fs: FS,
  dir: string,
  branch: string,
  remoteHeadSha: string | null,
  githubAPI: GitHubAPI
): Promise<{ commits: LocalCommit[]; remoteParentSha: string | null }> {
  const localLog = await git.log({ fs, dir, ref: branch, depth: MAX_COMMIT_HISTORY_DEPTH });

  if (!remoteHeadSha) {
    console.log('[git push] Remote is empty, pushing all commits');
    return {
      commits: localLog.reverse() as LocalCommit[],
      remoteParentSha: null,
    };
  }

  const remoteHeadIndex = localLog.findIndex((c: { oid: string }) => c.oid === remoteHeadSha);

  if (remoteHeadIndex !== -1) {
    if (remoteHeadIndex === 0) {
      console.log('[git push] Already up-to-date (same commit)');
      return { commits: [], remoteParentSha: remoteHeadSha };
    }

    const commitsToPush = localLog.slice(0, remoteHeadIndex);
    console.log(`[git push] Fast-forward: ${commitsToPush.length} commit(s) to push`);
    return {
      commits: commitsToPush.reverse() as LocalCommit[],
      remoteParentSha: remoteHeadSha,
    };
  }

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

  for (let i = 0; i < localLog.length; i++) {
    const localCommit = localLog[i];
    if (localCommit.commit.tree === remoteTreeSha) {
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

  throw new Error(
    'Updates were rejected because the remote contains work that you do not have locally.\n' +
      'This is usually caused by another repository pushing to the same ref.\n' +
      'You may want to first integrate the remote changes (e.g., "git pull ...") before pushing again.'
  );
}

async function findCommonAncestorOptimized(
  fs: FS,
  dir: string,
  branch: string,
  remoteHeadSha: string,
  githubAPI: GitHubAPI
): Promise<{ remoteAncestorSha: string; localAncestorTreeSha: string } | null> {
  try {
    const remoteCommits = await githubAPI.getCommitHistory(remoteHeadSha, MAX_COMMIT_HISTORY_DEPTH);

    if (remoteCommits.length === 0) {
      return null;
    }

    const remoteTreeMap = new Map<string, string>(); // treeSha -> commitSha
    for (const commit of remoteCommits) {
      remoteTreeMap.set(commit.commit.tree.sha, commit.sha);
    }

    const localLog = await git.log({ fs, dir, ref: branch, depth: MAX_COMMIT_HISTORY_DEPTH });

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
  progress?: (message: string) => void
): Promise<string> {
  const { remote = 'origin', branch, force = false } = options;

  try {
    progress?.('Enumerating objects...');

    const token = (await fs.credentials())?.password;
    if (!token) {
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

    const remoteRef = await githubAPI.getRef(targetBranch);

    let remoteHeadSha: string | null = null;
    let isNewBranch = false;

    if (!remoteRef) {
      console.log(
        `[git push] Remote branch '${targetBranch}' does not exist. Creating new branch...`
      );
      isNewBranch = true;

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

    let commitsToPush: LocalCommit[];
    let remoteParentSha: string | null;

    if (isNewBranch) {
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
        let errorMessage = String(error);
        if (error instanceof Error) errorMessage = error.message;
        if (!force && errorMessage.includes('Updates were rejected')) {
          throw error;
        }

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
      if (force && remoteHeadSha) {
        const localHead = await git.resolveRef({ fs, dir, ref: targetBranch });

        if (localHead !== remoteHeadSha) {
          console.log(
            `[git push] Force push: rewinding remote from ${remoteHeadSha.slice(0, 7)} to ${localHead.slice(0, 7)}`
          );

          await githubAPI.updateRef(targetBranch, localHead, true);

          await updateRemoteTrackingBranch(fs, dir, remote, targetBranch, localHead);

          return `To ${remoteInfo.url}\n + ${remoteHeadSha.slice(0, 7)}...${localHead.slice(0, 7)} ${targetBranch} -> ${targetBranch} (forced update)\n`;
        }
      }

      return 'Everything up-to-date';
    }

    console.log(`[git push] Pushing ${commitsToPush.length} commit(s)...`);

    const treeBuilder = new TreeBuilder(fs, dir, githubAPI);
    let parentSha = remoteParentSha;
    let lastCommitSha: string | null = remoteParentSha;
    let remoteTreeSha: string | undefined;

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

      const treeSha = await treeBuilder.buildTree(commit.oid, remoteTreeSha);

      const parents: string[] = [];
      if (parentSha) parents.push(parentSha);
      progress?.(`Uploading commit ${commit.oid.slice(0, 7)}`);
      const commitData = await githubAPI.createCommit({
        message: commit.commit.message,
        tree: treeSha,
        parents,
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

    console.log('[git push] Updating branch reference...');

    if (isNewBranch) {
      await githubAPI.createRef(targetBranch, lastCommitSha);
      console.log(`[git push] Created new branch '${targetBranch}'`);
    } else {
      await githubAPI.updateRef(targetBranch, lastCommitSha, force);
    }

    await updateRemoteTrackingBranch(fs, dir, remote, targetBranch, lastCommitSha);

    let result = `To ${remoteInfo.url}\n`;
    if (isNewBranch) {
      result += ` * [new branch]      ${targetBranch} -> ${targetBranch}\n`;
    } else {
      result += `   ${remoteHeadSha?.slice(0, 7) || '0000000'}..${lastCommitSha.slice(0, 7)}  ${targetBranch} -> ${targetBranch}\n`;
    }

    return result;
  } catch (error) {
    console.error('[git push] Error:', error);

    let errorMessage = String(error);
    if (error instanceof Error) errorMessage = error.message;
    throw new Error(`Push failed: ${errorMessage}`);
  }
}

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
