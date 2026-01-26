import type FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';

import { GitCheckoutOperations } from './gitOperations/checkout';
import { GitCloneOperations } from './gitOperations/clone';
import { GitDiffOperations } from './gitOperations/diff';
import { GitFileSystemHelper } from './gitOperations/fileSystemHelper';
import { type BranchFilterOptions, GitLogOperations } from './gitOperations/log';
import { GitMergeOperations } from './gitOperations/merge';
import { listAllRemoteRefs, toFullRemoteRef } from './gitOperations/remoteUtils';
import { GitResetOperations } from './gitOperations/reset';
import { GitRevertOperations } from './gitOperations/revert';
import { formatStatusResult } from './gitOperations/status';

import type { TerminalUI } from '@/engine/cmd/terminalUI';
import { fileRepository } from '@/engine/core/fileRepository';
import { gitFileSystem } from '@/engine/core/gitFileSystem';
import { syncManager } from '@/engine/core/syncManager';
import { authRepository } from '@/engine/user/authRepository';

/**
 * [NEW ARCHITECTURE] Git操作を管理するクラス
 * - IndexedDBへの同期はfileRepositoryが自動的に実行
 * - Git操作後の逆同期はsyncManagerを使用
 * - バッチ処理機能を削除（不要）
 * - TerminalUI API provides advanced terminal display features
 */
export class GitCommands {
  private fs: FS;
  private dir: string;
  private projectId: string;
  private projectName: string;
  private terminalUI?: TerminalUI;

  constructor(projectName: string, projectId: string) {
    this.fs = gitFileSystem.getFS()!;
    this.dir = gitFileSystem.getProjectDir(projectName);
    this.projectId = projectId;
    this.projectName = projectName;
  }

  setTerminalUI(ui: TerminalUI) {
    this.terminalUI = ui;
  }

  // ========================================
  // ユーティリティメソッド
  // ========================================

  // プロジェクトディレクトリの存在を確認し、なければ作成
  private async ensureProjectDirectory(): Promise<void> {
    await GitFileSystemHelper.ensureDirectory(this.dir);
  }

  // Gitリポジトリが初期化されているかチェック
  private async ensureGitRepository(): Promise<void> {
    await this.ensureProjectDirectory();
    try {
      await this.fs.promises.stat(`${this.dir}/.git`);
    } catch {
      throw new Error('not a git repository (or any of the parent directories): .git');
    }
  }

