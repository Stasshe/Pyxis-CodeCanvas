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

      // Use remoteUtils to get remote branches
      const remoteBranches = await listAllRemoteRefs(this.fs, this.dir);

      // 全てのブランチ（ローカル + リモート）
      // origin/HEAD, upstream/HEADなどのシンボリックリファレンスを除外
      const branches = [...localBranches, ...remoteBranches].filter(
        branch => !branch.endsWith('/HEAD')
      );
      console.log('All branches (excluding symbolic refs):', branches);

      // 全ブランチからコミットを収集
      const allCommits = new Map<string, any>(); // コミットハッシュをキーとして重複を避ける
      const refsByCommit = new Map<string, string[]>(); // コミットハッシュ -> ref名配列

      for (const branch of branches) {
        try {
          console.log(`Getting commits for branch: ${branch}`);

          // Use remoteUtils to convert to full ref
          const refName = branch.includes('/') ? toFullRemoteRef(branch) : branch;

          const branchCommits = await git.log({
            fs: this.fs,
            dir: this.dir,
            ref: refName,
            depth: depth,
          });

          if (branchCommits.length > 0) {
            // このブランチのHEAD(最初のコミット)にref名を記録
            const headHash = branchCommits[0].oid;
            const existingRefs = refsByCommit.get(headHash) || [];
            if (!existingRefs.includes(branch)) {
              existingRefs.push(branch);
              refsByCommit.set(headHash, existingRefs);
            }
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

      // 各コミットにrefs配列を設定
      for (const commit of allCommits.values()) {
        commit.refs = refsByCommit.get(commit.oid) || [];
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
        // refsをカンマ区切りで出力（このコミットを指すブランチ名）
        const refs = Array.isArray(commit.refs) ? commit.refs.join(',') : '';
        // ツリーSHAを追加（重複検出に使用）
        const treeSha = commit.commit.tree || '';
        // フォーマット: hash|message|author|date|parentHashes|refs|tree
        const formatted = `${commit.oid}|${safeMessage}|${safeName}|${safeDate}|${parentHashes}|${refs}|${treeSha}`;
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
