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

    // [NEW ARCHITECTURE] IndexedDBからgitFileSystemへの完全同期を実行
    // git_stable.ts方式に加えて、NEW-ARCHITECTUREの同期も実行
    console.log('[git.status] Starting IndexedDB sync for git operations');
    try {
      await syncManager.syncFromIndexedDBToFS(this.projectId, this.projectName);
      console.log('[git.status] IndexedDB sync completed');
    } catch (syncError) {
      console.warn('[git.status] IndexedDB sync failed, proceeding anyway:', syncError);
    }

    // ファイルシステムの同期処理（git_stable.ts方式）
    if ((this.fs as any).sync) {
      try {
        await (this.fs as any).sync();
      } catch (syncError) {
        console.warn('[git.status] FileSystem sync failed:', syncError);
      }
    }

    // git addの後に呼び出される場合、追加の待機時間を設ける
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

  // ステータス結果をフォーマット（git_stable.tsベース）
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

  // ファイルのステータスを分類（git_stable.tsベース）
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
        // 新しいファイル（未追跡）- workdir が 1 または 2 の場合
        untracked.push(filepath);
      } else if (HEAD === 0 && stage === 3) {
        // 新しくステージされたファイル（stage=3の場合）
        staged.push(filepath);
      } else if (HEAD === 0 && stage === 2) {
        // 新しくステージされたファイル（stage=2の場合）
        staged.push(filepath);
      } else if (HEAD === 1 && workdir === 2 && stage === 1) {
        // 変更されたファイル（未ステージ）
        modified.push(filepath);
      } else if (HEAD === 1 && workdir === 2 && stage === 2) {
        // 変更されてステージされたファイル
        staged.push(filepath);
      } else if (HEAD === 1 && workdir === 0 && stage === 1) {
        // 削除されたファイル（未ステージ）- unstaged deletion
        deleted.push(filepath);
      } else if (HEAD === 1 && workdir === 0 && stage === 0) {
        // 削除されたファイル（ステージ済み）- staged deletion
        staged.push(filepath);
      } else if (HEAD === 1 && workdir === 0 && stage === 3) {
        // 削除されてステージされたファイル
        staged.push(filepath);
      }
      // その他のケース（HEAD === 1 && workdir === 1 && stage === 1など）は変更なし
    });

    return { untracked, modified, staged, deleted };
  }

  // ========================================
  // ファイルの追加・コミット操作
  // ========================================

  // [NEW ARCHITECTURE] git add - ファイルをステージング（削除ファイル対応強化版）
  async add(filepath: string): Promise<string> {
    try {
      await this.ensureProjectDirectory();

      // [NEW ARCHITECTURE] IndexedDBからgitFileSystemへの完全同期を実行
      console.log(`[git.add] Starting IndexedDB sync for staging: ${filepath}`);
      try {
        await syncManager.syncFromIndexedDBToFS(this.projectId, this.projectName);
        console.log('[git.add] IndexedDB sync completed');
      } catch (syncError) {
        console.warn('[git.add] IndexedDB sync failed, proceeding anyway:', syncError);
      }

      // ファイルシステムの同期処理（git_stable.ts方式）
      if ((this.fs as any).sync) {
        try {
          await (this.fs as any).sync();
        } catch (syncError) {
          console.warn('[git.add] FileSystem sync failed:', syncError);
        }
      }

      if (filepath === '.') {
        // すべてのファイルを追加（削除されたファイルも含む）
        return await this.addAll();
      } else if (filepath === '*' || filepath.includes('*')) {
        // ワイルドカードパターン
        const matchingFiles = await this.getMatchingFiles(this.dir, filepath);
        
        // 削除されたファイルも含めてステージング対象を取得
        const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
        const deletedFiles: string[] = [];

        // 削除されたファイルを特定
        for (const [file, head, workdir, stage] of status) {
          if (head === 1 && workdir === 0 && stage === 1) {
            // 削除されたファイル（未ステージ）
            deletedFiles.push(file);
          }
        }

        if (matchingFiles.length === 0 && deletedFiles.length === 0) {
          return `No files matching pattern: ${filepath}`;
        }

        let addedCount = 0;
        let deletedCount = 0;
        const errors: string[] = [];

        // 通常のファイルを追加
        for (const file of matchingFiles) {
          try {
            const relativePath = file.replace(`${this.dir}/`, '');
            await git.add({ fs: this.fs, dir: this.dir, filepath: relativePath });
            addedCount++;
          } catch (error) {
            errors.push(`Failed to add ${file}: ${(error as Error).message}`);
          }
        }

        // 削除されたファイルをステージング
        for (const file of deletedFiles) {
          try {
            await git.remove({ fs: this.fs, dir: this.dir, filepath: file });
            deletedCount++;
          } catch (error) {
            errors.push(`Failed to stage deleted file ${file}: ${(error as Error).message}`);
          }
        }

        if (errors.length > 0) {
          console.warn(`[git add ${filepath}] Some files failed to add:`, errors);
        }

        const totalFiles = addedCount + deletedCount;
        return `Added ${addedCount} file(s), staged ${deletedCount} deletion(s) (${totalFiles} total)${errors.length > 0 ? ` (${errors.length} failed)` : ''}`;
      } else {
        // 単一ファイルまたはディレクトリ
        const normalizedPath = filepath.startsWith('/') ? filepath.slice(1) : filepath;
        
        // まずステータスマトリックスから該当ファイルの状態を確認
        const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
        const fileStatus = status.find(([path]) => path === normalizedPath);
        
        if (fileStatus) {
          const [path, HEAD, workdir, stage] = fileStatus;
          
          // 削除されたファイル (HEAD=1, workdir=0, stage=1) の場合
          if (HEAD === 1 && workdir === 0 && stage === 1) {
            console.log(`[git.add] Staging deleted file: ${path}`);
            await git.remove({ fs: this.fs, dir: this.dir, filepath: normalizedPath });
            return `Staged deletion of ${filepath}`;
          }
          // 新規・変更されたファイル (workdir=1 or workdir=2) の場合
          else if (workdir === 1 || workdir === 2) {
            console.log(`[git.add] Processing new/modified file: ${path} (workdir=${workdir})`);
            await git.add({ fs: this.fs, dir: this.dir, filepath: normalizedPath });
            return `Added ${filepath} to staging area`;
          }
          // 既にステージング済み
          else if (stage === 2 || stage === 3) {
            return `'${filepath}' is already staged`;
          }
        }

        // ステータスマトリックスにない場合は直接ファイルシステムで確認
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
            // 通常のファイル追加
            console.log(`[git.add] Adding file directly: ${normalizedPath}`);
            await git.add({ fs: this.fs, dir: this.dir, filepath: normalizedPath });
            return `Added ${filepath} to staging area`;
          }
        } catch (error) {
          const err = error as Error;
          if (err.message.includes('ENOENT')) {
            // ファイルが存在しない場合は削除されたファイルの可能性があるので、
            // ステータスを再確認
            const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
            const fileStatus = status.find(([path]) => path === normalizedPath);
            
            if (fileStatus && fileStatus[1] === 1 && fileStatus[2] === 0) {
              // 削除されたファイル
              console.log(`[git.add] File not found but exists in git, staging deletion: ${normalizedPath}`);
              await git.remove({ fs: this.fs, dir: this.dir, filepath: normalizedPath });
              return `Staged deletion of ${filepath}`;
            }
            
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

  // [NEW ARCHITECTURE] すべてのファイルを追加（削除されたファイルも含む）- git_stable.tsベース
  private async addAll(): Promise<string> {
    try {
      console.log('[git.add] Processing all files in current directory');

      // [NEW ARCHITECTURE] IndexedDBからgitFileSystemへの完全同期を実行
      console.log('[git.add] Starting IndexedDB sync for git operations');
      try {
        await syncManager.syncFromIndexedDBToFS(this.projectId, this.projectName);
        console.log('[git.add] IndexedDB sync completed');
      } catch (syncError) {
        console.warn('[git.add] IndexedDB sync failed, proceeding anyway:', syncError);
      }

      // [重要] ファイルシステムの同期を確実にする（git_stable.tsと同様）
      if ((this.fs as any).sync) {
        try {
          await (this.fs as any).sync();
        } catch (syncError) {
          console.warn('[git.add] FileSystem sync failed:', syncError);
        }
      }

      // ステータスマトリックスから全ファイルの状態を取得
      const statusMatrix = await git.statusMatrix({ fs: this.fs, dir: this.dir });
      console.log(`[git.add] Status matrix found ${statusMatrix.length} files`);
      console.log(`[git.add] Project directory: ${this.dir}`);
      
      // デバッグ: statusMatrixの内容を詳しくログ
      statusMatrix.forEach(([file, head, workdir, stage]) => {
        console.log(`[git.add] File: ${file}, HEAD=${head}, workdir=${workdir}, stage=${stage}`);
      });

      let newCount = 0,
        modifiedCount = 0,
        deletedCount = 0;

      // 全ファイルの状態に応じて適切な操作を実行
      // isomorphic-gitのsnippets実装に基づく: worktreeStatus ? git.add : git.remove
      for (const [file, head, workdir, stage] of statusMatrix) {
        try {
          if (workdir === 0 && head === 1 && stage === 1) {
            // 削除されたファイル（未ステージ）: HEAD=1, WORKDIR=0, STAGE=1
            console.log(`[git.add] Staging deleted file: ${file}`);
            await git.remove({ fs: this.fs, dir: this.dir, filepath: file });
            deletedCount++;
          } else if (head === 0 && workdir > 0 && stage === 0) {
            // 新規ファイル（未追跡）: HEAD=0, WORKDIR>0, STAGE=0
            console.log(`[git.add] Adding new file: ${file}`);
            await git.add({ fs: this.fs, dir: this.dir, filepath: file });
            newCount++;
          } else if (head === 1 && workdir === 2 && stage === 1) {
            // 変更されたファイル（未ステージ）: HEAD=1, WORKDIR=2, STAGE=1
            console.log(`[git.add] Adding modified file: ${file}`);
            await git.add({ fs: this.fs, dir: this.dir, filepath: file });
            modifiedCount++;
          }
          // 既にステージ済みのファイル（stage === 2, 0 など）はスキップ
        } catch (operationError) {
          console.warn(`[git.add] Failed to process ${file}:`, operationError);
        }
      }

      // 件数ごとに出力
      console.log(
        `[git.add] Completed: ${newCount} new, ${modifiedCount} modified, ${deletedCount} deleted`
      );
      return `Added: ${newCount} new, ${modifiedCount} modified, ${deletedCount} deleted files to staging area`;
    } catch (error) {
      console.error('[git.add] Failed:', error);
      throw new Error(`Failed to add all files: ${(error as Error).message}`);
    }
  }

  // git commit - コミット
  async commit(
    message: string,
    author = { name: 'User', email: 'user@pyxis.dev' }
  ): Promise<string> {
    return this.executeGitOperation(async () => {
      console.log('[git.commit] Starting commit process...');
      await this.ensureGitRepository();

      // [NEW ARCHITECTURE] IndexedDBからgitFileSystemへの完全同期を実行
      console.log('[git.commit] Starting IndexedDB sync for commit...');
      try {
        await syncManager.syncFromIndexedDBToFS(this.projectId, this.projectName);
        console.log('[git.commit] IndexedDB sync completed');
      } catch (syncError) {
        console.warn('[git.commit] IndexedDB sync failed, proceeding anyway:', syncError);
      }

      // ファイルシステムの同期処理（git_stable.ts方式）
      if ((this.fs as any).sync) {
        try {
          await (this.fs as any).sync();
        } catch (syncError) {
          console.warn('[git.commit] FileSystem sync failed:', syncError);
        }
      }

      console.log('[git.commit] Proceeding with commit...');
      
      const sha = await git.commit({
        fs: this.fs,
        dir: this.dir,
        message,
        author,
        committer: author,
      });

      console.log(`[git.commit] Commit successful: ${sha}`);
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

      // ファイルが現在のワーキングディレクトリに存在するかチェック
      let fileExists = false;
      try {
        await this.fs.promises.stat(`${this.dir}/${normalizedPath}`);
        fileExists = true;
      } catch {
        fileExists = false;
      }

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

        if (!fileExists) {
          return `Restored deleted file ${filepath}`;
        } else {
          return `Discarded changes in ${filepath}`;
        }
      } catch (readError) {
        const err = readError as Error;
        if (err.message.includes('not found')) {
          // ファイルがHEADに存在しない場合（新規追加されたファイル）は削除
          if (fileExists) {
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
          } else {
            return `File ${filepath} is already removed`;
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
