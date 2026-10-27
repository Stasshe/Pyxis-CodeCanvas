import git from 'isomorphic-git';
import type { GitFs as FS } from '@/engine/core/fs/git';
import type { GitHubUser } from '@/engine/core/metadata/github/authRepository';
import { clearMergeState, readMergeHead } from './mergeState';

export async function resolveCommitAuthor(
  fs: FS,
  author?: { name: string; email: string }
): Promise<{ name: string; email: string }> {
  if (author) return author;
  const token = (await fs.credentials())?.password;
  if (!token) return { name: 'User', email: 'user@pyxis.dev' };
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });
  if (!response.ok)
    throw new Error(`Cannot resolve GitHub commit author (HTTP ${response.status}).`);
  const userData: GitHubUser = await response.json();
  return {
    name: userData.name || userData.login,
    email: userData.email || `${userData.login}@users.noreply.github.com`,
  };
}

export async function commit(
  fs: FS,
  dir: string,
  message: string,
  author?: { name: string; email: string }
): Promise<string> {
  try {
    try {
      await fs.promises.stat(`${dir}/.git`);
    } catch {
      throw new Error('not a git repository (or any of the parent directories): .git');
    }

    const commitAuthor = await resolveCommitAuthor(fs, author);

    let mergeHead = await readMergeHead(fs, dir);
    if (mergeHead) {
      const head = await git.resolveRef({ fs, dir, ref: 'HEAD' });
      const headCommit = await git.readCommit({ fs, dir, oid: head });
      const alreadyCommittedMerge =
        headCommit.commit.parent.length === 2 && headCommit.commit.parent[1] === mergeHead;
      if (alreadyCommittedMerge) {
        const status = await git.statusMatrix({ fs, dir });
        const worktreeIsClean = status.every(([, headStatus, worktreeStatus, stageStatus]) =>
          [headStatus, worktreeStatus, stageStatus].every(value => value === headStatus)
        );
        await clearMergeState(fs, dir);
        mergeHead = null;
        if (worktreeIsClean) {
          const branch = await git.currentBranch({ fs, dir });
          return `[${branch || 'detached HEAD'} ${head.slice(0, 7)}] ${headCommit.commit.message.trimEnd()}`;
        }
      }
    }

    let parent: string[] | undefined;
    if (mergeHead) {
      parent = [await git.resolveRef({ fs, dir, ref: 'HEAD' }), mergeHead];
    }

    const sha = await git.commit({
      fs,
      dir,
      message,
      author: commitAuthor,
      committer: commitAuthor,
      parent,
    });

    if (mergeHead) {
      try {
        await clearMergeState(fs, dir);
      } catch (error) {
        const committedHead = await git.resolveRef({ fs, dir, ref: 'HEAD' });
        if (committedHead !== sha) throw error;
        throw new Error(
          `commit ${sha.slice(0, 7)} was created, but merge state cleanup failed: ${(error as Error).message}`
        );
      }
    }

    const branch = await git.currentBranch({ fs, dir });
    return `[${branch || 'detached HEAD'} ${sha.slice(0, 7)}] ${message}`;
  } catch (error) {
    throw new Error(`git commit failed: ${(error as Error).message}`);
  }
}
