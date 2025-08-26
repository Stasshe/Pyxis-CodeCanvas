import FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { getFileSystem, getProjectDir } from '@/utils/core/filesystem';
import { GitRevertOperations } from './gitOperations/revert';
import { GitCheckoutOperations } from './gitOperations/checkout';
import { GitFileSystemHelper } from './gitOperations/fileSystemHelper';
import { GitLogOperations } from './gitOperations/log';
import { GitResetOperations } from './gitOperations/reset';
import { GitDiffOperations } from './gitOperations/diff';
import { GitMergeOperations } from './gitOperations/merge';

/**
 * Git操作を管理するクラス
 * isomorphic-gitを使用してブラウザ環境でGit操作を実現
 */
export class GitCommands {
  private fs: FS;
  private dir: string;
  private onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean) => Promise<void>;

  constructor(projectName: string, onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean) => Promise<void>) {
    this.fs = getFileSystem()!;
    this.dir = getProjectDir(projectName);
    this.onFileOperation = onFileOperation;
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
  private async executeGitOperation<T>(operation: () => Promise<T>, errorPrefix: string): Promise<T> {
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

  // terminalGitCommands.ts の clone メソッド
  async clone(url: string, targetDir?: string): Promise<string> {
    return this.executeGitOperation(async () => {
      // URLの妥当性を簡易チェック
      if (!url || typeof url !== 'string' || !url.trim()) {
        throw new Error('fatal: repository URL is required');
      }

      // リポジトリ名を取得
      const repoName = url.split('/').pop()?.replace('.git', '') || 'repository';
      
      // クローン先ディレクトリを決定
      let cloneDir: string;
      const currentRepoName = this.dir.split('/').pop() || 'project';
      
      if (targetDir) {
        // targetDirが指定された場合: projects/{現在のリポジトリ名}/{targetDir}
        cloneDir = `/projects/${currentRepoName}/${targetDir}`;
      } else {
        // targetDirが指定されていない場合: projects/{クローン先リポジトリ名}
        cloneDir = `/projects/${repoName}`;
      }

      console.log(`[git clone] Clone directory: ${cloneDir}`);

      // クローン先ディレクトリが存在しないことを確認
      try {
        await this.fs.promises.stat(cloneDir);
        throw new Error(`fatal: destination path '${targetDir || repoName}' already exists and is not an empty directory.`);
      } catch (error) {
        // ディレクトリが存在しない場合は正常（続行）
        if (!(error as any).code || (error as any).code !== 'ENOENT') {
          throw error;
        }
      }

      // 段階的にディレクトリを作成
      try {
        await this.ensureGitRepository()
        // 最終的なクローン先ディレクトリを作成
        await this.fs.promises.mkdir(cloneDir, { recursive: true });
        console.log(`[git clone] Created clone directory: ${cloneDir}`);
      } catch (mkdirError) {
        console.error('[git clone] Failed to create directories:', mkdirError);
        throw new Error(`Failed to create clone directory: ${(mkdirError as Error).message}`);
      }

      // リポジトリをクローン
      try {
        console.log(`[git clone] Starting git clone to ${cloneDir}`);
        await git.clone({
          fs: this.fs,
          http,
          dir: cloneDir,
          url: url,
          singleBranch: true,
          depth: 1,
          noTags: true,
          corsProxy: 'https://cors.isomorphic-git.org',
        });
        console.log('[git clone] Git clone completed successfully');
      } catch (cloneError) {
        console.error('[git clone] Git clone failed:', cloneError);
        // クローンに失敗した場合、作成したディレクトリをクリーンアップ
        try {
          const entries = await this.fs.promises.readdir(cloneDir);
          if (entries.length === 0) {
            await this.fs.promises.rmdir(cloneDir);
          }
        } catch {
          // クリーンアップに失敗してもエラーは無視
        }
        throw cloneError;
      }

      // クローンしたファイルをファイルシステムに反映（再帰的に処理）
      if (this.onFileOperation) {
        try {
          console.log('[git clone] Starting file synchronization');
          // クローン先のルートパスを基準に同期
          const relativePath = targetDir || repoName;
          await this.syncDirectoryRecursively(cloneDir, relativePath);
          console.log('[git clone] File synchronization completed');
        } catch (syncError) {
          console.warn('Failed to sync files to project:', syncError);
          // ファイル同期エラーは警告のみで処理を続行
        }
      }

      return `Cloning into '${targetDir || repoName}'...\nClone completed successfully.`;
    }, 'git clone failed');
  }

  // 再帰的にディレクトリをSync するヘルパーメソッド
  private async syncDirectoryRecursively(clonePath: string, baseRelativePath: string): Promise<void> {
    try {
      console.log(`[syncDirectoryRecursively] Processing: ${clonePath}, base: ${baseRelativePath}`);
      
      // まず baseRelativePath のルートフォルダを作成（最初の呼び出し時のみ）
      if (baseRelativePath && this.onFileOperation) {
        console.log(`[syncDirectoryRecursively] Creating root folder: ${baseRelativePath}`);
        await this.onFileOperation(baseRelativePath, 'folder', '');
      }
      
      const entries = await this.fs.promises.readdir(clonePath);
      console.log(`[syncDirectoryRecursively] Found ${entries.length} entries in ${clonePath}`);
      
      // エントリを分類
      const directories: Array<{name: string, fullPath: string, relativePath: string}> = [];
      const files: Array<{name: string, fullPath: string, relativePath: string}> = [];
      
      for (const entry of entries) {
        // .git ディレクトリは除外
        if (entry === '.git') {
          console.log(`[syncDirectoryRecursively] Skipping .git directory`);
          continue;
        }
        
        const entryFullPath = `${clonePath}/${entry}`;
        const entryRelativePath = baseRelativePath ? `${baseRelativePath}/${entry}` : entry;
        
        try {
          const stat = await this.fs.promises.stat(entryFullPath);
          
          if (stat.isDirectory()) {
            directories.push({
              name: entry,
              fullPath: entryFullPath,
              relativePath: entryRelativePath
            });
          } else {
            files.push({
              name: entry,
              fullPath: entryFullPath,
              relativePath: entryRelativePath
            });
          }
        } catch (statError) {
          console.warn(`Failed to stat ${entryFullPath}:`, statError);
        }
      }
      
      // 1. 現在のレベルのディレクトリを先に作成
      for (const dir of directories) {
        if (this.onFileOperation) {
          console.log(`[syncDirectoryRecursively] Creating folder: ${dir.relativePath}`);
          await this.onFileOperation(dir.relativePath, 'folder', '');
        }
      }
      
      // 2. 現在のレベルのファイルを作成
      for (const file of files) {
        try {
          const content = await this.fs.promises.readFile(file.fullPath, 'utf8');
          if (this.onFileOperation) {
            console.log(`[syncDirectoryRecursively] Creating file: ${file.relativePath}, content length: ${content.length}`);
            await this.onFileOperation(file.relativePath, 'file', content);
          }
        } catch (readError) {
          console.warn(`Failed to read file ${file.fullPath}:`, readError);
          // バイナリファイルの場合は空の内容で同期
          if (this.onFileOperation) {
            console.log(`[syncDirectoryRecursively] Creating binary file: ${file.relativePath}`);
            await this.onFileOperation(file.relativePath, 'file', '');
          }
        }
      }
      
      // 3. サブディレクトリを再帰的に処理
      for (const dir of directories) {
        await this.syncDirectoryRecursively(dir.fullPath, dir.relativePath);
      }
      
    } catch (readdirError) {
      console.error(`Failed to read directory ${clonePath}:`, readdirError);
      throw readdirError;
    }
  }

  // ディレクトリ内の全ファイルを再帰的に取得
  private async getAllFilesInDirectory(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    
    const traverse = async (currentPath: string) => {
      try {
        const entries = await this.fs.promises.readdir(currentPath);
        for (const entry of entries) {
          const fullPath = `${currentPath}/${entry}`;
          const stat = await this.fs.promises.stat(fullPath);
          
          if (stat.isDirectory()) {
            // .gitディレクトリはスキップ
            if (entry !== '.git') {
              await traverse(fullPath);
            }
          } else {
            files.push(fullPath);
          }
        }
      } catch (error) {
        console.warn(`Failed to traverse directory ${currentPath}:`, error);
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
      if ((this.fs as any).sync) {
        try {
          await (this.fs as any).sync();
        } catch (syncError) {
          console.warn('[git.getStatusFallback] FileSystem sync failed:', syncError);
        }
      }
      
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
      projectFiles.forEach(file => result += `\t${file}\n`);
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
        const filePath = `${this.dir}/${file}`;
        const stat = await this.fs.promises.stat(filePath);
        if (stat.isFile()) {
          projectFiles.push(file);
        } else if (stat.isDirectory()) {
          // ディレクトリ内のファイルも再帰的に検査
          try {
            const subFiles = await this.fs.promises.readdir(filePath);
            
            for (const subFile of subFiles) {
              if (!subFile.startsWith('.')) {
                const subFilePath = `${filePath}/${subFile}`;
                try {
                  const subStat = await this.fs.promises.stat(subFilePath);
                  if (subStat.isFile()) {
                    projectFiles.push(`${file}/${subFile}`);
                  }
                } catch (subStatError) {
                  // サブファイルのstat失敗は無視
                }
              }
            }
          } catch (subDirError) {
            // サブディレクトリの読み取り失敗は無視
          }
        }
      } catch (statError) {
        // ファイルのstat失敗は無視
      }
    }
    return projectFiles;
  }

  // ステータス結果をフォーマット
  private async formatStatusResult(status: Array<[string, number, number, number]>): Promise<string> {
    const currentBranch = await this.getCurrentBranch();
    
    
    if (status.length === 0) {
      return `On branch ${currentBranch}\nnothing to commit, working tree clean`;
    }

    const { untracked, modified, staged, deleted } = this.categorizeStatusFiles(status);
    

    let result = `On branch ${currentBranch}\n`;
    
    if (staged.length > 0) {
      result += '\nChanges to be committed:\n';
      staged.forEach(file => result += `  new file:   ${file}\n`);
    }
    
    if (modified.length > 0) {
      result += '\nChanges not staged for commit:\n';
      modified.forEach(file => result += `  modified:   ${file}\n`);
    }
    
    if (deleted.length > 0) {
      if (modified.length === 0) {
        result += '\nChanges not staged for commit:\n';
      }
      deleted.forEach(file => result += `  deleted:    ${file}\n`);
    }
    
    if (untracked.length > 0) {
      result += '\nUntracked files:\n';
      untracked.forEach(file => result += `  ${file}\n`);
      result += '\nnothing added to commit but untracked files present (use "git add" to track)';
    }

    if (staged.length === 0 && modified.length === 0 && untracked.length === 0 && deleted.length === 0) {
      result = `On branch ${currentBranch}\nnothing to commit, working tree clean`;
    }

    return result;
  }

  // ファイルのステータスを分類
  private categorizeStatusFiles(status: Array<[string, number, number, number]>): {
    untracked: string[], modified: string[], staged: string[], deleted: string[]
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
        //console.log(`[git.categorizeStatusFiles] FOUND DELETED FILE (unstaged): ${filepath}`);
        deleted.push(filepath);
      } else if (HEAD === 1 && workdir === 0 && stage === 0) {
        // 削除されたファイル（ステージ済み）- staged deletion
        //console.log(`[git.categorizeStatusFiles] FOUND DELETED FILE (staged): ${filepath}`);
        staged.push(filepath);
      } else if (HEAD === 1 && workdir === 0 && stage === 3) {
        // 削除されてステージされたファイル
        staged.push(filepath);
      } else {
        // その他のケース（HEAD === 1 && workdir === 1 && stage === 1など）は変更なし
        //console.log(`[git.categorizeStatusFiles] No change: ${filepath}`);
      }
    });

    //console.log('[git.categorizeStatusFiles] Results:', { untracked: untracked.length, modified: modified.length, staged: staged.length, deleted: deleted.length });
    
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
      if ((this.fs as any).sync) {
        try {
          await (this.fs as any).sync();
        } catch (syncError) {
          console.warn('[git.add] FileSystem sync failed:', syncError);
        }
      }
      
      if (filepath === '.') {
        // カレントディレクトリの全ファイルを追加
        console.log('[git.add] Processing all files in current directory');
        
        // ステータスマトリックスから全ファイルの状態を取得
        const statusMatrix = await git.statusMatrix({ fs: this.fs, dir: this.dir });
        console.log(`[git.add] Status matrix found ${statusMatrix.length} files`);
        
        let newCount = 0, modifiedCount = 0, deletedCount = 0;
        
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
        
        // onFileOperationコールバックを呼び出してプロジェクトの更新を通知
        if (this.onFileOperation) {
          await this.onFileOperation('.', 'folder');
        }
        
        // 件数ごとに出力
        console.log(`[git.add] Completed: ${newCount} new, ${modifiedCount} modified, ${deletedCount} deleted`);
        return `Added: ${newCount} new, ${modifiedCount} modified, ${deletedCount} deleted files to staging area`;
      } else if (filepath === '*' || filepath.includes('*')) {
        // ワイルドカード対応
        const files = await this.getMatchingFiles(this.dir, filepath);
        
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
        
        if (files.length === 0 && deletedFiles.length === 0) {
          return `No files matching '${filepath}'`;
        }
        
        let addedCount = 0;
        let deletedCount = 0;
        
        // 通常のファイルを追加
        for (const file of files) {
          try {
            await git.add({ fs: this.fs, dir: this.dir, filepath: file });
            addedCount++;
          } catch (addError) {
            console.warn(`[git.add] Failed to add ${file}:`, addError);
          }
        }
        
        // 削除されたファイルをステージング
        for (const file of deletedFiles) {
          // console.log(`[git.add] Staging deleted file: ${file}`);
          try {
            await git.remove({ fs: this.fs, dir: this.dir, filepath: file });
            deletedCount++;
          } catch (removeError) {
            console.warn(`[git.add] Failed to stage deleted file ${file}:`, removeError);
          }
        }
        
        // onFileOperationコールバックを呼び出してプロジェクトの更新を通知
        if (this.onFileOperation) {
          await this.onFileOperation('.', 'folder');
        }
        
        const totalFiles = addedCount + deletedCount;
        return `Added ${addedCount} file(s), staged ${deletedCount} deletion(s) (${totalFiles} total)`;
      } else {
        // 個別ファイル - ファイルの状態を確認
        const fullPath = `${this.dir}/${filepath}`;
        
        // まず現在のステータスを確認して削除ファイルかどうか判定
        const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
        const fileStatus = status.find(([file]) => file === filepath);
        
        if (fileStatus) {
          const [file, head, workdir, stage] = fileStatus;
          
          // 削除されたファイルの場合
          if (head === 1 && workdir === 0 && stage === 1) {
            // console.log(`[git.add] Staging deleted file: ${filepath}`);
            try {
              await git.remove({ fs: this.fs, dir: this.dir, filepath });
              
              // onFileOperationコールバックを呼び出して削除を通知
              if (this.onFileOperation) {
                await this.onFileOperation(filepath, 'delete');
              }
              
              return `Staged deletion of ${filepath}`;
            } catch (removeError) {
              throw new Error(`Failed to stage deletion of ${filepath}: ${(removeError as Error).message}`);
            }
          }
        }
        
        // 通常のファイル（存在するファイル）の場合
        try {
          const stat = await this.fs.promises.stat(fullPath);
        } catch (statError) {
          throw new Error(`pathspec '${filepath}' did not match any files`);
        }
        
        await git.add({ fs: this.fs, dir: this.dir, filepath });
        
        // onFileOperationコールバックを呼び出してプロジェクトの更新を通知
        if (this.onFileOperation) {
          // ファイル内容を読み取って通知
          try {
            const content = await this.fs.promises.readFile(fullPath, 'utf8');
            await this.onFileOperation(filepath, 'file', content);
          } catch (readError) {
            // ファイル読み取りに失敗した場合はファイルタイプのみで通知
            await this.onFileOperation(filepath, 'file');
          }
        }
        
        // 個別ファイル追加後の状態確認
        try {
          const verifyStatus = await git.statusMatrix({ fs: this.fs, dir: this.dir });
          const fileStatus = verifyStatus.find(([file]) => file === filepath);
          if (fileStatus) {
            const [file, head, workdir, stage] = fileStatus;
          } else {
            console.warn(`[git.add] File ${filepath} not found in status matrix after add`);
          }
        } catch (verifyError) {
          console.warn(`[git.add] Failed to verify status after add:`, verifyError);
        }
        
        return `Added ${filepath} to staging area`;
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
  async commit(message: string, author = { name: 'User', email: 'user@pyxis.dev' }): Promise<string> {
    return this.executeGitOperation(async () => {
      await this.ensureGitRepository();
      const sha = await git.commit({
        fs: this.fs,
        dir: this.dir,
        message,
        author,
        committer: author,
      });
      
      // onFileOperationコールバックを呼び出してプロジェクトの更新を通知
      if (this.onFileOperation) {
        // ダミーのフォルダ操作として通知（プロジェクト全体の更新を促す）
        await this.onFileOperation('.', 'folder');
      }
      
      return `[main ${sha.slice(0, 7)}] ${message}`;
    }, 'git commit failed');
  }

  // git reset - ファイルをアンステージング、またはハードリセット
  async reset(options: { filepath?: string; hard?: boolean; commit?: string } = {}): Promise<string> {
    const resetOperations = new GitResetOperations(this.fs, this.dir, this.onFileOperation);
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
    const checkoutOperations = new GitCheckoutOperations(this.fs, this.dir, this.onFileOperation);
    return await checkoutOperations.checkout(branchName, createNew);
  }

  // git revert - コミットを取り消し
  async revert(commitHash: string): Promise<string> {
    const revertOperations = new GitRevertOperations(this.fs, this.dir, this.onFileOperation);
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

      if (deleteFlag && branchName) {
        // ブランチ削除
        try {
          await git.deleteBranch({ fs: this.fs, dir: this.dir, ref: branchName });
          return `Deleted branch ${branchName}`;
        } catch (error) {
          throw new Error(`error: branch '${branchName}' not found.`);
        }
      } else if (branchName) {
        // ブランチ作成
        await git.branch({ fs: this.fs, dir: this.dir, ref: branchName });
        return `Created branch '${branchName}'`;
      } else {
        // ブランチ一覧表示
        const branches = await git.listBranches({ fs: this.fs, dir: this.dir });
        const currentBranch = await this.getCurrentBranch();
        
        if (branches.length === 0) {
          return `* ${currentBranch}`;
        }
        
        return branches.map(branch => 
          branch === currentBranch ? `* ${branch}` : `  ${branch}`
        ).join('\n');
      }
    } catch (error) {
      throw new Error(`git branch failed: ${(error as Error).message}`);
    }
  }

  // git diff - 変更差分を表示
  async diff(options: { staged?: boolean; filepath?: string; commit1?: string; commit2?: string; branchName?: string } = {}): Promise<string> {
    const diffOperations = new GitDiffOperations(this.fs, this.dir);
    return await diffOperations.diff(options);
  }

  // 2つのコミット間の差分
  async diffCommits(commit1: string, commit2: string, filepath?: string): Promise<string> {
    const diffOperations = new GitDiffOperations(this.fs, this.dir);
    return await diffOperations.diffCommits(commit1, commit2, filepath);
  }

  // git merge - ブランチをマージ
  async merge(branchName: string, options: { noFf?: boolean; message?: string; abort?: boolean } = {}): Promise<string> {
    const mergeOperations = new GitMergeOperations(this.fs, this.dir, this.onFileOperation);
    
    if (options.abort) {
      return await mergeOperations.mergeAbort();
    }
    
    return await mergeOperations.merge(branchName, { 
      noFf: options.noFf, 
      message: options.message 
    });
  }

  // ワーキングディレクトリの変更を破棄
  async discardChanges(filepath: string): Promise<string> {
    
    try {
      await this.ensureProjectDirectory();
      
      // Gitリポジトリが初期化されているかチェック
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      // ファイルの状態を確認
      const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
      
      const fileStatus = status.find(([file]) => file === filepath);
      
      if (!fileStatus) {
        return `File ${filepath} not found in git status`;
      }
      
      const [file, HEAD, workdir, stage] = fileStatus;
      console.log(`[Git discardChanges] File status for ${filepath}: HEAD=${HEAD}, workdir=${workdir}, stage=${stage}`);
      
      // HEADが存在するかチェック
      let headCommitHash: string | null = null;
      try {
        headCommitHash = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: 'HEAD' });
      } catch {
        headCommitHash = null;
      }

      // ケース1: HEADが存在しない（初回コミット前）
      if (!headCommitHash) {
        try {
          const fullPath = `${this.dir}/${filepath}`;
          await this.fs.promises.unlink(fullPath);
          
          if (this.onFileOperation) {
            const projectRelativePath = filepath.startsWith('/') ? filepath : `/${filepath}`;
            await this.onFileOperation(projectRelativePath, 'delete');
          }
          
          return `Removed file ${filepath} (no commits yet)`;
        } catch (error) {
          return `File ${filepath} not found or already removed`;
        }
      }

      // ケース2: ファイルがHEADには存在するが、ワーキングディレクトリから削除されている
      if (HEAD === 1 && workdir === 0) {
        try {
          const { blob } = await git.readBlob({ 
            fs: this.fs, 
            dir: this.dir, 
            oid: headCommitHash, 
            filepath 
          });
          const content = new TextDecoder().decode(blob);
          
          const fullPath = `${this.dir}/${filepath}`;
          await this.fs.promises.writeFile(fullPath, content, 'utf8');
          
          if (this.onFileOperation) {
            const projectRelativePath = filepath.startsWith('/') ? filepath : `/${filepath}`;
            await this.onFileOperation(projectRelativePath, 'file', content);
          }
          
          return `Restored deleted file ${filepath}`;
        } catch (error) {
          console.error('Failed to restore deleted file:', error);
          return `Failed to restore ${filepath}`;
        }
      }

      // ケース3: ファイルがHEADには存在し、ワーキングディレクトリでも変更されている
      if (HEAD === 1 && workdir === 2) {
        try {
          const { blob } = await git.readBlob({ 
            fs: this.fs, 
            dir: this.dir, 
            oid: headCommitHash, 
            filepath 
          });
          const content = new TextDecoder().decode(blob);
          
          const fullPath = `${this.dir}/${filepath}`;
          await this.fs.promises.writeFile(fullPath, content, 'utf8');
          
          if (this.onFileOperation) {
            const projectRelativePath = filepath.startsWith('/') ? filepath : `/${filepath}`;
            await this.onFileOperation(projectRelativePath, 'file', content);
          }
          
          return `Discarded changes in ${filepath}`;
        } catch (error) {
          console.error('Failed to discard changes:', error);
          return `Failed to discard changes in ${filepath}`;
        }
      }

      // ケース4: 新規ファイル（HEADに存在しない）- 未追跡ファイル
      if (HEAD === 0 && (workdir === 1 || workdir === 2) && stage === 0) {
        try {
          console.log('[Git discardChanges] Removing untracked file:', filepath);
          const fullPath = `${this.dir}/${filepath}`;
          await this.fs.promises.unlink(fullPath);
          console.log('[Git discardChanges] File unlinked from filesystem:', fullPath);
          
          if (this.onFileOperation) {
            const projectRelativePath = filepath.startsWith('/') ? filepath : `/${filepath}`;
            console.log('[Git discardChanges] Calling onFileOperation for delete:', projectRelativePath);
            await this.onFileOperation(projectRelativePath, 'delete');
            console.log('[Git discardChanges] onFileOperation completed for:', projectRelativePath);
          }
          
          return `Removed untracked file ${filepath}`;
        } catch (error) {
          console.error('[Git discardChanges] Error removing untracked file:', filepath, error);
          return `File ${filepath} not found or already removed`;
        }
      }

      // その他のケース
      return `No changes to discard for ${filepath}`;
      
    } catch (error) {
      const errorMessage = (error as Error).message;
      console.error('Discard changes error:', error);
      
      // 特定のエラーは再スロー
      if (errorMessage.includes('not a git repository')) {
        throw error;
      }
      
      // その他のエラーは詳細なメッセージで包む
      throw new Error(`Failed to discard changes in ${filepath}: ${errorMessage}`);
    }
  }

    // 指定コミット・ファイルの内容を取得 (git show 相当)
  async getFileContentAtCommit(commitId: string, filePath: string): Promise<string> {
    await this.ensureGitRepository();
    try {
      // isomorphic-gitは絶対パスでなくプロジェクト内パスを要求するため、filePathを調整
      let relPath = filePath;
      if (relPath.startsWith('/')) relPath = relPath.slice(1);
      // readBlobでファイル内容取得
      const { blob } = await git.readBlob({ fs: this.fs, dir: this.dir, oid: commitId, filepath: relPath });
      if (!blob) return '';
      // Uint8Array → string
      return new TextDecoder('utf-8').decode(blob);
    } catch (e) {
      // ファイルが存在しない場合は空文字
      return '';
    }
  }
  
}
