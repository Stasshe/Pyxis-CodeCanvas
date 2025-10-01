import FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';

import { GitCheckoutOperations } from './gitOperations/checkout';
import { GitDiffOperations } from './gitOperations/diff';
import { GitFileSystemHelper } from './gitOperations/fileSystemHelper';
import { GitLogOperations } from './gitOperations/log';
import { GitMergeOperations } from './gitOperations/merge';
import { GitResetOperations } from './gitOperations/reset';
import { GitRevertOperations } from './gitOperations/revert';

import { gitFileSystem } from '@/engine/core/gitFileSystem';
import { fileRepository } from '@/engine/core/fileRepository';
import { syncManager } from '@/engine/core/syncManager';

/**
 * [NEW ARCHITECTURE] Git操作を管理するクラス
 * - IndexedDBへの同期はfileRepositoryが自動的に実行
 * - Git操作後の逆同期はsyncManagerを使用
 * - バッチ処理機能を削除（不要）
 */
export class GitCommands {
  private fs: FS;
  private dir: string;
  private projectId: string;
  private projectName: string;

  constructor(projectName: string, projectId: string) {
    this.fs = gitFileSystem.getFS()!;
    this.dir = gitFileSystem.getProjectDir(projectName);
    this.projectId = projectId;
    this.projectName = projectName;
  }

  // ========================================
  // ユーティリティメソッド
  // ========================================