  // エラーハンドリング付きのGit操作実行
  private async executeGitOperation<T>(
    operation: () => Promise<T>,
    errorPrefix: string
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw new Error(`${errorPrefix}: ${(error as Error).message}`);
    }
  }

  // ========================================
  // 基本的なGit操作
  // ========================================

  // 現在のブランチ名を取得
  async getCurrentBranch(): Promise<string> {
    try {
      await this.ensureGitRepository();
      const branch = await git.currentBranch({ fs: this.fs, dir: this.dir });

      if (!branch) {
        // detached HEAD状態 - 現在のコミットIDを取得
        try {
          const commits = await git.log({ fs: this.fs, dir: this.dir, depth: 1 });
          if (commits.length > 0) {
            return `(HEAD detached at ${commits[0].oid.slice(0, 7)})`;
          }
        } catch {
          // ログ取得失敗
        }
        return 'main';
      }

      return branch;
    } catch {
      return '(no git)';
    }
  }

  // git init - リポジトリ初期化
  async init(): Promise<string> {
    return this.executeGitOperation(async () => {
      await this.ensureProjectDirectory();
      await git.init({ fs: this.fs, dir: this.dir, defaultBranch: 'main' });
      return `Initialized empty Git repository in ${this.dir}`;
    }, 'git init failed');
  }

  // git clone - リモートリポジトリをクローン
  // Delegates to GitCloneOperations for optimized .git handling
  async clone(
    url: string,
    targetDir?: string,
    options: { skipDotGit?: boolean; maxGitObjects?: number } = {}
  ): Promise<string> {
    return this.executeGitOperation(async () => {
      const cloneOps = new GitCloneOperations({
        fs: this.fs,
        dir: this.dir,
        projectId: this.projectId,
        projectName: this.projectName,
      });
      return await cloneOps.clone(url, targetDir, options);
    }, 'git clone failed');
  }

  // ディレクトリ内の全ファイルを再帰的に取得
  private async getAllFilesInDirectory(dirPath: string): Promise<string[]> {
    const files: string[] = [];

    const traverse = async (currentPath: string) => {
      try {
        const entries = await this.fs.promises.readdir(currentPath);
        for (const entry of entries) {
          if (entry === '.' || entry === '..' || entry === '.git') continue;

          const fullPath = `${currentPath}/${entry}`;
          const stat = await this.fs.promises.stat(fullPath);

          if (stat.isDirectory()) {
            await traverse(fullPath);
          } else {
            files.push(fullPath);
          }
        }
      } catch (error) {
        console.warn(`Failed to traverse ${currentPath}:`, error);
      }
    };

    await traverse(dirPath);
    return files;
  }

  // git status - ステータス確認
  async status(): Promise<string> {
    await this.ensureGitRepository();

    // ファイルシステムの同期処理
    if ((this.fs as any).sync) {
      try {
        await (this.fs as any).sync();
      } catch (syncError) {
        console.warn('[git.status] FileSystem sync failed:', syncError);
      }
    }

    let status: Array<[string, number, number, number]> = [];
    try {
      status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
    } catch (statusError) {
      const error = statusError as Error;
      console.warn('[git.status] statusMatrix failed, using fallback method:', error.message);
      return this.getStatusFallback();
    }

    // 結果をフォーマット (moved to gitOperations/status.ts)
    const currentBranch = await this.getCurrentBranch();
    return await formatStatusResult(status, currentBranch);
  }

  // ステータス取得のフォールバック処理
  private async getStatusFallback(): Promise<string> {
    try {
      // ファイルシステムの同期を確実にする
      await gitFileSystem.flush();

      const files = await this.fs.promises.readdir(this.dir);
      const projectFiles = await this.getProjectFiles(files);
      const currentBranch = await this.getCurrentBranch();

      if (projectFiles.length === 0) {
        return `On branch ${currentBranch}\nnothing to commit, working tree clean`;
      }

      let result = `On branch ${currentBranch}\n`;
      result += '\nUntracked files:\n';
      result += '  (use "git add <file>..." to include in what will be committed)\n\n';
      for (let i = 0; i < projectFiles.length; i++) {
        result += `\t${projectFiles[i]}\n`;
      }
      result += '\nnothing added to commit but untracked files present (use "git add" to track)';

      return result;
    } catch (fallbackError) {
      console.error('Fallback status check failed:', fallbackError);
      const currentBranch = await this.getCurrentBranch();
      return `On branch ${currentBranch}\nnothing to commit, working tree clean`;
    }
  }

  // プロジェクトファイル一覧を取得（フォルダ除外）
  private async getProjectFiles(files: string[]): Promise<string[]> {
    const projectFiles = [];
    for (const file of files) {
      if (file.startsWith('.') || file === '.git') continue;

      try {
        const stat = await this.fs.promises.stat(`${this.dir}/${file}`);
        if (!stat.isDirectory()) {
          projectFiles.push(file);
        } else {
          // サブディレクトリ内のファイルを取得
          const subFiles = await this.getProjectFilesRecursive(`${this.dir}/${file}`, file);
          projectFiles.push(...subFiles);
        }
      } catch (statError) {
        console.warn(`Failed to stat ${file}:`, statError);
      }
    }
    return projectFiles;
  }

  // 再帰的にプロジェクトファイルを取得
  private async getProjectFilesRecursive(dirPath: string, prefix: string): Promise<string[]> {
    const projectFiles = [];
    try {
      const entries = await this.fs.promises.readdir(dirPath);
      for (const entry of entries) {
        if (entry === '.' || entry === '..' || entry === '.git') continue;

        const fullPath = `${dirPath}/${entry}`;
        const relativePath = `${prefix}/${entry}`;

        try {
          const stat = await this.fs.promises.stat(fullPath);
          if (!stat.isDirectory()) {
            projectFiles.push(relativePath);
          } else {
            const subFiles = await this.getProjectFilesRecursive(fullPath, relativePath);
            projectFiles.push(...subFiles);
          }
        } catch (statError) {
          console.warn(`Failed to stat ${fullPath}:`, statError);
        }
      }
    } catch (readdirError) {
      console.warn(`Failed to read directory ${dirPath}:`, readdirError);
    }
    return projectFiles;
  }

  // Status formatting and categorization have been moved to ./gitOperations/status.ts
  // See `formatStatusResult` and `categorizeStatusFiles` there.

  // ========================================
  // ファイルの追加・コミット操作
  // ========================================

  // [NEW ARCHITECTURE] git add - ファイルをステージング（削除ファイル対応強化版）
  async add(filepath: string): Promise<string> {
    await this.ensureProjectDirectory();
    const { add } = await import('./gitOperations/add');
    return await add(this.fs, this.dir, filepath);
  }

  // すべてのファイルを取得（再帰的）
  private async getAllFiles(dirPath: string): Promise<string[]> {
    return await GitFileSystemHelper.getAllFiles(this.fs, dirPath);
  }

  // パターンにマッチするファイルを取得
  private async getMatchingFiles(dirPath: string, pattern: string): Promise<string[]> {
    return await GitFileSystemHelper.getMatchingFiles(this.fs, dirPath, pattern);
  }

  // addAll implementation moved to ./gitOperations/add.ts (exported as addAll).

  // git commit - コミット（git_stable.tsベース）
  async commit(
    message: string,
    author = { name: 'User', email: 'user@pyxis.dev' }
  ): Promise<string> {
    await this.ensureGitRepository();
    const { commit } = await import('./gitOperations/commit');
    return await commit(this.fs, this.dir, message, author);
  }

  // git reset - ファイルをアンステージング、またはハードリセット
  async reset(
    options: { filepath?: string; hard?: boolean; commit?: string } = {}
  ): Promise<string> {
    const resetOperations = new GitResetOperations(
      this.fs,
      this.dir,
      this.projectId,
      this.projectName
    );
    return await resetOperations.reset(options);
  }

  // git log - ログ表示
  async log(depth = 10): Promise<string> {
    const logOperations = new GitLogOperations(this.fs, this.dir);
    return await logOperations.log(depth);
  }

  // UI用のGitログを取得（パイプ区切り形式、ブランチ情報付き）
  async getFormattedLog(
    depth = 20,
    branchFilter: BranchFilterOptions = { mode: 'auto' }
  ): Promise<string> {
    const logOperations = new GitLogOperations(this.fs, this.dir);
    return await logOperations.getFormattedLog(depth, branchFilter);
  }

  // 利用可能なブランチ一覧を取得
  async getAvailableBranches(): Promise<{ local: string[]; remote: string[] }> {
    const logOperations = new GitLogOperations(this.fs, this.dir);
    return await logOperations.getAvailableBranches();
  }

  // git checkout - ブランチ切り替え/作成
  async checkout(branchName: string, createNew = false): Promise<string> {
    const checkoutOperations = new GitCheckoutOperations(
      this.fs,
      this.dir,
      this.projectId,
      this.projectName
    );
    return await checkoutOperations.checkout(branchName, createNew);
  }

  /**
   * リモートブランチをチェックアウト（fetch後に使用）
   * 例: git checkout origin/main
   */
  async checkoutRemote(remoteBranch: string): Promise<string> {
    await this.ensureGitRepository();

    try {
      // Use remoteUtils to convert to full remote ref
      const remoteRef = toFullRemoteRef(remoteBranch);
      let commitOid: string;

      try {
        commitOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: remoteRef });
      } catch {
        throw new Error(`Remote branch '${remoteBranch}' not found. Did you run 'git fetch'?`);
      }

      // detached HEAD状態でチェックアウト
      const checkoutOperations = new GitCheckoutOperations(
        this.fs,
        this.dir,
        this.projectId,
        this.projectName
      );

      return await checkoutOperations.checkout(commitOid, false);
    } catch (error) {
      throw new Error(`Failed to checkout remote branch: ${(error as Error).message}`);
    }
  }

  // git revert - コミットを取り消し
  async revert(commitHash: string): Promise<string> {
    const revertOperations = new GitRevertOperations(
      this.fs,
      this.dir,
      this.projectId,
      this.projectName
    );
    return await revertOperations.revert(commitHash);
  }

  /**
   * git switch - ブランチまたはコミットに切り替え
   * origin/main, upstream/develop などのリモートブランチや
   * コミットハッシュにも対応
   */
  async switch(
    targetRef: string,
    options: {
      createNew?: boolean;
      detach?: boolean;
    } = {}
  ): Promise<string> {
    const { GitSwitchOperations } = await import('./gitOperations/switch');
    const switchOps = new GitSwitchOperations(this.fs, this.dir, this.projectId, this.projectName);
    return await switchOps.switch(targetRef, options);
  }

  // git branch - ブランチ一覧/作成
  async branch(
    branchName?: string,
    options: { delete?: boolean; remote?: boolean; all?: boolean } = {}
  ): Promise<string> {
    await this.ensureProjectDirectory();
    const { branch } = await import('./gitOperations/branch');
    return await branch(this.fs, this.dir, branchName, options);
  }

  // git diff - 変更差分を表示
  async diff(
    options: {
      staged?: boolean;
      filepath?: string;
      commit1?: string;
      commit2?: string;
      branchName?: string;
    } = {}
  ): Promise<string> {
    const diffOperations = new GitDiffOperations(this.fs, this.dir);
    return await diffOperations.diff(options);
  }

  // 2つのコミット間の差分
  async diffCommits(commit1: string, commit2: string, filepath?: string): Promise<string> {
    const diffOperations = new GitDiffOperations(this.fs, this.dir);
    return await diffOperations.diffCommits(commit1, commit2, filepath);
  }

  // git merge - ブランチをマージ
  async merge(
    branchName: string,
    options: { noFf?: boolean; message?: string; abort?: boolean } = {}
  ): Promise<string> {
    const mergeOperations = new GitMergeOperations(
      this.fs,
      this.dir,
      this.projectId,
      this.projectName
    );

    return await mergeOperations.merge(branchName, {
      noFf: options.noFf,
      message: options.message,
      abort: options.abort,
    });
  }

  // ワーキングディレクトリの変更を破棄
  async discardChanges(filepath: string): Promise<string> {
    await this.ensureGitRepository();
    const { discardChanges } = await import('./gitOperations/discardChanges');
    return await discardChanges(this.fs, this.dir, this.projectId, filepath);
  }

  // 指定コミット・ファイルの内容を取得 (git show 相当)
  async getFileContentAtCommit(commitId: string, filePath: string): Promise<string> {
    await this.ensureGitRepository();
    try {
      const { blob } = await git.readBlob({
        fs: this.fs,
        dir: this.dir,
        oid: commitId,
        filepath: filePath,
      });
      return typeof blob === 'string' ? blob : new TextDecoder().decode(blob as Uint8Array);
    } catch (e) {
      throw new Error(`Failed to read file at commit ${commitId}: ${(e as Error).message}`);
    }
  }

  // コミットの親ハッシュを取得（高速版）
  async getParentCommitIds(commitId: string): Promise<string[]> {
    await this.ensureGitRepository();
    try {
      const fullOid = await git.expandOid({ fs: this.fs, dir: this.dir, oid: commitId });
      const commit = await git.readCommit({ fs: this.fs, dir: this.dir, oid: fullOid });
      return commit.commit.parent || [];
    } catch (e) {
      console.warn(`Failed to get parent commits for ${commitId}:`, e);
      return [];
    }
  }

  // ========================================
  // リモート操作
  // ========================================

  /**
   * git push - リモートにプッシュ
   */
  async push(
    options: {
      remote?: string;
      branch?: string;
      force?: boolean;
    } = {}
  ): Promise<string> {
    await this.ensureGitRepository();

    // 動的インポートで循環参照を回避
    const { push } = await import('./gitOperations/push');
    return push(this.fs, this.dir, options, this.terminalUI);
  }

  /**
   * git remote add - リモートを追加
   */
  async addRemote(remote: string, url: string): Promise<string> {
    await this.ensureGitRepository();

    const { addRemote } = await import('./gitOperations/push');
    return addRemote(this.fs, this.dir, remote, url);
  }

  /**
   * git remote - リモート一覧を取得
   */
  async listRemotes(): Promise<string> {
    await this.ensureGitRepository();

    const { listRemotes } = await import('./gitOperations/push');
    return listRemotes(this.fs, this.dir);
  }

  /**
   * git remote remove - リモートを削除
   */
  async deleteRemote(remote: string): Promise<string> {
    await this.ensureGitRepository();

    const { deleteRemote } = await import('./gitOperations/push');
    return deleteRemote(this.fs, this.dir, remote);
  }

  /**
   * git fetch - リモートから変更を取得
   */
  async fetch(
    options: {
      remote?: string;
      branch?: string;
      depth?: number;
      prune?: boolean;
      tags?: boolean;
    } = {}
  ): Promise<string> {
    await this.ensureGitRepository();

    const { fetch } = await import('./gitOperations/fetch');
    return fetch(this.fs, this.dir, options);
  }

  /**
   * git fetch --all - 全リモートから変更を取得
   */
  async fetchAll(
    options: {
      depth?: number;
      prune?: boolean;
      tags?: boolean;
    } = {}
  ): Promise<string> {
    await this.ensureGitRepository();

    const { fetchAll } = await import('./gitOperations/fetch');
    return fetchAll(this.fs, this.dir, options);
  }

  /**
   * リモートブランチ一覧を取得
   */
  async listRemoteBranches(remote = 'origin'): Promise<string[]> {
    await this.ensureGitRepository();

    const { listRemoteBranches } = await import('./gitOperations/fetch');
    return listRemoteBranches(this.fs, this.dir, remote);
  }

  /**
   * リモートタグ一覧を取得
   */
  async listRemoteTags(): Promise<string[]> {
    await this.ensureGitRepository();

    const { listRemoteTags } = await import('./gitOperations/fetch');
    return listRemoteTags(this.fs, this.dir);
  }

  /**
   * git pull - fetch + merge/rebase
   */
  async pull(
    options: {
      remote?: string;
      branch?: string;
      rebase?: boolean;
    } = {}
  ): Promise<string> {
    await this.ensureGitRepository();
    const { pull } = await import('./gitOperations/pull');
    return await pull(this.fs, this.dir, this.projectId, this.projectName, options);
  }

  /**
   * git show - コミット情報またはコミット時点のファイル内容を表示
   */
  async show(args: string[]): Promise<string> {
    await this.ensureGitRepository();

    const { show } = await import('./gitOperations/show');
    return show(this.fs, this.dir, args);
  }
}
