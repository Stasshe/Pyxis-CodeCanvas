// src/engine/cmd/global/gitOperations/branch.ts
import git from 'isomorphic-git';
import { listAllRemoteRefs } from './remoteUtils';

export async function branch(
  fs: any,
  dir: string,
  branchName?: string,
  options: { delete?: boolean; remote?: boolean; all?: boolean } = {}
): Promise<string> {
  try {
    // Gitリポジトリが初期化されているかチェック
    try {
      await fs.promises.stat(`${dir}/.git`);
    } catch {
      throw new Error('not a git repository (or any of the parent directories): .git');
    }

    const { delete: deleteFlag = false, remote = false, all = false } = options;

    if (!branchName) {
      const currentBranch = await git.currentBranch({ fs, dir });
      let result = '';

      if (remote || all) {
        const remoteBranches = await listAllRemoteRefs(fs, dir);

        if (all && !remote) {
          const localBranches = await git.listBranches({ fs, dir });
          for (let i = 0; i < localBranches.length; i++) {
            const b = localBranches[i];
            result +=
              (b === currentBranch ? `* ${b}` : `  ${b}`) +
              (i === localBranches.length - 1 ? '' : '\n');
          }
          if (localBranches.length > 0 && remoteBranches.length > 0) {
            result += '\n';
          }
        }

        if (remoteBranches.length > 0) {
          for (let i = 0; i < remoteBranches.length; i++) {
            result += `  ${remoteBranches[i]}` + (i === remoteBranches.length - 1 ? '' : '\n');
          }
        } else if (!all) {
          return 'No remote branches found. Use "git fetch" first.';
        }
      } else {
        const branches = await git.listBranches({ fs, dir });
        for (let i = 0; i < branches.length; i++) {
          const b = branches[i];
          result +=
            (b === currentBranch ? `* ${b}` : `  ${b}`) + (i === branches.length - 1 ? '' : '\n');
        }
      }

      return result || 'No branches found.';
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
