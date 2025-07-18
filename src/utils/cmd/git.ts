import FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';
import { getFileSystem, getProjectDir } from '../filesystem';
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

    const { untracked, modified, staged } = this.categorizeStatusFiles(status);
    

    let result = `On branch ${currentBranch}\n`;
    
    if (staged.length > 0) {
      result += '\nChanges to be committed:\n';
      staged.forEach(file => result += `  new file:   ${file}\n`);
    }
    
    if (modified.length > 0) {
      result += '\nChanges not staged for commit:\n';
      modified.forEach(file => result += `  modified:   ${file}\n`);
    }
    
    if (untracked.length > 0) {
      result += '\nUntracked files:\n';
      untracked.forEach(file => result += `  ${file}\n`);
      result += '\nnothing added to commit but untracked files present (use "git add" to track)';
    }

    if (staged.length === 0 && modified.length === 0 && untracked.length === 0) {
      result = `On branch ${currentBranch}\nnothing to commit, working tree clean`;
    }

    return result;
  }

  // ファイルのステータスを分類
  private categorizeStatusFiles(status: Array<[string, number, number, number]>): {
    untracked: string[], modified: string[], staged: string[]
  } {
    const untracked: string[] = [];
    const modified: string[] = [];
    const staged: string[] = [];

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
      } else if (HEAD === 1 && workdir === 0 && stage === 0) {
        // 削除されたファイル（未ステージ）
        modified.push(filepath);
      } else if (HEAD === 1 && workdir === 0 && stage === 3) {
        // 削除されてステージされたファイル
        staged.push(filepath);
      } else {
        // その他のケース（HEAD === 1 && workdir === 1 && stage === 1など）は変更なし
      }
    });

    return { untracked, modified, staged };
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
        const files = await this.getAllFiles(this.dir);
        if (files.length === 0) {
          return 'No files to add';
        }
        
        for (const file of files) {
          try {
            await git.add({ fs: this.fs, dir: this.dir, filepath: file });
          } catch (addError) {
            console.warn(`[git.add] Failed to add ${file}:`, addError);
          }
        }
        
          // ファイル追加後の状態確認と件数集計
          let newCount = 0, modifiedCount = 0, deletedCount = 0;
          try {
            const verifyStatus = await git.statusMatrix({ fs: this.fs, dir: this.dir });
            for (const [file, head, workdir, stage] of verifyStatus) {
              // 新規ファイル: HEAD=0, stage=3 or 2
              if (head === 0 && (stage === 3 || stage === 2)) {
                newCount++;
              }
              // 変更ファイル: HEAD=1, workdir=2, stage=2
              else if (head === 1 && workdir === 2 && stage === 2) {
                modifiedCount++;
              }
              // 削除ファイル: HEAD=1, workdir=0, stage=3
              else if (head === 1 && workdir === 0 && stage === 3) {
                deletedCount++;
              }
            }
          } catch (verifyError) {
            console.warn(`[git.add] Failed to verify status after add:`, verifyError);
          }
          // onFileOperationコールバックを呼び出してプロジェクトの更新を通知
          if (this.onFileOperation) {
            // ダミーのファイル操作として通知（プロジェクト全体の更新を促す）
            await this.onFileOperation('.', 'folder');
          }
          // 件数ごとに出力
          return `Added: ${newCount} new, ${modifiedCount} modified, ${deletedCount} deleted files to staging area`;
      } else if (filepath === '*' || filepath.includes('*')) {
        // ワイルドカード対応
        const files = await this.getMatchingFiles(this.dir, filepath);
        if (files.length === 0) {
          return `No files matching '${filepath}'`;
        }
        
        for (const file of files) {
          try {
            await git.add({ fs: this.fs, dir: this.dir, filepath: file });
          } catch (addError) {
            console.warn(`[git.add] Failed to add ${file}:`, addError);
          }
        }
        
        // onFileOperationコールバックを呼び出してプロジェクトの更新を通知
        if (this.onFileOperation) {
          await this.onFileOperation('.', 'folder');
        }
        
        return `Added ${files.length} file(s) to staging area`;
      } else {
        // 個別ファイル - まずファイルが存在することを確認
        const fullPath = `${this.dir}/${filepath}`;
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
  async diff(options: { staged?: boolean; filepath?: string; commit1?: string; commit2?: string } = {}): Promise<string> {
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

      // ケース4: 新規ファイル（HEADに存在しない）
      if (HEAD === 0 && workdir === 1) {
        try {
          const fullPath = `${this.dir}/${filepath}`;
          await this.fs.promises.unlink(fullPath);
          
          if (this.onFileOperation) {
            const projectRelativePath = filepath.startsWith('/') ? filepath : `/${filepath}`;
            await this.onFileOperation(projectRelativePath, 'delete');
          }
          
          return `Removed untracked file ${filepath}`;
        } catch (error) {
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
}
