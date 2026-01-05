import type FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';

import { GitFileSystemHelper } from './fileSystemHelper';
import { listAllRemoteRefs, toFullRemoteRef } from './remoteUtils';

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
  // 高速化版: 全ブランチ個別ログ取得から、HEADログ + ブランチref解決に変更
  async getFormattedLog(depth = 20): Promise<string> {
    try {
      await this.ensureProjectDirectory();

      // Gitリポジトリが初期化されているかチェック
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      // 1. HEADからコミット履歴を取得（最も高速）
      const commits = await git.log({
        fs: this.fs,
        dir: this.dir,
        depth: depth,
      });

      if (commits.length === 0) {
        return '';
      }

      // 2. ブランチ情報を並列で取得（ローカル + リモート）
      const [localBranches, remoteBranches] = await Promise.all([
        git.listBranches({ fs: this.fs, dir: this.dir }),
        listAllRemoteRefs(this.fs, this.dir),
      ]);

      // origin/HEAD, upstream/HEADなどのシンボリックリファレンスを除外
      const allBranches = [...localBranches, ...remoteBranches].filter(
        branch => !branch.endsWith('/HEAD')
      );

      // 3. 各ブランチが指すコミットハッシュを並列で解決
      const refsByCommit = new Map<string, string[]>();
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
          const existing = refsByCommit.get(result.oid) || [];
          if (!existing.includes(result.branch)) {
            existing.push(result.branch);
            refsByCommit.set(result.oid, existing);
          }
        }
      }

      // 4. コミットをフォーマット
      const formattedCommits = commits.map(commit => {
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
}
