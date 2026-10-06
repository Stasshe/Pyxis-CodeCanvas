import git from 'isomorphic-git';
import type { GitFs as FS } from '@/engine/core/fs/git';
import type { GitHubUser } from '@/engine/user/authRepository';

export async function commit(
  fs: FS,
  dir: string,
  message: string,
  author = { name: 'User', email: 'user@pyxis.dev' }
): Promise<string> {
  try {
    try {
      await fs.promises.stat(`${dir}/.git`);
    } catch {
      throw new Error('not a git repository (or any of the parent directories): .git');
    }

    let commitAuthor = author;
    try {
      const token = (await fs.credentials())?.password;
      if (token) {
        const response = await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github.v3+json',
          },
        });

        if (response.ok) {
          const userData: GitHubUser = await response.json();
          commitAuthor = {
            name: userData.name || userData.login,
            email: userData.email || `${userData.login}@users.noreply.github.com`,
          };
          console.log('[git commit] Using GitHub user:', commitAuthor);
        }
      }
    } catch (error) {
      console.warn('[git commit] Failed to get GitHub user info, using default:', error);
    }

    const sha = await git.commit({
      fs,
      dir,
      message,
      author: commitAuthor,
      committer: commitAuthor,
    });

    return `[main ${sha.slice(0, 7)}] ${message}`;
  } catch (error) {
    throw new Error(`git commit failed: ${(error as Error).message}`);
  }
}
