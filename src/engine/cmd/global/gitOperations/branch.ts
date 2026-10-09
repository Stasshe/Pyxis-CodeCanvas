import git from 'isomorphic-git';
import type { GitFs as FS } from '@/engine/core/fs/git';
import { listAllRemoteRefs } from './remoteUtils';

export async function branch(
  fs: FS,
  dir: string,
  branchName?: string,
  options: { delete?: boolean; remote?: boolean; all?: boolean } = {}
): Promise<string> {
  try {
    try {
      await fs.promises.stat(`${dir}/.git`);
    } catch {
      throw new Error('not a git repository (or any of the parent directories): .git');
    }

    const { delete: deleteFlag = false, remote = false, all = false } = options;

    if (!branchName) {
      const currentBranch = await git.currentBranch({ fs, dir });
      const lines: string[] = [];
      if (!remote || all) {
        const local = await git.listBranches({ fs, dir });
        for (const name of local) {
          let prefix = '  ';
          if (name === currentBranch) prefix = '* ';
          lines.push(prefix + name);
        }
      }
      if (remote || all) {
        const remotes = await listAllRemoteRefs(fs, dir);
        if (remotes.length === 0 && !all) {
          return 'No remote branches found. Use "git fetch" first.';
        }
        for (const name of remotes) lines.push(`  ${name}`);
      }
      return lines.join('\n') || 'No branches found.';
    }

    if (deleteFlag) {
      await git.deleteBranch({ fs, dir, ref: branchName });
      return `Deleted branch ${branchName}`;
    }

    await git.branch({ fs, dir, ref: branchName });
    return `Created branch ${branchName}`;
  } catch (error) {
    throw new Error(`git branch failed: ${(error as Error).message}`);
  }
}
