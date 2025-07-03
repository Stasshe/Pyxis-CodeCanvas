import FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';
import { getFileSystem, getProjectDir } from '../filesystem';
import { GitRevertOperations } from './gitOperations/revert';
import { GitCheckoutOperations } from './gitOperations/checkout';
import { GitFileSystemHelper } from './gitOperations/fileSystemHelper';
import { GitLogOperations } from './gitOperations/log';
import { GitResetOperations } from './gitOperations/reset';

/**
 * Git操作を管理するクラス
 * isomorphic-gitを使用してブラウザ環境でGit操作を実現
 */
export class GitCommands {
  private fs: FS;
  private dir: string;
  private onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string) => Promise<void>;

  constructor(projectName: string, onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string) => Promise<void>) {
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
      console.log(`[git.status] statusMatrix successful with ${status.length} files`);
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
    
    console.log(`[git.formatStatusResult] Processing ${status.length} files for formatting`);
    console.log(`[git.formatStatusResult] Raw status matrix:`, status);
    
    if (status.length === 0) {
      return `On branch ${currentBranch}\nnothing to commit, working tree clean`;
    }

    const { untracked, modified, staged } = this.categorizeStatusFiles(status);
    
    console.log(`[git.formatStatusResult] Categorized results:`);
    console.log(`- Staged: ${staged.length} files`, staged);
    console.log(`- Modified: ${modified.length} files`, modified);
    console.log(`- Untracked: ${untracked.length} files`, untracked);

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
      console.log(`[git.formatStatusResult] No changes detected, returning clean status`);
      result = `On branch ${currentBranch}\nnothing to commit, working tree clean`;
    }

    console.log(`[git.formatStatusResult] Final result:`, result);
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
        //console.log(`[git.categorizeStatusFiles] → Untracked: ${filepath}`);
        untracked.push(filepath);
      } else if (HEAD === 0 && stage === 3) {
        // 新しくステージされたファイル（stage=3の場合）
        //console.log(`[git.categorizeStatusFiles] → Staged (new, stage=3): ${filepath}`);
        staged.push(filepath);
      } else if (HEAD === 0 && stage === 2) {
        // 新しくステージされたファイル（stage=2の場合）
        //console.log(`[git.categorizeStatusFiles] → Staged (new, stage=2): ${filepath}`);
        staged.push(filepath);
      } else if (HEAD === 1 && workdir === 2 && stage === 1) {
        // 変更されたファイル（未ステージ）
        //console.log(`[git.categorizeStatusFiles] → Modified (unstaged): ${filepath}`);
        modified.push(filepath);
      } else if (HEAD === 1 && workdir === 2 && stage === 2) {
        // 変更されてステージされたファイル
        //console.log(`[git.categorizeStatusFiles] → Staged (modified): ${filepath}`);
        staged.push(filepath);
      } else if (HEAD === 1 && workdir === 0 && stage === 0) {
        // 削除されたファイル（未ステージ）
        //console.log(`[git.categorizeStatusFiles] → Modified (deleted, unstaged): ${filepath}`);
        modified.push(filepath);
      } else if (HEAD === 1 && workdir === 0 && stage === 3) {
        // 削除されてステージされたファイル
        //console.log(`[git.categorizeStatusFiles] → Staged (deleted): ${filepath}`);
        staged.push(filepath);
      } else {
        // その他のケース（HEAD === 1 && workdir === 1 && stage === 1など）は変更なし
        console.log(`[git.categorizeStatusFiles] → No changes: ${filepath}`);
      }
    });

    console.log(`[git.categorizeStatusFiles] Final counts - Untracked: ${untracked.length}, Modified: ${modified.length}, Staged: ${staged.length}`);
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
          console.log('[git.add] FileSystem synced');
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
            console.log(`[git.add] Added file: ${file}`);
          } catch (addError) {
            console.warn(`[git.add] Failed to add ${file}:`, addError);
          }
        }
        
        // ファイル追加後の状態確認
        console.log(`[git.add] Verifying staging status after adding ${files.length} files...`);
        try {
          const verifyStatus = await git.statusMatrix({ fs: this.fs, dir: this.dir });
          console.log(`[git.add] Post-add status matrix:`, verifyStatus);
          
          const stagedFiles = verifyStatus.filter(([file, head, workdir, stage]) => 
            stage === 3 || stage === 2
          );
          console.log(`[git.add] Files in staging area:`, stagedFiles.map(([file]) => file));
        } catch (verifyError) {
          console.warn(`[git.add] Failed to verify status after add:`, verifyError);
        }
        
        // onFileOperationコールバックを呼び出してプロジェクトの更新を通知
        if (this.onFileOperation) {
          console.log('[git.add] Triggering project refresh after adding all files');
          // ダミーのファイル操作として通知（プロジェクト全体の更新を促す）
          await this.onFileOperation('.', 'folder');
        }
        
        return `Added ${files.length} file(s) to staging area`;
      } else if (filepath === '*' || filepath.includes('*')) {
        // ワイルドカード対応
        const files = await this.getMatchingFiles(this.dir, filepath);
        if (files.length === 0) {
          return `No files matching '${filepath}'`;
        }
        
        for (const file of files) {
          try {
            await git.add({ fs: this.fs, dir: this.dir, filepath: file });
            console.log(`[git.add] Added file: ${file}`);
          } catch (addError) {
            console.warn(`[git.add] Failed to add ${file}:`, addError);
          }
        }
        
        // onFileOperationコールバックを呼び出してプロジェクトの更新を通知
        if (this.onFileOperation) {
          console.log('[git.add] Triggering project refresh after adding wildcard files');
          await this.onFileOperation('.', 'folder');
        }
        
        return `Added ${files.length} file(s) to staging area`;
      } else {
        // 個別ファイル - まずファイルが存在することを確認
        const fullPath = `${this.dir}/${filepath}`;
        try {
          const stat = await this.fs.promises.stat(fullPath);
          console.log(`[git.add] File exists: ${filepath}, size: ${stat.size}`);
        } catch (statError) {
          throw new Error(`pathspec '${filepath}' did not match any files`);
        }
        
        await git.add({ fs: this.fs, dir: this.dir, filepath });
        console.log(`[git.add] Added file: ${filepath}`);
        
        // onFileOperationコールバックを呼び出してプロジェクトの更新を通知
        if (this.onFileOperation) {
          console.log('[git.add] Triggering project refresh after adding individual file:', filepath);
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
        console.log(`[git.add] Verifying staging status for file: ${filepath}`);
        try {
          const verifyStatus = await git.statusMatrix({ fs: this.fs, dir: this.dir });
          const fileStatus = verifyStatus.find(([file]) => file === filepath);
          if (fileStatus) {
            const [file, head, workdir, stage] = fileStatus;
            console.log(`[git.add] File ${file} status: HEAD=${head}, workdir=${workdir}, stage=${stage}`);
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
        console.log('[git.commit] Triggering project refresh after commit');
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
    try {
      await this.ensureProjectDirectory();
      
      // Gitリポジトリが初期化されているかチェック
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      const { staged, filepath, commit1, commit2 } = options;

      if (commit1 && commit2) {
        // 2つのコミット間の差分
        return await this.diffCommits(commit1, commit2, filepath);
      } else if (staged) {
        // ステージされた変更の差分
        return await this.diffStaged(filepath);
      } else {
        // ワーキングディレクトリの変更差分
        return await this.diffWorkingDirectory(filepath);
      }
    } catch (error) {
      throw new Error(`git diff failed: ${(error as Error).message}`);
    }
  }

  // ワーキングディレクトリの変更差分
  private async diffWorkingDirectory(filepath?: string): Promise<string> {
    try {
      // HEADの実際のコミットハッシュを取得
      let headCommitHash: string | null = null;
      try {
        headCommitHash = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: 'HEAD' });
      } catch {
        // HEADが存在しない場合
        headCommitHash = null;
      }

      if (!headCommitHash) {
        return 'No commits yet - cannot show diff';
      }

      const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
      const diffs: string[] = [];

      for (const [file, HEAD, workdir, stage] of status) {
        // 特定ファイルが指定されている場合はそのファイルのみ
        if (filepath && file !== filepath) continue;
        
        // 変更されたファイルのみ処理
        if (HEAD === 1 && workdir === 2) {
          try {
            // 変更されたファイル: HEADと現在のワーキングディレクトリを比較
            let headContent = '';
            let workContent = '';
            
            // HEADからの内容
            try {
              const { blob } = await git.readBlob({ fs: this.fs, dir: this.dir, oid: headCommitHash, filepath: file });
              headContent = new TextDecoder().decode(blob);
            } catch {
              headContent = '';
            }
            
            // ワーキングディレクトリの内容
            try {
              workContent = await this.fs.promises.readFile(`${this.dir}/${file}`, 'utf8');
            } catch {
              workContent = '';
            }
            
            const diff = this.formatDiff(file, headContent, workContent);
            if (diff) diffs.push(diff);
          } catch (error) {
            console.warn(`Failed to generate diff for ${file}:`, error);
          }
        } else if (HEAD === 0 && workdir === 1) {
          // 新規ファイル
          try {
            let workContent = '';
            try {
              workContent = await this.fs.promises.readFile(`${this.dir}/${file}`, 'utf8');
            } catch {
              workContent = '';
            }
            
            const diff = this.formatDiff(file, '', workContent);
            if (diff) diffs.push(diff);
          } catch (error) {
            console.warn(`Failed to generate diff for new file ${file}:`, error);
          }
        } else if (HEAD === 1 && workdir === 0) {
          // 削除されたファイル
          try {
            let headContent = '';
            try {
              const { blob } = await git.readBlob({ fs: this.fs, dir: this.dir, oid: headCommitHash, filepath: file });
              headContent = new TextDecoder().decode(blob);
            } catch {
              headContent = '';
            }
            
            const diff = this.formatDiff(file, headContent, '');
            if (diff) diffs.push(diff);
          } catch (error) {
            console.warn(`Failed to generate diff for deleted file ${file}:`, error);
          }
        }
      }

      return diffs.length > 0 ? diffs.join('\n\n') : 'No changes';
    } catch (error) {
      throw new Error(`Failed to get working directory diff: ${(error as Error).message}`);
    }
  }

  // ステージされた変更の差分
  private async diffStaged(filepath?: string): Promise<string> {
    try {
      // HEADの実際のコミットハッシュを取得
      let headCommitHash: string | null = null;
      try {
        headCommitHash = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: 'HEAD' });
      } catch {
        // HEADが存在しない場合
        headCommitHash = null;
      }

      if (!headCommitHash) {
        return 'No commits yet - cannot show staged diff';
      }

      const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
      const diffs: string[] = [];

      for (const [file, HEAD, workdir, stage] of status) {
        // 特定ファイルが指定されている場合はそのファイルのみ
        if (filepath && file !== filepath) continue;
        
        // ステージされたファイルのみ処理
        if (stage === 2 || stage === 3) {
          try {
            // ステージされた内容と現在のワーキングディレクトリの差分
            const diff = await this.generateStagedDiff(file, headCommitHash);
            if (diff) diffs.push(diff);
          } catch (error) {
            console.warn(`Failed to generate staged diff for ${file}:`, error);
          }
        }
      }

      return diffs.length > 0 ? diffs.join('\n\n') : 'No staged changes';
    } catch (error) {
      throw new Error(`Failed to get staged diff: ${(error as Error).message}`);
    }
  }

  // 2つのコミット間の差分
  async diffCommits(commit1: string, commit2: string, filepath?: string): Promise<string> {
    try {
      console.log('diffCommits called with:', { commit1, commit2, filepath });
      
      // コミットハッシュを正規化
      let fullCommit1: string;
      let fullCommit2: string;
      
      try {
        fullCommit1 = await git.expandOid({ fs: this.fs, dir: this.dir, oid: commit1 });
        console.log('Expanded commit1:', commit1, '->', fullCommit1);
      } catch (error) {
        throw new Error(`Invalid commit1 '${commit1}': ${(error as Error).message}`);
      }
      
      try {
        fullCommit2 = await git.expandOid({ fs: this.fs, dir: this.dir, oid: commit2 });
        console.log('Expanded commit2:', commit2, '->', fullCommit2);
      } catch (error) {
        throw new Error(`Invalid commit2 '${commit2}': ${(error as Error).message}`);
      }

      // 各コミットの情報を取得
      const commit1Obj = await git.readCommit({ fs: this.fs, dir: this.dir, oid: fullCommit1 });
      const commit2Obj = await git.readCommit({ fs: this.fs, dir: this.dir, oid: fullCommit2 });

      const tree1 = await git.readTree({ fs: this.fs, dir: this.dir, oid: commit1Obj.commit.tree });
      const tree2 = await git.readTree({ fs: this.fs, dir: this.dir, oid: commit2Obj.commit.tree });

      const diffs: string[] = [];
      
      // 各ツリーのファイル一覧を取得
      const files1 = this.getTreeFilePaths(tree1);
      const files2 = this.getTreeFilePaths(tree2);
      const allFiles = new Set([...files1, ...files2]);

      for (const file of allFiles) {
        // 特定ファイルが指定されている場合はそのファイルのみ
        if (filepath && file !== filepath) continue;

        try {
          const diff = await this.generateCommitFileDiff(file, fullCommit1, fullCommit2);
          if (diff) diffs.push(diff);
        } catch (error) {
          console.warn(`Failed to generate commit diff for ${file}:`, error);
        }
      }

      return diffs.length > 0 ? diffs.join('\n\n') : 'No differences between commits';
    } catch (error) {
      console.error('diffCommits error:', error);
      throw new Error(`Failed to diff commits: ${(error as Error).message}`);
    }
  }

  // ツリーからファイルパスを取得（再帰的）
  private getTreeFilePaths(tree: any, basePath = ''): string[] {
    const paths: string[] = [];
    
    for (const entry of tree.tree) {
      const fullPath = basePath ? `${basePath}/${entry.path}` : entry.path;
      
      if (entry.type === 'blob') {
        paths.push(fullPath);
      } else if (entry.type === 'tree') {
        // サブツリーも再帰的に処理
        try {
          const subTree = { tree: [entry] }; // 簡略化のため、実際の再帰は省略
          paths.push(fullPath + '/'); // フォルダを示す
        } catch {
          // サブツリーの処理に失敗した場合はスキップ
        }
      }
    }
    
    return paths;
  }


  // ステージされた差分を生成
  private async generateStagedDiff(filepath: string, headCommitHash: string): Promise<string> {
    try {
      // HEADからの内容
      let headContent = '';
      try {
        const { blob } = await git.readBlob({ fs: this.fs, dir: this.dir, oid: headCommitHash, filepath });
        headContent = new TextDecoder().decode(blob);
      } catch {
        headContent = '';
      }

      // ワーキングディレクトリの内容
      let workContent = '';
      try {
        workContent = await this.fs.promises.readFile(`${this.dir}/${filepath}`, 'utf8');
      } catch {
        workContent = '';
      }

      // ステージングの状態を確認
      const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
      const fileStatus = status.find(([file]) => file === filepath);
      
      if (!fileStatus) {
        return '';
      }

      const [, HEAD, workdir, stage] = fileStatus;
      
      if (stage === 3) {
        // 新規ファイルがステージされた場合
        return this.formatDiff(filepath, '', workContent);
      } else if (stage === 2) {
        // 変更されたファイルがステージされた場合
        return this.formatDiff(filepath, headContent, workContent);
      }

      return '';
    } catch (error) {
      throw new Error(`Failed to generate staged diff: ${(error as Error).message}`);
    }
  }

  // コミット間のファイル差分を生成
  private async generateCommitFileDiff(filepath: string, commit1: string, commit2: string): Promise<string> {
    let content1 = '';
    let content2 = '';

    try {
      // コミット1のファイル内容
      try {
        const { blob } = await git.readBlob({ fs: this.fs, dir: this.dir, oid: commit1, filepath });
        content1 = new TextDecoder().decode(blob);
      } catch {
        // ファイルがコミット1に存在しない
        content1 = '';
      }

      // コミット2のファイル内容
      try {
        const { blob } = await git.readBlob({ fs: this.fs, dir: this.dir, oid: commit2, filepath });
        content2 = new TextDecoder().decode(blob);
      } catch {
        // ファイルがコミット2に存在しない
        content2 = '';
      }

      // 内容が同じ場合は差分なし
      if (content1 === content2) {
        return '';
      }

      return this.formatDiff(filepath, content1, content2);
    } catch (error) {
      console.warn(`Failed to generate commit file diff for ${filepath}:`, error);
      return '';
    }
  }

  // 差分を見やすい形式でフォーマット
  private formatDiff(filepath: string, oldContent: string, newContent: string): string {
    if (oldContent === newContent) {
      return '';
    }

    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    
    let result = `diff --git a/${filepath} b/${filepath}\n`;
    
    if (oldContent === '') {
      result += `new file mode 100644\n`;
      result += `index 0000000..${this.generateShortHash(newContent)}\n`;
      result += `--- /dev/null\n`;
      result += `+++ b/${filepath}\n`;
      result += `@@ -0,0 +1,${newLines.length} @@\n`;
      newLines.forEach(line => result += `+${line}\n`);
    } else if (newContent === '') {
      result += `deleted file mode 100644\n`;
      result += `index ${this.generateShortHash(oldContent)}..0000000\n`;
      result += `--- a/${filepath}\n`;
      result += `+++ /dev/null\n`;
      result += `@@ -1,${oldLines.length} +0,0 @@\n`;
      oldLines.forEach(line => result += `-${line}\n`);
    } else {
      result += `index ${this.generateShortHash(oldContent)}..${this.generateShortHash(newContent)} 100644\n`;
      result += `--- a/${filepath}\n`;
      result += `+++ b/${filepath}\n`;
      
      // 簡単な差分表示（行単位での比較）
      result += this.generateLineDiff(oldLines, newLines);
    }
    
    return result;
  }

  // 行単位での差分を生成
  private generateLineDiff(oldLines: string[], newLines: string[]): string {
    const maxLines = Math.max(oldLines.length, newLines.length);
    let result = '';
    let diffSections: Array<{start: number, oldCount: number, newCount: number, lines: string[]}> = [];
    let currentSection: {start: number, oldCount: number, newCount: number, lines: string[]} | null = null;
    
    for (let i = 0; i < maxLines; i++) {
      const oldLine = i < oldLines.length ? oldLines[i] : undefined;
      const newLine = i < newLines.length ? newLines[i] : undefined;
      
      if (oldLine !== newLine) {
        // 差分が発見された場合、新しいセクションを開始
        if (!currentSection) {
          currentSection = {
            start: i + 1,
            oldCount: 0,
            newCount: 0,
            lines: []
          };
        }
        
        if (oldLine !== undefined && newLine !== undefined) {
          // 変更された行
          currentSection.lines.push(`-${oldLine}`);
          currentSection.lines.push(`+${newLine}`);
          currentSection.oldCount++;
          currentSection.newCount++;
        } else if (oldLine !== undefined) {
          // 削除された行
          currentSection.lines.push(`-${oldLine}`);
          currentSection.oldCount++;
        } else if (newLine !== undefined) {
          // 追加された行
          currentSection.lines.push(`+${newLine}`);
          currentSection.newCount++;
        }
      } else if (currentSection) {
        // 差分がないが、現在のセクションに含める（コンテキスト）
        if (oldLine !== undefined) {
          currentSection.lines.push(` ${oldLine}`);
        }
        
        // セクションが長くなりすぎた場合は終了
        if (currentSection.lines.length > 10) {
          diffSections.push(currentSection);
          currentSection = null;
        }
      }
    }
    
    // 最後のセクションを追加
    if (currentSection) {
      diffSections.push(currentSection);
    }
    
    // セクションが空の場合は簡単な差分表示
    if (diffSections.length === 0) {
      result += `@@ -1,${oldLines.length} +1,${newLines.length} @@\n`;
      const maxLines = Math.max(oldLines.length, newLines.length);
      for (let i = 0; i < maxLines; i++) {
        if (i < oldLines.length && i < newLines.length) {
          if (oldLines[i] !== newLines[i]) {
            result += `-${oldLines[i]}\n`;
            result += `+${newLines[i]}\n`;
          } else {
            result += ` ${oldLines[i]}\n`;
          }
        } else if (i < oldLines.length) {
          result += `-${oldLines[i]}\n`;
        } else if (i < newLines.length) {
          result += `+${newLines[i]}\n`;
        }
      }
    } else {
      // 各セクションを出力
      diffSections.forEach(section => {
        result += `@@ -${section.start},${section.oldCount} +${section.start},${section.newCount} @@\n`;
        result += section.lines.join('\n') + '\n';
      });
    }
    
    return result;
  }

  // 内容から短いハッシュを生成（簡略化）
  private generateShortHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32bit整数に変換
    }
    return Math.abs(hash).toString(16).substring(0, 7);
  }

  // ワーキングディレクトリの変更を破棄
  async discardChanges(filepath: string): Promise<string> {
    console.log('=== discardChanges called ===');
    console.log('filepath:', filepath);
    console.log('dir:', this.dir);
    
    try {
      await this.ensureProjectDirectory();
      
      // Gitリポジトリが初期化されているかチェック
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
        console.log('Git repository found');
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      // ファイルの状態を確認
      const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
      console.log('Full status matrix:', status);
      
      const fileStatus = status.find(([file]) => file === filepath);
      console.log('File status for', filepath, ':', fileStatus);
      
      if (!fileStatus) {
        console.log('File not found in git status');
        return `File ${filepath} not found in git status`;
      }
      
      const [file, HEAD, workdir, stage] = fileStatus;
      console.log(`File: ${file}, HEAD: ${HEAD}, workdir: ${workdir}, stage: ${stage}`);
      
      // HEADが存在するかチェック
      let headCommitHash: string | null = null;
      try {
        headCommitHash = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: 'HEAD' });
        console.log('HEAD commit hash:', headCommitHash);
      } catch {
        console.log('HEAD does not exist');
        headCommitHash = null;
      }

      // ケース1: HEADが存在しない（初回コミット前）
      if (!headCommitHash) {
        console.log('Case 1: No HEAD, removing file');
        try {
          const fullPath = `${this.dir}/${filepath}`;
          console.log('Removing file at:', fullPath);
          await this.fs.promises.unlink(fullPath);
          
          console.log('Calling onFileOperation callback');
          if (this.onFileOperation) {
            const projectRelativePath = filepath.startsWith('/') ? filepath : `/${filepath}`;
            await this.onFileOperation(projectRelativePath, 'delete');
            console.log('onFileOperation callback completed');
          }
          
          return `Removed file ${filepath} (no commits yet)`;
        } catch (error) {
          console.log('File removal failed:', error);
          return `File ${filepath} not found or already removed`;
        }
      }

      // ケース2: ファイルがHEADには存在するが、ワーキングディレクトリから削除されている
      if (HEAD === 1 && workdir === 0) {
        console.log('Case 2: File deleted, restoring from HEAD');
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
          console.log('File restored to:', fullPath);
          
          if (this.onFileOperation) {
            const projectRelativePath = filepath.startsWith('/') ? filepath : `/${filepath}`;
            await this.onFileOperation(projectRelativePath, 'file', content);
            console.log('onFileOperation callback completed for restore');
          }
          
          return `Restored deleted file ${filepath}`;
        } catch (error) {
          console.error('Failed to restore deleted file:', error);
          return `Failed to restore ${filepath}`;
        }
      }

      // ケース3: ファイルがHEADには存在し、ワーキングディレクトリでも変更されている
      if (HEAD === 1 && workdir === 2) {
        console.log('Case 3: File modified, reverting to HEAD');
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
          console.log('File reverted to:', fullPath);
          
          if (this.onFileOperation) {
            const projectRelativePath = filepath.startsWith('/') ? filepath : `/${filepath}`;
            await this.onFileOperation(projectRelativePath, 'file', content);
            console.log('onFileOperation callback completed for revert');
          }
          
          return `Discarded changes in ${filepath}`;
        } catch (error) {
          console.error('Failed to discard changes:', error);
          return `Failed to discard changes in ${filepath}`;
        }
      }

      // ケース4: 新規ファイル（HEADに存在しない）
      if (HEAD === 0 && workdir === 1) {
        console.log('Case 4: Untracked file, removing');
        try {
          const fullPath = `${this.dir}/${filepath}`;
          await this.fs.promises.unlink(fullPath);
          console.log('Untracked file removed:', fullPath);
          
          if (this.onFileOperation) {
            const projectRelativePath = filepath.startsWith('/') ? filepath : `/${filepath}`;
            await this.onFileOperation(projectRelativePath, 'delete');
            console.log('onFileOperation callback completed for untracked removal');
          }
          
          return `Removed untracked file ${filepath}`;
        } catch (error) {
          console.log('Untracked file removal failed:', error);
          return `File ${filepath} not found or already removed`;
        }
      }

      // その他のケース
      console.log('No matching case for file status');
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
