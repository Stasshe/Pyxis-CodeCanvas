import type FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';

import { GitFileSystemHelper } from './fileSystemHelper';
import { listAllRemoteRefs, toFullRemoteRef } from './remoteUtils';

/**
 * ブランチフィルタモード
 * - auto: HEADからのコミットのみ（現行の動作）
 * - all: 全ブランチからのコミットを表示
 * - branches: 指定したブランチのみ
 */
export type BranchFilterMode = 'auto' | 'all';

export interface BranchFilterOptions {
  mode: BranchFilterMode;
  branches?: string[]; // mode === 'branches' 時に使用する特定のブランチ名リスト
}

/**
 * Git log操作を管理するクラス
 * リモートブランチはremoteUtilsを使用して標準化された処理を行う
 */
export class GitLogOperations {
  private fs: FS;
  private dir: string;

  constructor(fs: FS, dir: string) {
    this.fs = fs;
    this.dir = dir;
  }

  // プロジェクトディレクトリの存在を確認し、なければ作成
  private async ensureProjectDirectory(): Promise<void> {
    await GitFileSystemHelper.ensureDirectory(this.dir);
  }

  // git log - ログ表示
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
      throw new Error(`git log failed: ${(error as Error).message}`);
    }
  }

  // UI用のGitログを取得（パイプ区切り形式、ブランチ情報付き）
  // VSCode風: 選択したブランチのコミットを統合して表示
  async getFormattedLog(
    depth = 20,
    branchFilter: BranchFilterOptions = { mode: 'auto' }
  ): Promise<string> {
    try {
      await this.ensureProjectDirectory();

      // Gitリポジトリが初期化されているかチェック
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      // 1. ブランチ情報を並列で取得（ローカル + リモート）
      const [localBranches, remoteBranches] = await Promise.all([
        git.listBranches({ fs: this.fs, dir: this.dir }),
        listAllRemoteRefs(this.fs, this.dir),
      ]);

      // origin/HEAD, upstream/HEADなどのシンボリックリファレンスを除外
      const allBranches = [...localBranches, ...remoteBranches].filter(
        branch => !branch.endsWith('/HEAD')
      );

      // 2. 各ブランチが指すコミットハッシュを並列で解決
      const refsByCommit = new Map<string, string[]>();
      const branchOids = new Map<string, string>();

      const resolvePromises = allBranches.map(async branch => {
        try {
          const refName = branch.includes('/') ? toFullRemoteRef(branch) : branch;
          const oid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: refName });
          return { branch, oid };
        } catch {
          return null;
        }
      });

      const resolvedRefs = await Promise.all(resolvePromises);

      for (const result of resolvedRefs) {
        if (result) {
          branchOids.set(result.branch, result.oid);
          const existing = refsByCommit.get(result.oid) || [];
          if (!existing.includes(result.branch)) {
            existing.push(result.branch);
            refsByCommit.set(result.oid, existing);
          }
        }
      }

      // 3. ブランチフィルタモードに応じてコミットを取得
      let allCommits: Awaited<ReturnType<typeof git.log>> = [];

      if (branchFilter.mode === 'auto') {
        // 従来の動作: HEADからのみ取得
        allCommits = await git.log({
          fs: this.fs,
          dir: this.dir,
          depth: depth,
        });
      } else if (branchFilter.mode === 'all') {
        // 全ブランチからコミットを取得
        const targetBranches =
          branchFilter.branches && branchFilter.branches.length > 0
            ? branchFilter.branches
            : allBranches;

        // commitMapの型はgit.logの戻り値から推論させる
        const commitMap = new Map<string, Awaited<ReturnType<typeof git.log>>[number]>();

        // 各ブランチからコミットを取得
        const logPromises = targetBranches.map(async branch => {
          try {
            const refName = branch.includes('/') ? toFullRemoteRef(branch) : branch;
            const commits = await git.log({
              fs: this.fs,
              dir: this.dir,
              ref: refName,
              depth: depth,
            });
            return commits;
          } catch {
            return [];
          }
        });

        const branchCommits = await Promise.all(logPromises);

        // 重複を排除してマージ
        for (const commits of branchCommits) {
          for (const commit of commits) {
            if (!commitMap.has(commit.oid)) {
              commitMap.set(commit.oid, commit);
            }
          }
        }

        // タイムスタンプでソート（新しい順）
        allCommits = Array.from(commitMap.values()).sort(
          (a, b) => b.commit.author.timestamp - a.commit.author.timestamp
        );

        // depthの制限を適用
        if (allCommits.length > depth) {
          allCommits = allCommits.slice(0, depth);
        }
      }

      if (allCommits.length === 0) {
        return '';
      }

      // 4. コミットをフォーマット
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
      if (error instanceof Error && error.message.includes('not a git repository')) {
        return '';
      }
      throw new Error(`git log failed: ${(error as Error).message}`);
    }
  }

  /**
   * 利用可能なブランチ一覧を取得
   */
  async getAvailableBranches(): Promise<{ local: string[]; remote: string[] }> {
    try {
      await this.ensureProjectDirectory();

      const [localBranches, remoteBranches] = await Promise.all([
        git.listBranches({ fs: this.fs, dir: this.dir }),
        listAllRemoteRefs(this.fs, this.dir),
      ]);

      return {
        local: localBranches,
        remote: remoteBranches.filter(branch => !branch.endsWith('/HEAD')),
      };
    } catch {
      return { local: [], remote: [] };
    }
  }
}
