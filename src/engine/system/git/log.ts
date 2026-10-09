import git from 'isomorphic-git';
import type { GitFs as FS } from '@/engine/core/fs/git';

import { GitFileSystemHelper } from './fileSystemHelper';
import { listAllRemoteRefs } from './remoteRefs';

export type BranchFilterMode = 'auto' | 'all';

export interface BranchFilterOptions {
  mode: BranchFilterMode;
  branches?: string[];
}

export class GitLogOperations {
  private fs: FS;
  private dir: string;

  constructor(fs: FS, dir: string) {
    this.fs = fs;
    this.dir = dir;
  }

  private async ensureProjectDirectory(): Promise<void> {
    await GitFileSystemHelper.ensureDirectory(this.fs, this.dir);
  }

  async log(depth = 10): Promise<string> {
    try {
      await this.ensureProjectDirectory();
      const commits = await git.log({ fs: this.fs, dir: this.dir, depth });

      if (commits.length === 0) {
        return 'No commits yet';
      }

      return commits
        .map(commit => {
          const date = new Date(commit.commit.author.timestamp * 1000);
          return (
            `commit ${commit.oid}\n` +
            `Author: ${commit.commit.author.name} <${commit.commit.author.email}>\n` +
            `Date: ${date.toISOString()}\n\n` +
            `    ${commit.commit.message}\n`
          );
        })
        .join('\n');
    } catch (error) {
      if (error instanceof git.Errors.NotFoundError && error.data.what.startsWith('refs/heads/')) {
        return 'No commits yet';
      }
      throw new Error(`git log failed: ${(error as Error).message}`);
    }
  }

  async getFormattedLog(
    depth = 20,
    branchFilter: BranchFilterOptions = { mode: 'auto' }
  ): Promise<string> {
    try {
      await this.ensureProjectDirectory();

      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      const [localBranches, remoteBranches] = await Promise.all([
        git.listBranches({ fs: this.fs, dir: this.dir }),
        listAllRemoteRefs(this.fs, this.dir),
      ]);

      const qualifiedRef = (branch: string): string => {
        if (branch.startsWith('refs/')) return branch;
        if (localBranches.includes(branch)) return `refs/heads/${branch}`;
        return `refs/remotes/${branch}`;
      };

      const refsByCommit = new Map<string, string[]>();

      const references = [
        ...localBranches.map(branch => ({ branch, ref: `refs/heads/${branch}` })),
        ...remoteBranches.map(branch => ({ branch, ref: `refs/remotes/${branch}` })),
      ];
      const resolvePromises = references.map(async ({ branch, ref }) => {
        const oid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref });
        return { branch, oid };
      });

      const resolvedRefs = await Promise.all(resolvePromises);

      for (const result of resolvedRefs) {
        if (result) {
          const existing = refsByCommit.get(result.oid) || [];
          if (!existing.includes(result.branch)) {
            existing.push(result.branch);
            refsByCommit.set(result.oid, existing);
          }
        }
      }

      let allCommits: Awaited<ReturnType<typeof git.log>> = [];

      if (branchFilter.mode === 'auto') {
        allCommits = await git.log({
          fs: this.fs,
          dir: this.dir,
          depth: depth,
        });
      } else if (branchFilter.mode === 'all') {
        let targetReferences = references.map(({ ref }) => ref);
        if (branchFilter.branches && branchFilter.branches.length > 0) {
          targetReferences = branchFilter.branches.map(qualifiedRef);
        }

        const commitMap = new Map<string, Awaited<ReturnType<typeof git.log>>[number]>();

        const logPromises = targetReferences.map(ref =>
          git.log({
            fs: this.fs,
            dir: this.dir,
            ref,
            depth,
          })
        );

        const branchCommits = await Promise.all(logPromises);

        for (const commits of branchCommits) {
          for (const commit of commits) {
            if (!commitMap.has(commit.oid)) {
              commitMap.set(commit.oid, commit);
            }
          }
        }

        allCommits = Array.from(commitMap.values()).sort(
          (a, b) => b.commit.author.timestamp - a.commit.author.timestamp
        );

        if (allCommits.length > depth) {
          allCommits = allCommits.slice(0, depth);
        }
      }

      if (allCommits.length === 0) {
        return '';
      }

      const formattedCommits = allCommits.map(commit => {
        const date = new Date(commit.commit.author.timestamp * 1000);
        const safeMessage = (commit.commit.message || 'No message')
          .replace(/\|/g, '｜')
          .replace(/\n/g, ' ');
        const safeName = (commit.commit.author.name || 'Unknown').replace(/\|/g, '｜');
        const safeDate = date.toISOString();
        const parentHashes = commit.commit.parent.join(',');
        const refs = (refsByCommit.get(commit.oid) || []).join(',');
        const treeSha = commit.commit.tree || '';
        return `${commit.oid}|${safeMessage}|${safeName}|${safeDate}|${parentHashes}|${refs}|${treeSha}`;
      });

      return formattedCommits.join('\n');
    } catch (error) {
      if (
        (error instanceof git.Errors.NotFoundError && error.data.what.startsWith('refs/heads/')) ||
        (error instanceof Error && error.message.includes('not a git repository'))
      ) {
        return '';
      }
      throw new Error(`git log failed: ${(error as Error).message}`);
    }
  }

  async getAvailableBranches(): Promise<{ local: string[]; remote: string[] }> {
    await this.ensureProjectDirectory();
    const [local, remote] = await Promise.all([
      git.listBranches({ fs: this.fs, dir: this.dir }),
      listAllRemoteRefs(this.fs, this.dir),
    ]);
    return { local, remote };
  }
}
