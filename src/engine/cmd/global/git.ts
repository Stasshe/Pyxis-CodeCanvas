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

import { fileRepository } from '@/engine/core/fileRepository';
import { gitFileSystem } from '@/engine/core/gitFileSystem';
import { syncManager } from '@/engine/core/syncManager';
import { authRepository } from '@/engine/user/authRepository';

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
  // options.skipDotGit: when true, remove the .git directory after cloning so
  // that clones initiated from the terminal do not create a git metadata folder
  // inside the project filesystem.
  // src/engine/cmd/global/git.ts の clone メソッドを高速化

  // src/engine/cmd/global/git.ts の clone メソッドを高速化

async clone(
  url: string,
  targetDir?: string,
  options: { skipDotGit?: boolean; maxGitObjects?: number } = {}
): Promise<string> {
  return this.executeGitOperation(async () => {
    // URLの妥当性を簡易チェック
    if (!url || typeof url !== 'string' || !url.trim()) {
      throw new Error('Invalid repository URL');
    }

    const repoName = url.split('/').pop()?.replace('.git', '') || 'repository';
    let cloneDir: string;
    const baseDir = this.dir.endsWith('/') ? this.dir.slice(0, -1) : this.dir;

    if (targetDir) {
      if (targetDir === '.' || targetDir === './') {
        cloneDir = baseDir;
      } else if (targetDir.startsWith('/')) {
        cloneDir = targetDir;
      } else {
        cloneDir = `${baseDir}/${targetDir}`;
      }
    } else {
      cloneDir = `${baseDir}/${repoName}`;
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
    }

    // リポジトリをクローン
    try {
      const depth = options.maxGitObjects ?? 10;
      await git.clone({
        fs: this.fs,
        http,
        dir: cloneDir,
        url,
        corsProxy: 'https://cors.isomorphic-git.org',
        singleBranch: true,
        depth,
        onAuth: url => {
          if (authRepository && typeof authRepository.getAccessToken === 'function') {
            return authRepository.getAccessToken().then(token => {
              if (token) {
                return { username: 'x-access-token', password: token };
              }
              return {};
            });
          }
          return {};
        },
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

    console.log('[git clone] Starting optimized IndexedDB sync...');

    // .gitディレクトリを削除（オプション）
    if (options.skipDotGit) {
      try {
        const gitPath = cloneDir.endsWith('/') ? `${cloneDir}.git` : `${cloneDir}/.git`;
        await this.removeRecursive(gitPath);
        console.log('[git clone] .git directory removed');
      } catch (removeError) {
        console.warn('[git clone] Failed to remove .git directory:', removeError);
      }
    }

    const baseRelativePath =
      cloneDir === baseDir
        ? ''
        : (targetDir && targetDir !== '.' ? targetDir : repoName).replace(/^\//, '');

    // ⭐ 高速化された同期処理
    await this.syncClonedFilesToIndexedDBOptimized(cloneDir, baseRelativePath);

    return `Cloning into '${targetDir || repoName}'...\nClone completed successfully.`;
  }, 'git clone failed');
}

/**
 * 再帰削除ヘルパー
 */
private async removeRecursive(path: string): Promise<void> {
  try {
    const entries = await this.fs.promises.readdir(path);
    for (const entry of entries) {
      const full = `${path}/${entry}`;
      try {
        const st = await this.fs.promises.stat(full);
        if (st.isDirectory()) {
          await this.removeRecursive(full);
        } else {
          await this.fs.promises.unlink(full);
        }
      } catch (e) {
        // ignore
      }
    }
    await this.fs.promises.rmdir(path);
  } catch (e) {
    // ignore
  }
}

/**
 * 🚀 最適化されたIndexedDB同期処理
 * - 全ファイルを一度に収集してからバルク作成
 * - 並列処理を最小限に抑えてトランザクション効率を最大化
 */
private async syncClonedFilesToIndexedDBOptimized(
  clonePath: string,
  baseRelativePath: string
): Promise<void> {
  console.log('[git clone] Starting optimized sync...');
  const startTime = performance.now();

  try {
    // パス正規化関数
    const normalizePath = (base: string, entry?: string) => {
      let path = base ? base.replace(/^\/+|\/+$/g, '') : '';
      if (entry) path = path ? `${path}/${entry}` : entry;
      path = '/' + path;
      path = path.replace(/\/+/g, '/');
      if (path === '/') return path;
      return path.replace(/\/+$/, '');
    };

    // 全ファイル/フォルダを一度に収集
    const allDirectories: Array<{ path: string; depth: number }> = [];
    const allFiles: Array<{
      path: string;
      content: string | Uint8Array;
      isBinary: boolean;
    }> = [];

    // ルートフォルダを追加
    if (baseRelativePath) {
      allDirectories.push({
        path: normalizePath(baseRelativePath),
        depth: baseRelativePath.split('/').length
      });
    }

    // 再帰的にファイルシステムを走査
    const traverse = async (currentPath: string, relativeBase: string, depth: number) => {
      try {
        const entries = await this.fs.promises.readdir(currentPath);
        
        for (const entry of entries) {
          if (entry === '.' || entry === '..' || entry === '.git') continue;

          const fullPath = `${currentPath}${currentPath.endsWith('/') ? '' : '/'}${entry}`;
          const relativePath = normalizePath(relativeBase, entry);

          try {
            const stat = await this.fs.promises.stat(fullPath);
            
            if (stat.isDirectory()) {
              allDirectories.push({ path: relativePath, depth });
              await traverse(fullPath, relativePath.replace(/^\//, ''), depth + 1);
            } else {
              const contentBuffer = await this.fs.promises.readFile(fullPath);
              const isBinary = this.isBinaryFile(contentBuffer as Uint8Array);
              
              allFiles.push({
                path: relativePath,
                content: contentBuffer,
                isBinary
              });
            }
          } catch (statError) {
            console.warn(`[git clone] Failed to stat ${fullPath}:`, statError);
          }
        }
      } catch (readdirError) {
        console.warn(`[git clone] Failed to read directory ${currentPath}:`, readdirError);
      }
    };

    // 全体を走査
    await traverse(clonePath, baseRelativePath, 1);

    console.log(`[git clone] Collected ${allDirectories.length} directories and ${allFiles.length} files`);

    // ディレクトリを深さ順にソート（浅い順）
    allDirectories.sort((a, b) => a.depth - b.depth);

    // バルク作成用のエントリを準備
    const directoryEntries = allDirectories.map(dir => ({
      path: dir.path,
      content: '',
      type: 'folder' as const
    }));

    const fileEntries = allFiles.map(file => {
      if (file.isBinary) {
        // file.content may be Uint8Array, ArrayBuffer, or (rarely) a string.
        // Handle each case explicitly to satisfy TypeScript and avoid unsafe casts.
        let uint8Array: Uint8Array;
        if (file.content instanceof Uint8Array) {
          uint8Array = file.content;
        } else if (file.content && typeof (file.content as unknown as ArrayBuffer).byteLength === 'number') {
          uint8Array = new Uint8Array(file.content as unknown as ArrayBuffer);
        } else if (typeof file.content === 'string') {
          // Fallback: encode string to bytes (shouldn't usually happen for binary files,
          // but keep as a safe fallback).
          uint8Array = new TextEncoder().encode(file.content);
        } else {
          // As a last resort, cast through unknown for ArrayBufferLike-compatible objects.
          uint8Array = new Uint8Array(file.content as unknown as ArrayBufferLike);
        }

        return {
          path: file.path,
          content: '',
          type: 'file' as const,
          isBufferArray: true,
          bufferContent: uint8Array.buffer as ArrayBuffer,
        };
      } else {
        const content = typeof file.content === 'string'
          ? file.content
          : new TextDecoder().decode(file.content as Uint8Array);
        return {
          path: file.path,
          content,
          type: 'file' as const,
          isBufferArray: false,
        };
      }
    });

    // 🚀 バルク作成で一度に全て作成
    console.log('[git clone] Creating directories in bulk...');
    if (directoryEntries.length > 0) {
      await fileRepository.createFilesBulk(this.projectId, directoryEntries, true);
    }

    console.log('[git clone] Creating files in bulk...');
    if (fileEntries.length > 0) {
      // 大量のファイルがある場合はバッチ処理
      const BATCH_SIZE = 100;
      for (let i = 0; i < fileEntries.length; i += BATCH_SIZE) {
        const batch = fileEntries.slice(i, i + BATCH_SIZE);
        await fileRepository.createFilesBulk(this.projectId, batch);
        console.log(`[git clone] Created batch ${i / BATCH_SIZE + 1}/${Math.ceil(fileEntries.length / BATCH_SIZE)}`);
      }
    }

    const endTime = performance.now();
    console.log(`[git clone] Optimized sync completed in ${(endTime - startTime).toFixed(2)}ms`);

  } catch (error) {
    console.error('[git clone] Optimized sync failed:', error);
    throw error;
  }
}

  /**
   * バイナリファイル判定（既存のまま）
   */
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
              console.log(
                `[git.add] File not found but exists in git, staging deletion: ${normalizedPath}`
              );
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
            // console.log(`[git.add] Staging deleted file: ${file}`);
            await git.remove({ fs: this.fs, dir: this.dir, filepath: file });
            deletedCount++;
          } else if (head === 0 && workdir > 0 && stage === 0) {
            // 新規ファイル（未追跡）: HEAD=0, WORKDIR>0, STAGE=0
            // console.log(`[git.add] Adding new file: ${file}`);
            await git.add({ fs: this.fs, dir: this.dir, filepath: file });
            newCount++;
          } else if (head === 1 && workdir === 2 && stage === 1) {
            // 変更されたファイル（未ステージ）: HEAD=1, WORKDIR=2, STAGE=1
            // console.log(`[git.add] Adding modified file: ${file}`);
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

  // git commit - コミット（git_stable.tsベース）
  async commit(
    message: string,
    author = { name: 'User', email: 'user@pyxis.dev' }
  ): Promise<string> {
    return this.executeGitOperation(async () => {
      await this.ensureGitRepository();

      // GitHubにログイン済みの場合は、その情報を使用
      let commitAuthor = author;
      try {
        const token = await authRepository.getAccessToken();
        if (token) {
          // GitHub APIでユーザー情報を取得
          const response = await fetch('https://api.github.com/user', {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github.v3+json',
            },
          });

          if (response.ok) {
            const userData = await response.json();
            commitAuthor = {
              name: userData.name || userData.login,
              email: userData.email || `${userData.login}@users.noreply.github.com`,
            };
            console.log('[git commit] Using GitHub user:', commitAuthor);
          }
        }
      } catch (error) {
        console.warn('[git commit] Failed to get GitHub user info, using default:', error);
        // エラーが発生してもデフォルトのauthorで続行
      }

      const sha = await git.commit({
        fs: this.fs,
        dir: this.dir,
        message,
        author: commitAuthor,
        committer: commitAuthor,
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

  /**
   * リモートブランチをチェックアウト（fetch後に使用）
   * 例: git checkout origin/main
   */
  async checkoutRemote(remoteBranch: string): Promise<string> {
    await this.ensureGitRepository();

    try {
      // リモートブランチのコミットIDを取得
      const remoteRef = `refs/remotes/${remoteBranch}`;
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

  // git branch - ブランチ一覧/作成
  async branch(
    branchName?: string,
    options: { delete?: boolean; remote?: boolean; all?: boolean } = {}
  ): Promise<string> {
    try {
      await this.ensureProjectDirectory();
      // Gitリポジトリが初期化されているかチェック
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      const { delete: deleteFlag = false, remote = false, all = false } = options;

      if (!branchName) {
        // ブランチ一覧を表示
        const currentBranch = await this.getCurrentBranch();
        let result = '';

        if (remote || all) {
          // リモートブランチを表示
          const remoteBranches: string[] = [];

          // refs/remotes 以下のブランチを直接取得
          try {
            // originのリモートブランチを取得
            try {
              const originBranches = await this.fs.promises.readdir(
                `${this.dir}/.git/refs/remotes/origin`
              );
              for (const branch of originBranches) {
                if (branch !== '.' && branch !== '..') {
                  remoteBranches.push(`origin/${branch}`);
                }
              }
            } catch {
              // originディレクトリが存在しない
            }

            // upstreamのリモートブランチを取得
            try {
              const upstreamBranches = await this.fs.promises.readdir(
                `${this.dir}/.git/refs/remotes/upstream`
              );
              for (const branch of upstreamBranches) {
                if (branch !== '.' && branch !== '..') {
                  remoteBranches.push(`upstream/${branch}`);
                }
              }
            } catch {
              // upstreamディレクトリが存在しない
            }
          } catch (error) {
            console.warn('[git branch] Failed to read remote branches:', error);
          }

          if (all && !remote) {
            // -a: ローカルブランチも表示
            const localBranches = await git.listBranches({ fs: this.fs, dir: this.dir });
            result += localBranches
              .map(b => (b === currentBranch ? `* ${b}` : `  ${b}`))
              .join('\n');
            if (localBranches.length > 0 && remoteBranches.length > 0) {
              result += '\n';
            }
          }

          if (remoteBranches.length > 0) {
            result += remoteBranches.map(b => `  ${b}`).join('\n');
          } else if (!all) {
            return 'No remote branches found. Use "git fetch" first.';
          }
        } else {
          // ローカルブランチのみ
          const branches = await git.listBranches({ fs: this.fs, dir: this.dir });
          result = branches.map(b => (b === currentBranch ? `* ${b}` : `  ${b}`)).join('\n');
        }

        return result || 'No branches found.';
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

        // 親ディレクトリを確認し、存在しなければ作成
        const parentDir = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'));
        if (parentDir) {
          const fullParentPath = `${this.dir}/${parentDir}`;
          await GitFileSystemHelper.ensureDirectory(this.fs, fullParentPath);
        }

        // ファイルをワーキングディレクトリに書き戻す
        await this.fs.promises.writeFile(`${this.dir}/${normalizedPath}`, blob);

        // IndexedDBにも同期（親フォルダも作成）- fileRepository.createFile を使用
        const content =
          typeof blob === 'string' ? blob : new TextDecoder().decode(blob as Uint8Array);

        const filePath = `/${normalizedPath}`;

        // createFile は自動的に親ディレクトリを作成し、既存ファイルの場合は更新する
        // これにより、fileRepository の体系的なエラーハンドリングとイベントシステムを活用できる
        await fileRepository.createFile(this.projectId, filePath, content, 'file');

        if (!fileExists) {
          return `Restored deleted file ${filepath}`;
        } else {
          return `Discarded changes in ${filepath}`;
        }
      } catch (readError) {
        const err = readError as Error;

        // isomorphic-git のエラーメッセージは環境やバージョンで文言が異なるため柔軟に判定する。
        // 例: "Could not find file or directory found at \"<oid>:path\"" や "not found" など。
        const notFoundInHead =
          err.message.includes('not found') ||
          err.message.includes('Could not find file') ||
          (headCommit &&
            err.message.includes(headCommit.oid) &&
            err.message.includes(`:${normalizedPath}`));

        if (notFoundInHead) {
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

        // 上のいずれでもない場合は想定外のエラーなので再スロー
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
    return push(this.fs, this.dir, options);
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

    const { remote = 'origin', branch, rebase = false } = options;

    try {
      // 現在のブランチを取得
      let targetBranch = branch;
      if (!targetBranch) {
        const currentBranch = await git.currentBranch({ fs: this.fs, dir: this.dir });
        if (!currentBranch) {
          throw new Error('No branch checked out');
        }
        targetBranch = currentBranch;
      }

      // 1. fetch実行
      console.log(`[git pull] Fetching from ${remote}/${targetBranch}...`);
      const { fetch } = await import('./gitOperations/fetch');
      await fetch(this.fs, this.dir, { remote, branch: targetBranch });

      // 2. リモート追跡ブランチのコミットIDを取得
      const remoteBranchRef = `refs/remotes/${remote}/${targetBranch}`;
      let remoteCommitOid: string;

      try {
        remoteCommitOid = await git.resolveRef({
          fs: this.fs,
          dir: this.dir,
          ref: remoteBranchRef,
        });
      } catch {
        throw new Error(`Remote branch '${remote}/${targetBranch}' not found after fetch`);
      }

      // 3. ローカルのコミットIDを取得
      const localCommitOid = await git.resolveRef({
        fs: this.fs,
        dir: this.dir,
        ref: `refs/heads/${targetBranch}`,
      });

      // 4. すでに最新の場合
      if (localCommitOid === remoteCommitOid) {
        return 'Already up to date.';
      }

      console.log(`[git pull] Merging ${remote}/${targetBranch} into ${targetBranch}...`);

      if (rebase) {
        // Rebase（未実装）
        throw new Error('git pull --rebase is not yet supported. Use merge instead.');
      } else {
        // 5. Fast-forward可能かチェック
        const localLog = await git.log({
          fs: this.fs,
          dir: this.dir,
          depth: 100,
          ref: targetBranch,
        });
        const isAncestor = localLog.some(c => c.oid === remoteCommitOid);

        if (!isAncestor) {
          // Fast-forwardできない場合はマージ
          // まずリモートブランチをdetached HEADでチェックアウト
          const mergeOperations = new GitMergeOperations(
            this.fs,
            this.dir,
            this.projectId,
            this.projectName
          );

          // マージ実行（リモートコミットをマージ）
          const mergeResult = await mergeOperations.merge(remoteBranchRef, {
            message: `Merge branch '${remote}/${targetBranch}'`,
          });

          return `From ${remote}\n${mergeResult}`;
        } else {
          // Fast-forward可能
          console.log('[git pull] Fast-forwarding...');

          // HEADを更新
          await git.writeRef({
            fs: this.fs,
            dir: this.dir,
            ref: `refs/heads/${targetBranch}`,
            value: remoteCommitOid,
            force: true,
          });

          // ワーキングディレクトリを更新
          await git.checkout({
            fs: this.fs,
            dir: this.dir,
            ref: targetBranch,
            force: true,
          });

          // IndexedDBに同期
          await syncManager.syncFromFSToIndexedDB(this.projectId, this.projectName);

          const shortLocal = localCommitOid.slice(0, 7);
          const shortRemote = remoteCommitOid.slice(0, 7);

          return `Updating ${shortLocal}..${shortRemote}\nFast-forward`;
        }
      }
    } catch (error) {
      throw new Error(`git pull failed: ${(error as Error).message}`);
    }
  }
}