  // プロジェクトディレクトリの存在を確認し、なければ作成
  private async ensureProjectDirectory(): Promise<void> {
    await GitFileSystemHelper.ensureDirectory(this.fs, this.dir);
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
      return branch || 'main';
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
  async clone(url: string, targetDir?: string): Promise<string> {
    return this.executeGitOperation(async () => {
      // URLの妥当性を簡易チェック
      if (!url || typeof url !== 'string' || !url.trim()) {
        throw new Error('Invalid repository URL');
      }

      // リポジトリ名を取得
      const repoName = url.split('/').pop()?.replace('.git', '') || 'repository';

      // クローン先ディレクトリを決定
      let cloneDir: string;
      const currentRepoName = this.dir.split('/').pop() || 'project';

      if (targetDir) {
        cloneDir = `${this.dir.replace(`/${currentRepoName}`, '')}/${targetDir}`;
      } else {
        cloneDir = `${this.dir.replace(`/${currentRepoName}`, '')}/${repoName}`;
      }

      console.log(`[git clone] Clone directory: ${cloneDir}`);

      // クローン先ディレクトリが存在しないことを確認
      try {
        await this.fs.promises.stat(cloneDir);
        throw new Error(
          `fatal: destination path '${targetDir || repoName}' already exists and is not an empty directory.`
        );
      } catch (error) {
        if ((error as Error).message.includes('already exists')) {
          throw error;
        }
        // ディレクトリが存在しない場合は続行（期待される動作）
      }

      // リポジトリをクローン
      try {
        await git.clone({
          fs: this.fs,
          http,
          dir: cloneDir,
          url,
          corsProxy: 'https://cors.isomorphic-git.org',
          singleBranch: true,
          depth: 10,
        });
      } catch (cloneError) {
        console.error('[git clone] Clone failed:', cloneError);
        try {
          await this.fs.promises.rmdir(cloneDir);
        } catch {}
        throw new Error(
          `Failed to clone repository: ${(cloneError as Error).message}. Please check the URL and try again.`
        );
      }

      // クローンしたファイルをIndexedDBに同期
      console.log('[git clone] Syncing cloned files to IndexedDB...');
      await this.syncClonedFilesToIndexedDB(cloneDir, targetDir || repoName);

      return `Cloning into '${targetDir || repoName}'...\nClone completed successfully.`;
    }, 'git clone failed');
  }

  // クローンしたファイルをIndexedDBに同期
  private async syncClonedFilesToIndexedDB(
    clonePath: string,
    baseRelativePath: string
  ): Promise<void> {
    try {
      console.log(
        `[syncClonedFilesToIndexedDB] Processing: ${clonePath}, base: ${baseRelativePath}`
      );

      // ルートフォルダを作成
      if (baseRelativePath) {
        await fileRepository.createFile(this.projectId, `/${baseRelativePath}`, '', 'folder');
      }

      const entries = await this.fs.promises.readdir(clonePath);
      const directories: Array<{ name: string; fullPath: string; relativePath: string }> = [];
      const files: Array<{ name: string; fullPath: string; relativePath: string }> = [];

      for (const entry of entries) {
        if (entry === '.' || entry === '..' || entry === '.git') continue;

        const fullPath = `${clonePath}/${entry}`;
        const relativePath = `/${baseRelativePath}/${entry}`;

        try {
          const stat = await this.fs.promises.stat(fullPath);
          if (stat.isDirectory()) {
            directories.push({ name: entry, fullPath, relativePath });
          } else {
            files.push({ name: entry, fullPath, relativePath });
          }
        } catch (statError) {
          console.warn(`Failed to stat ${fullPath}:`, statError);
        }
      }

      // ディレクトリ作成
      for (const dir of directories) {
        await fileRepository.createFile(this.projectId, dir.relativePath, '', 'folder');
      }

      // ファイル作成
      for (const file of files) {
        try {
          const contentBuffer = await this.fs.promises.readFile(file.fullPath);

          // バイナリファイルかどうかを判定
          const isBinary = this.isBinaryFile(contentBuffer as Uint8Array);

          if (isBinary) {
            // バイナリファイル
            const uint8Array =
              contentBuffer instanceof Uint8Array
                ? contentBuffer
                : new Uint8Array(contentBuffer as ArrayBufferLike);
            const arrayBuffer = new Uint8Array(uint8Array).buffer as ArrayBuffer;
            await fileRepository.createFile(
              this.projectId,
              file.relativePath,
              '',
              'file',
              true,
              arrayBuffer
            );
          } else {
            // テキストファイル
            const content =
              typeof contentBuffer === 'string'
                ? contentBuffer
                : new TextDecoder().decode(contentBuffer as Uint8Array);
            await fileRepository.createFile(this.projectId, file.relativePath, content, 'file');
          }
        } catch (fileError) {
          console.error(`Failed to create file ${file.relativePath}:`, fileError);
        }
      }

      // サブディレクトリ再帰
      for (const dir of directories) {
        await this.syncClonedFilesToIndexedDB(dir.fullPath, `${baseRelativePath}/${dir.name}`);
      }
    } catch (readdirError) {
      console.error(`Failed to read directory ${clonePath}:`, readdirError);
      throw readdirError;
    }
  }

  // バイナリファイル判定
  private isBinaryFile(buffer: Uint8Array): boolean {
    const sampleSize = Math.min(buffer.length, 8000);
    for (let i = 0; i < sampleSize; i++) {
      const byte = buffer[i];
      if (byte === 0) return true;
      if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) return true;
    }
    return false;
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
    await gitFileSystem.flush();

    // 追加の待機時間
    await new Promise(resolve => setTimeout(resolve, 200));

    let status: Array<[string, number, number, number]> = [];
    try {
      status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
    } catch (statusError) {
      const error = statusError as Error;
      console.warn('[git.status] statusMatrix failed, using fallback method:', error.message);
      return this.getStatusFallback();
    }

    // 結果をフォーマット
    return await this.formatStatusResult(status);
  }

