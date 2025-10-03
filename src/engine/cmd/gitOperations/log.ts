import FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';

import { GitFileSystemHelper } from './fileSystemHelper';

/**
 * Git log操作を管理するクラス
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
    await GitFileSystemHelper.ensureDirectory(this.fs, this.dir);
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
  async getFormattedLog(depth = 20): Promise<string> {
    try {
      await this.ensureProjectDirectory();
      console.log('Getting formatted log for dir:', this.dir);

      // Gitリポジトリが初期化されているかチェック
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
        console.log('.git directory exists');
      } catch {
        console.log('.git directory does not exist');
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      // 現在のブランチを取得
      const currentBranch = (await git.currentBranch({ fs: this.fs, dir: this.dir })) || 'main';

      // ローカルブランチを取得
      const localBranches = await git.listBranches({ fs: this.fs, dir: this.dir });
      
      // リモートブランチを取得（origin/とupstream/のみ）
      const remoteBranches: string[] = [];
      try {
        // originのリモートブランチ
        try {
          const originBranches = await this.fs.promises.readdir(`${this.dir}/.git/refs/remotes/origin`);
          for (const branch of originBranches) {
            if (branch !== '.' && branch !== '..') {
              remoteBranches.push(`origin/${branch}`);
            }
          }
        } catch {
          // originディレクトリが存在しない
        }

        // upstreamのリモートブランチ
        try {
          const upstreamBranches = await this.fs.promises.readdir(`${this.dir}/.git/refs/remotes/upstream`);
          for (const branch of upstreamBranches) {
            if (branch !== '.' && branch !== '..') {
              remoteBranches.push(`upstream/${branch}`);
            }
          }
        } catch {
          // upstreamディレクトリが存在しない
        }
      } catch (error) {
        console.warn('[getFormattedLog] Failed to read remote branches:', error);
      }

      // 全てのブランチ（ローカル + リモート）
      // origin/HEAD, upstream/HEADなどのシンボリックリファレンスを除外
      const branches = [...localBranches, ...remoteBranches].filter(
        branch => !branch.endsWith('/HEAD')
      );
      console.log('All branches (excluding symbolic refs):', branches);

      // 全ブランチからコミットを収集
      const allCommits = new Map<string, any>(); // コミットハッシュをキーとして重複を避ける
      const branchHeads = new Map<string, string>(); // ブランチ名 -> HEADコミットハッシュ

      for (const branch of branches) {
        try {
          console.log(`Getting commits for branch: ${branch}`);
          
          // リモートブランチの場合は refs/remotes/ プレフィックスを使用
          const refName = branch.startsWith('origin/') || branch.startsWith('upstream/')
            ? `refs/remotes/${branch}`
            : branch;
          
          const branchCommits = await git.log({
            fs: this.fs,
            dir: this.dir,
            ref: refName,
            depth: depth,
          });

          if (branchCommits.length > 0) {
            // このブランチのHEAD(最初のコミット)を記録
            branchHeads.set(branch, branchCommits[0].oid);
          }

          // 全てのコミットを収集（重複なし）
          for (const commit of branchCommits) {
            if (!allCommits.has(commit.oid)) {
              allCommits.set(commit.oid, commit);
            }
          }
        } catch (branchError) {
          console.warn(`Failed to get commits for branch ${branch}:`, branchError);
        }
      }

      // 各コミットに、そのコミットがHEADであるブランチの配列を追加
      for (const commit of allCommits.values()) {
        const uiBranches: string[] = [];
        for (const [branch, headHash] of branchHeads.entries()) {
          if (commit.oid === headHash) {
            uiBranches.push(branch);
          }
        }
        commit.uiBranches = uiBranches;
      }

      // 全コミットを時系列順でソート
      const commits = Array.from(allCommits.values()).sort(
        (a, b) => b.commit.author.timestamp - a.commit.author.timestamp
      );

      console.log(`Total unique commits found: ${commits.length}`);

      if (commits.length === 0) {
        console.log('No commits found');
        return '';
      }

      const formattedCommits = [];

      for (const commit of commits) {
        const date = new Date(commit.commit.author.timestamp * 1000);
        // パイプ文字がメッセージに含まれている場合は置き換える
        const safeMessage = (commit.commit.message || 'No message')
          .replace(/\|/g, '｜')
          .replace(/\n/g, ' ');
        const safeName = (commit.commit.author.name || 'Unknown').replace(/\|/g, '｜');
        const safeDate = date.toISOString();
        // 親コミットのハッシュを追加（複数の親がある場合はカンマ区切り）
        const parentHashes = commit.commit.parent.join(',');
        // uiBranchesをカンマ区切りで出力
        const uiBranches = Array.isArray(commit.uiBranches) ? commit.uiBranches.join(',') : '';
        // フォーマット: hash|message|author|date|parentHashes|uiBranches
        const formatted = `${commit.oid}|${safeMessage}|${safeName}|${safeDate}|${parentHashes}|${uiBranches}`;
        formattedCommits.push(formatted);
      }

      return formattedCommits.join('\n');
    } catch (error) {
      // Gitリポジトリが初期化されていない場合は空文字を返す
      if (error instanceof Error && error.message.includes('not a git repository')) {
        return '';
      }
      throw new Error(`git log failed: ${(error as Error).message}`);
    }
  }
}