  // ステータス取得のフォールバック処理
  private async getStatusFallback(): Promise<string> {
    try {
      // ファイルシステムの同期を確実にする
      await gitFileSystem.flush();

      // 追加の待機時間
      await new Promise(resolve => setTimeout(resolve, 200));

      const files = await this.fs.promises.readdir(this.dir);
      const projectFiles = await this.getProjectFiles(files);
      const currentBranch = await this.getCurrentBranch();

      if (projectFiles.length === 0) {
        return `On branch ${currentBranch}\nnothing to commit, working tree clean`;
      }

      let result = `On branch ${currentBranch}\n`;
      result += '\nUntracked files:\n';
      result += '  (use "git add <file>..." to include in what will be committed)\n\n';
      projectFiles.forEach(file => (result += `\t${file}\n`));
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

  // ステータス結果をフォーマット
  private async formatStatusResult(
    status: Array<[string, number, number, number]>
  ): Promise<string> {
    const currentBranch = await this.getCurrentBranch();

    if (status.length === 0) {
      return `On branch ${currentBranch}\nnothing to commit, working tree clean`;
    }

    const { untracked, modified, staged, deleted } = this.categorizeStatusFiles(status);

    let result = `On branch ${currentBranch}\n`;

    if (staged.length > 0) {
      result += '\nChanges to be committed:\n';
      staged.forEach(file => (result += `  new file:   ${file}\n`));
    }

    if (modified.length > 0) {
      result += '\nChanges not staged for commit:\n';
      modified.forEach(file => (result += `  modified:   ${file}\n`));
    }

    if (deleted.length > 0) {
      if (modified.length === 0) {
        result += '\nChanges not staged for commit:\n';
      }
      deleted.forEach(file => (result += `  deleted:    ${file}\n`));
    }

    if (untracked.length > 0) {
      result += '\nUntracked files:\n';
      untracked.forEach(file => (result += `  ${file}\n`));
      result += '\nnothing added to commit but untracked files present (use "git add" to track)';
    }

    if (
      staged.length === 0 &&
      modified.length === 0 &&
      untracked.length === 0 &&
      deleted.length === 0
    ) {
      result = `On branch ${currentBranch}\nnothing to commit, working tree clean`;
    }

    return result;
  }

  // ファイルのステータスを分類
  private categorizeStatusFiles(status: Array<[string, number, number, number]>): {
    untracked: string[];
    modified: string[];
    staged: string[];
    deleted: string[];
  } {
    const untracked: string[] = [];
    const modified: string[] = [];
    const staged: string[] = [];
    const deleted: string[] = [];

    status.forEach(([filepath, HEAD, workdir, stage]) => {
      // isomorphic-gitのstatusMatrixの値の意味:
      // HEAD: 0=ファイルなし, 1=ファイルあり
      // workdir: 0=ファイルなし, 1=ファイルあり, 2=変更あり
      // stage: 0=ステージなし, 1=ステージ済み（変更なし）, 2=ステージ済み（変更あり）, 3=ステージ済み（新規）

      if (HEAD === 0 && (workdir === 1 || workdir === 2) && stage === 0) {
        // 新規ファイル（未追跡）
        untracked.push(filepath);
      } else if (HEAD === 0 && stage === 3) {
        // 新規ファイル（ステージ済み）
        staged.push(filepath);
      } else if (HEAD === 0 && stage === 2) {
        // 新規ファイル（ステージ済み・変更あり）
        staged.push(filepath);
      } else if (HEAD === 1 && workdir === 2 && stage === 1) {
        // 変更あり（未ステージ）
        modified.push(filepath);
      } else if (HEAD === 1 && workdir === 2 && stage === 2) {
        // 変更あり（ステージ済み）
        staged.push(filepath);
      } else if (HEAD === 1 && workdir === 0 && stage === 1) {
        // 削除（未ステージ）
        deleted.push(filepath);
      } else if (HEAD === 1 && workdir === 0 && stage === 0) {
        // 削除（ステージ済み）
        deleted.push(filepath);
      } else if (HEAD === 1 && workdir === 0 && stage === 3) {
        // 削除後に新規追加（ステージ済み）
        staged.push(filepath);
      }
    });

    return { untracked, modified, staged, deleted };
  }

  // ========================================
  // ファイルの追加・コミット操作
  // ========================================

  // git add - ファイルをステージング
  async add(filepath: string): Promise<string> {
    try {
      await this.ensureProjectDirectory();

      // ファイルシステムの同期を確実にする
      await gitFileSystem.flush();

      if (filepath === '.') {
        // すべてのファイルを追加
        const allFiles = await this.getAllFiles(this.dir);
        if (allFiles.length === 0) {
          return 'No files to add';
        }

        let addedCount = 0;
        const errors: string[] = [];

        for (const file of allFiles) {
          try {
            const relativePath = file.replace(`${this.dir}/`, '');
            if (!relativePath.startsWith('.git') && relativePath !== '.' && relativePath !== '..') {
              await git.add({ fs: this.fs, dir: this.dir, filepath: relativePath });
              addedCount++;
            }
          } catch (error) {
            errors.push(`Failed to add ${file}: ${(error as Error).message}`);
          }
        }

        if (errors.length > 0) {
          console.warn('[git add .] Some files failed to add:', errors);
        }

        return `Added ${addedCount} file(s)${errors.length > 0 ? ` (${errors.length} failed)` : ''}`;
      } else if (filepath === '*' || filepath.includes('*')) {
        // ワイルドカードパターン
        const matchingFiles = await this.getMatchingFiles(this.dir, filepath);

        if (matchingFiles.length === 0) {
          return `No files matching pattern: ${filepath}`;
        }

        let addedCount = 0;
        const errors: string[] = [];

        for (const file of matchingFiles) {
          try {
            const relativePath = file.replace(`${this.dir}/`, '');
            await git.add({ fs: this.fs, dir: this.dir, filepath: relativePath });
            addedCount++;
          } catch (error) {
            errors.push(`Failed to add ${file}: ${(error as Error).message}`);
          }
        }

        if (errors.length > 0) {
          console.warn(`[git add ${filepath}] Some files failed to add:`, errors);
        }

        return `Added ${addedCount} file(s)${errors.length > 0 ? ` (${errors.length} failed)` : ''}`;
      } else {
        // 単一ファイルまたはディレクトリ
        const normalizedPath = filepath.startsWith('/') ? filepath.slice(1) : filepath;
        const fullPath = `${this.dir}/${normalizedPath}`;

        try {
          const stat = await this.fs.promises.stat(fullPath);

          if (stat.isDirectory()) {
            // ディレクトリの場合、再帰的に追加
            const filesInDir = await this.getAllFilesInDirectory(fullPath);
            let addedCount = 0;
            const errors: string[] = [];

            for (const file of filesInDir) {
              try {
                const relativePath = file.replace(`${this.dir}/`, '');
                await git.add({ fs: this.fs, dir: this.dir, filepath: relativePath });
                addedCount++;
              } catch (error) {
                errors.push(`Failed to add ${file}: ${(error as Error).message}`);
              }
            }

            if (errors.length > 0) {
              console.warn(`[git add ${filepath}] Some files failed to add:`, errors);
            }

            return `Added ${addedCount} file(s) from directory${errors.length > 0 ? ` (${errors.length} failed)` : ''}`;
          } else {
            // ファイルの場合
            await git.add({ fs: this.fs, dir: this.dir, filepath: normalizedPath });
            return `add '${filepath}'`;
          }
        } catch (error) {
          const err = error as Error;
          if (err.message.includes('ENOENT')) {
            throw new Error(`pathspec '${filepath}' did not match any files`);
          }
          throw error;
        }
      }
    } catch (error) {
      throw new Error(`git add failed: ${(error as Error).message}`);
    }
  }

  // すべてのファイルを取得（再帰的）
  private async getAllFiles(dirPath: string): Promise<string[]> {
    return await GitFileSystemHelper.getAllFiles(this.fs, dirPath);
  }

  // パターンにマッチするファイルを取得
  private async getMatchingFiles(dirPath: string, pattern: string): Promise<string[]> {
    return await GitFileSystemHelper.getMatchingFiles(this.fs, dirPath, pattern);
  }

  // git commit - コミット
  async commit(
    message: string,
    author = { name: 'User', email: 'user@pyxis.dev' }
  ): Promise<string> {
    return this.executeGitOperation(async () => {
      await this.ensureGitRepository();
      const sha = await git.commit({
        fs: this.fs,
        dir: this.dir,
        message,
        author,
        committer: author,
      });

      return `[main ${sha.slice(0, 7)}] ${message}`;
    }, 'git commit failed');
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
  async getFormattedLog(depth = 20): Promise<string> {
    const logOperations = new GitLogOperations(this.fs, this.dir);
    return await logOperations.getFormattedLog(depth);
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

  // git branch - ブランチ一覧/作成
  async branch(branchName?: string, deleteFlag = false): Promise<string> {
    try {
      await this.ensureProjectDirectory();
      // Gitリポジトリが初期化されているかチェック
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      if (!branchName) {
        // ブランチ一覧を表示
        const branches = await git.listBranches({ fs: this.fs, dir: this.dir });
        const currentBranch = await this.getCurrentBranch();
        return branches.map(b => (b === currentBranch ? `* ${b}` : `  ${b}`)).join('\n');
      } else if (deleteFlag) {
        // ブランチ削除
        await git.deleteBranch({ fs: this.fs, dir: this.dir, ref: branchName });
        return `Deleted branch ${branchName}`;
      } else {
        // ブランチ作成
        await git.branch({ fs: this.fs, dir: this.dir, ref: branchName });
        return `Created branch ${branchName}`;
      }
    } catch (error) {
      throw new Error(`git branch failed: ${(error as Error).message}`);
    }
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
    options: { noFf?: boolean; message?: string } = {}
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
    });
  }

  // ワーキングディレクトリの変更を破棄
  async discardChanges(filepath: string): Promise<string> {
    try {
      await this.ensureGitRepository();

      const normalizedPath = filepath.startsWith('/') ? filepath.slice(1) : filepath;

      // HEADから最新のコミットを取得
      const commits = await git.log({ fs: this.fs, dir: this.dir, depth: 1 });
      if (commits.length === 0) {
        throw new Error('No commits found. Cannot discard changes.');
      }

      const headCommit = commits[0];

      // ファイルの内容をHEADから読み取る
      try {
        const { blob } = await git.readBlob({
          fs: this.fs,
          dir: this.dir,
          oid: headCommit.oid,
          filepath: normalizedPath,
        });

        // ファイルをワーキングディレクトリに書き戻す
        await this.fs.promises.writeFile(`${this.dir}/${normalizedPath}`, blob);

        // IndexedDBにも同期
        const content =
          typeof blob === 'string' ? blob : new TextDecoder().decode(blob as Uint8Array);
        await fileRepository.saveFile({
          id: '', // 既存のファイルを検索して更新
          projectId: this.projectId,
          path: `/${normalizedPath}`,
          name: normalizedPath.split('/').pop() || '',
          content,
          type: 'file',
          parentPath: `/${normalizedPath.substring(0, normalizedPath.lastIndexOf('/'))}` || '/',
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        return `Discarded changes in ${filepath}`;
      } catch (readError) {
        const err = readError as Error;
        if (err.message.includes('not found')) {
          // ファイルがHEADに存在しない場合は削除
          try {
            await this.fs.promises.unlink(`${this.dir}/${normalizedPath}`);

            // IndexedDBからも削除
            const files = await fileRepository.getProjectFiles(this.projectId);
            const file = files.find(f => f.path === `/${normalizedPath}`);
            if (file) {
              await fileRepository.deleteFile(file.id);
            }

            return `Removed untracked file ${filepath}`;
          } catch (unlinkError) {
            throw new Error(`Failed to remove file: ${(unlinkError as Error).message}`);
          }
        }
        throw readError;
      }
    } catch (error) {
      throw new Error(`Failed to discard changes: ${(error as Error).message}`);
    }
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
}
