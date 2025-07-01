import FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';
import { getFileSystem, getProjectDir } from '../filesystem';

// Git操作クラス
export class GitCommands {
  private fs: FS;
  private dir: string;
  private onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string) => Promise<void>;

  constructor(projectName: string, onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string) => Promise<void>) {
    this.fs = getFileSystem()!;
    this.dir = getProjectDir(projectName);
    this.onFileOperation = onFileOperation;
  }

  // プロジェクトディレクトリの存在を確認し、なければ作成
  private async ensureProjectDirectory(): Promise<void> {
    try {
      await this.fs.promises.stat(this.dir);
    } catch {
      // ディレクトリが存在しない場合は作成
      await this.fs.promises.mkdir(this.dir, { recursive: true } as any);
    }
  }

  // 現在のブランチ名を取得
  async getCurrentBranch(): Promise<string> {
    try {
      await this.ensureProjectDirectory();
      // Gitリポジトリが初期化されているかチェック
      await this.fs.promises.stat(`${this.dir}/.git`);
      
      try {
        const branch = await git.currentBranch({ fs: this.fs, dir: this.dir });
        return branch || 'main';
      } catch {
        return 'main';
      }
    } catch {
      return '(no git)';
    }
  }

  // git init - リポジトリ初期化
  async init(): Promise<string> {
    try {
      await this.ensureProjectDirectory();
      await git.init({ fs: this.fs, dir: this.dir, defaultBranch: 'main' });
      return `Initialized empty Git repository in ${this.dir}`;
    } catch (error) {
      throw new Error(`git init failed: ${(error as Error).message}`);
    }
  }

  // git status - ステータス確認
  async status(): Promise<string> {
    try {
      await this.ensureProjectDirectory();
      console.log('Checking git status for directory:', this.dir);
      
      // Gitリポジトリが初期化されているかチェック
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
        console.log('Git repository found');
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      // ワーキングディレクトリのファイルを確認
      try {
        const files = await this.fs.promises.readdir(this.dir);
        console.log('Files in working directory:', files);
      } catch (dirError) {
        console.warn('Failed to read working directory:', dirError);
      }

      let status: Array<[string, number, number, number]> = [];
      try {
        console.log('Calling git.statusMatrix...');
        status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
        console.log('statusMatrix result:', status);
      } catch (statusError) {
        console.warn('statusMatrix failed, using fallback method:', statusError);
        
        // フォールバック: ファイルシステムを直接チェック
        try {
          const files = await this.fs.promises.readdir(this.dir);
          const projectFiles = [];
          
          // ファイルのみを追加（フォルダは除外）
          for (const file of files) {
            if (file.startsWith('.') || file === '.git') continue;
            
            try {
              const stat = await this.fs.promises.stat(`${this.dir}/${file}`);
              if (stat.isFile()) {
                projectFiles.push(file);
              }
            } catch {
              // stat取得に失敗した場合はスキップ
            }
          }
          
          const currentBranch = await this.getCurrentBranch();
          
          if (projectFiles.length === 0) {
            return `On branch ${currentBranch}\nnothing to commit, working tree clean`;
          }

          // 簡単な変更検知（最後のコミット以降のファイルを未追跡として扱う）
          let result = `On branch ${currentBranch}\n`;
          result += '\nUntracked files:\n';
          projectFiles.forEach(file => result += `  ${file}\n`);
          result += '\nnothing added to commit but untracked files present (use "git add" to track)';
          
          return result;
        } catch (fallbackError) {
          console.error('Fallback status check failed:', fallbackError);
          const currentBranch = await this.getCurrentBranch();
          return `On branch ${currentBranch}\nnothing to commit, working tree clean`;
        }
      }
      
      const currentBranch = await this.getCurrentBranch();
      
      if (status.length === 0) {
        return `On branch ${currentBranch}\nnothing to commit, working tree clean`;
      }

      const untracked: string[] = [];
      const modified: string[] = [];
      const staged: string[] = [];

      status.forEach(([filepath, HEAD, workdir, stage]) => {
        console.log(`File: ${filepath}, HEAD: ${HEAD}, workdir: ${workdir}, stage: ${stage}`);
        
        // isomorphic-gitのstatusMatrixの値の意味:
        // HEAD: 0=ファイルなし, 1=ファイルあり
        // workdir: 0=ファイルなし, 1=ファイルあり, 2=変更あり
        // stage: 0=ステージなし, 1=ステージ済み（変更なし）, 2=ステージ済み（変更あり）, 3=ステージ済み（新規）
        
        if (HEAD === 1 && workdir === 2 && stage === 1) {
          // 変更されたファイル（未ステージ）
          modified.push(filepath);
        } else if (HEAD === 1 && workdir === 2 && stage === 2) {
          // 変更されてステージされたファイル
          staged.push(filepath);
        } else if (HEAD === 0 && workdir === 1 && stage === 0) {
          // 新しいファイル（未追跡）
          untracked.push(filepath);
        } else if (HEAD === 0 && workdir === 1 && stage === 3) {
          // 新しくステージされたファイル
          staged.push(filepath);
        } else if (HEAD === 1 && workdir === 0 && stage === 0) {
          // 削除されたファイル（未ステージ）
          modified.push(filepath);
        } else if (HEAD === 1 && workdir === 0 && stage === 3) {
          // 削除されてステージされたファイル
          staged.push(filepath);
        }
        // その他のケース（HEAD === 1 && workdir === 1 && stage === 1など）は変更なし
      });

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
    } catch (error) {
      throw new Error(`git status failed: ${(error as Error).message}`);
    }
  }

  // git add - ファイルをステージング
  async add(filepath: string): Promise<string> {
    try {
      await this.ensureProjectDirectory();
      if (filepath === '.') {
        // カレントディレクトリの全ファイルを追加
        const files = await this.getAllFiles(this.dir);
        if (files.length === 0) {
          return 'No files to add';
        }
        
        for (const file of files) {
          await git.add({ fs: this.fs, dir: this.dir, filepath: file });
        }
        
        return `Added ${files.length} file(s) to staging area`;
      } else if (filepath === '*' || filepath.includes('*')) {
        // ワイルドカード対応
        const files = await this.getMatchingFiles(this.dir, filepath);
        if (files.length === 0) {
          return `No files matching '${filepath}'`;
        }
        
        for (const file of files) {
          await git.add({ fs: this.fs, dir: this.dir, filepath: file });
        }
        
        return `Added ${files.length} file(s) to staging area`;
      } else {
        // 個別ファイル
        await git.add({ fs: this.fs, dir: this.dir, filepath });
        return `Added ${filepath} to staging area`;
      }
    } catch (error) {
      throw new Error(`git add failed: ${(error as Error).message}`);
    }
  }

  // すべてのファイルを取得（再帰的）
  private async getAllFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    
    const traverse = async (currentPath: string, relativePath: string = '') => {
      try {
        const entries = await this.fs.promises.readdir(currentPath);
        
        for (const entry of entries) {
          // .gitディレクトリは除外
          if (entry === '.git') continue;
          
          const fullPath = `${currentPath}/${entry}`;
          const relativeFilePath = relativePath ? `${relativePath}/${entry}` : entry;
          
          try {
            const stat = await this.fs.promises.stat(fullPath);
            if (stat.isDirectory()) {
              await traverse(fullPath, relativeFilePath);
            } else {
              files.push(relativeFilePath);
            }
          } catch {
            // ファイルアクセスエラーは無視
          }
        }
      } catch {
        // ディレクトリアクセスエラーは無視
      }
    };
    
    await traverse(dirPath);
    return files;
  }

  // パターンにマッチするファイルを取得
  private async getMatchingFiles(dirPath: string, pattern: string): Promise<string[]> {
    const allFiles = await this.getAllFiles(dirPath);
    
    if (pattern === '*') {
      // カレントディレクトリの直接のファイルのみ
      return allFiles.filter(file => !file.includes('/'));
    }
    
    // 簡単なワイルドカードマッチング
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return allFiles.filter(file => regex.test(file));
  }

  // git commit - コミット
  async commit(message: string, author = { name: 'User', email: 'user@pyxis.dev' }): Promise<string> {
    try {
      await this.ensureProjectDirectory();
      const sha = await git.commit({
        fs: this.fs,
        dir: this.dir,
        message,
        author,
        committer: author,
      });
      return `[main ${sha.slice(0, 7)}] ${message}`;
    } catch (error) {
      throw new Error(`git commit failed: ${(error as Error).message}`);
    }
  }

  // git reset - ファイルをアンステージング
  async reset(filepath?: string): Promise<string> {
    try {
      await this.ensureProjectDirectory();
      
      if (filepath) {
        // 特定のファイルをアンステージング
        await git.resetIndex({ fs: this.fs, dir: this.dir, filepath });
        return `Unstaged ${filepath}`;
      } else {
        // 全ファイルをアンステージング - ステージングされたファイルを取得してそれぞれリセット
        const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
        let unstagedCount = 0;
        
        for (const [filepath, HEAD, workdir, stage] of status) {
          if (stage === 3) { // ステージングされたファイル
            await git.resetIndex({ fs: this.fs, dir: this.dir, filepath });
            unstagedCount++;
          }
        }
        
        return `Unstaged ${unstagedCount} file(s)`;
      }
    } catch (error) {
      throw new Error(`git reset failed: ${(error as Error).message}`);
    }
  }

  // git log - ログ表示
  async log(depth = 10): Promise<string> {
    try {
      await this.ensureProjectDirectory();
      const commits = await git.log({ fs: this.fs, dir: this.dir, depth });
      
      if (commits.length === 0) {
        return 'No commits yet';
      }

      return commits.map(commit => {
        const date = new Date(commit.commit.author.timestamp * 1000);
        return `commit ${commit.oid}\n` +
               `Author: ${commit.commit.author.name} <${commit.commit.author.email}>\n` +
               `Date: ${date.toISOString()}\n\n` +
               `    ${commit.commit.message}\n`;
      }).join('\n');
    } catch (error) {
      throw new Error(`git log failed: ${(error as Error).message}`);
    }
  }

  // UI用のGitログを取得（パイプ区切り形式）
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
      
      const commits = await git.log({ fs: this.fs, dir: this.dir, depth });
      console.log('Raw commits found:', commits.length);
      
      if (commits.length === 0) {
        console.log('No commits found');
        return '';
      }

      const formattedCommits = [];
      
      for (const commit of commits) {
        const date = new Date(commit.commit.author.timestamp * 1000);
        // パイプ文字がメッセージに含まれている場合は置き換える
        const safeMessage = (commit.commit.message || 'No message').replace(/\|/g, '｜').replace(/\n/g, ' ');
        const safeName = (commit.commit.author.name || 'Unknown').replace(/\|/g, '｜');
        const safeDate = date.toISOString();
        
        const formatted = `${commit.oid}|${safeMessage}|${safeName}|${safeDate}`;
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

  // git checkout - ブランチ切り替え/作成
  async checkout(branchName: string, createNew = false): Promise<string> {
    try {
      // Gitリポジトリが初期化されているかチェック
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      if (createNew) {
        // 新しいブランチを作成してチェックアウト
        await git.branch({ fs: this.fs, dir: this.dir, ref: branchName });
        await git.checkout({ fs: this.fs, dir: this.dir, ref: branchName });
        return `Switched to a new branch '${branchName}'`;
      } else {
        // 既存のブランチをチェックアウト
        try {
          await git.checkout({ fs: this.fs, dir: this.dir, ref: branchName });
          return `Switched to branch '${branchName}'`;
        } catch (error) {
          // ブランチが存在しない場合の詳細なエラー
          const branches = await git.listBranches({ fs: this.fs, dir: this.dir });
          throw new Error(`pathspec '${branchName}' did not match any file(s) known to git\nAvailable branches: ${branches.join(', ')}`);
        }
      }
    } catch (error) {
      throw new Error(`git checkout failed: ${(error as Error).message}`);
    }
  }

  // git revert - コミットを取り消し
  async revert(commitHash: string): Promise<string> {
    try {
      // Gitリポジトリが初期化されているかチェック
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      // コミットハッシュの正規化（短縮形も対応）
      let fullCommitHash: string;
      try {
        // コミットが存在するかチェックし、完全なハッシュを取得
        const expandedOid = await git.expandOid({ fs: this.fs, dir: this.dir, oid: commitHash });
        fullCommitHash = expandedOid;
      } catch {
        throw new Error(`bad revision '${commitHash}'`);
      }

      // 対象コミットの情報を取得
      const commitToRevert = await git.readCommit({ fs: this.fs, dir: this.dir, oid: fullCommitHash });
      
      // 親コミットが存在するかチェック
      if (commitToRevert.commit.parent.length === 0) {
        throw new Error(`cannot revert initial commit ${commitHash.slice(0, 7)}`);
      }

      // マージコミットの場合はエラー
      if (commitToRevert.commit.parent.length > 1) {
        throw new Error(`commit ${commitHash.slice(0, 7)} is a merge commit`);
      }

      const parentHash = commitToRevert.commit.parent[0];

      // 親コミットの状態を取得
      const parentCommit = await git.readCommit({ fs: this.fs, dir: this.dir, oid: parentHash });
      
      // 対象コミットと親コミットのファイル差分を取得
      const changedFiles = new Set<string>();
      
      // 対象コミットで変更されたファイルを特定
      const currentTree = await git.readTree({ fs: this.fs, dir: this.dir, oid: commitToRevert.commit.tree });
      const parentTree = await git.readTree({ fs: this.fs, dir: this.dir, oid: parentCommit.commit.tree });
      
      // 変更されたファイルパスを収集
      const getAllFilePaths = (tree: any, basePath = ''): string[] => {
        const paths: string[] = [];
        for (const entry of tree.tree) {
          const fullPath = basePath ? `${basePath}/${entry.path}` : entry.path;
          if (entry.type === 'tree') {
            // サブディレクトリは実装上簡略化
            continue;
          } else {
            paths.push(fullPath);
          }
        }
        return paths;
      };

      const currentFiles = new Set(getAllFilePaths(currentTree));
      const parentFiles = new Set(getAllFilePaths(parentTree));

      // 追加、削除、変更されたファイルを特定
      const addedFiles = [...currentFiles].filter(f => !parentFiles.has(f));
      const deletedFiles = [...parentFiles].filter(f => !currentFiles.has(f));
      const commonFiles = [...currentFiles].filter(f => parentFiles.has(f));

      // 変更されたファイルを特定（内容比較）
      const modifiedFiles: string[] = [];
      for (const filePath of commonFiles) {
        try {
          const currentEntry = currentTree.tree.find((e: any) => e.path === filePath);
          const parentEntry = parentTree.tree.find((e: any) => e.path === filePath);
          
          if (currentEntry && parentEntry && currentEntry.oid !== parentEntry.oid) {
            modifiedFiles.push(filePath);
          }
        } catch {
          // ファイル比較エラーは無視
        }
      }

      let revertedFileCount = 0;
      const revertResults: string[] = [];

      // 追加されたファイルを削除
      for (const filePath of addedFiles) {
        try {
          const fullPath = `${this.dir}/${filePath}`;
          await this.fs.promises.unlink(fullPath);
          changedFiles.add(filePath);
          revertResults.push(`deleted:    ${filePath}`);
          revertedFileCount++;
        } catch (error) {
          console.warn(`Failed to delete file ${filePath}:`, error);
        }
      }

      // 削除されたファイルを復元
      for (const filePath of deletedFiles) {
        try {
          const parentEntry = parentTree.tree.find((e: any) => e.path === filePath);
          if (parentEntry) {
            const blob = await git.readBlob({ fs: this.fs, dir: this.dir, oid: parentEntry.oid });
            const fullPath = `${this.dir}/${filePath}`;
            
            // 親ディレクトリを作成
            const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
            if (parentDir && parentDir !== this.dir) {
              await this.fs.promises.mkdir(parentDir, { recursive: true } as any);
            }
            
            await this.fs.promises.writeFile(fullPath, blob.blob);
            changedFiles.add(filePath);
            revertResults.push(`restored:   ${filePath}`);
            revertedFileCount++;
          }
        } catch (error) {
          console.warn(`Failed to restore file ${filePath}:`, error);
        }
      }

      // 変更されたファイルを親コミットの状態に戻す
      for (const filePath of modifiedFiles) {
        try {
          const parentEntry = parentTree.tree.find((e: any) => e.path === filePath);
          if (parentEntry) {
            const blob = await git.readBlob({ fs: this.fs, dir: this.dir, oid: parentEntry.oid });
            const fullPath = `${this.dir}/${filePath}`;
            await this.fs.promises.writeFile(fullPath, blob.blob);
            changedFiles.add(filePath);
            revertResults.push(`reverted:   ${filePath}`);
            revertedFileCount++;
          }
        } catch (error) {
          console.warn(`Failed to revert file ${filePath}:`, error);
        }
      }

      // 変更をステージング
      for (const filePath of changedFiles) {
        try {
          const fullPath = `${this.dir}/${filePath}`;
          // ファイルが存在するかチェック
          try {
            await this.fs.promises.stat(fullPath);
            await git.add({ fs: this.fs, dir: this.dir, filepath: filePath });
          } catch {
            // ファイルが削除された場合
            await git.remove({ fs: this.fs, dir: this.dir, filepath: filePath });
          }
        } catch (error) {
          console.warn(`Failed to stage file ${filePath}:`, error);
        }
      }

      // リバートコミットを作成
      const revertMessage = `Revert "${commitToRevert.commit.message.split('\n')[0]}"\n\nThis reverts commit ${fullCommitHash}.`;
      const author = { name: 'User', email: 'user@pyxis.dev' };
      
      const revertCommitHash = await git.commit({
        fs: this.fs,
        dir: this.dir,
        message: revertMessage,
        author,
        committer: author,
      });

      // プロジェクトディレクトリからの相対パスを取得
      const getRelativePathFromProject = (fullPath: string): string => {
        return fullPath.replace(this.dir, '') || '/';
      };

      // ファイル操作のコールバックを実行（テキストエディターに反映）
      if (this.onFileOperation) {
        for (const filePath of changedFiles) {
          try {
            const relativePath = getRelativePathFromProject(`${this.dir}/${filePath}`);
            const fullPath = `${this.dir}/${filePath}`;
            
            // ファイルが存在するかチェック
            try {
              const content = await this.fs.promises.readFile(fullPath, { encoding: 'utf8' });
              await this.onFileOperation(relativePath, 'file', content as string);
            } catch {
              // ファイルが削除された場合
              await this.onFileOperation(relativePath, 'delete');
            }
          } catch (error) {
            console.warn(`Failed to sync file operation for ${filePath}:`, error);
          }
        }
      }

      // 結果メッセージを生成
      let result = `Revert commit ${revertCommitHash.slice(0, 7)} created\n`;
      result += `Reverted commit: ${fullCommitHash.slice(0, 7)} - ${commitToRevert.commit.message.split('\n')[0]}\n`;
      
      if (revertResults.length > 0) {
        result += `\nFiles changed:\n${revertResults.join('\n')}`;
      }
      
      result += `\n\nTotal ${revertedFileCount} file(s) reverted`;

      return result;
    } catch (error) {
      const errorMessage = (error as Error).message;
      
      // エラーメッセージを適切にフォーマット
      if (errorMessage.includes('bad revision')) {
        throw new Error(`fatal: bad revision '${commitHash}'`);
      } else if (errorMessage.includes('not a git repository')) {
        throw new Error('fatal: not a git repository (or any of the parent directories): .git');
      } else if (errorMessage.includes('cannot revert initial commit')) {
        throw new Error(`error: ${errorMessage}`);
      } else if (errorMessage.includes('is a merge commit')) {
        throw new Error(`error: ${errorMessage}\nhint: Try 'git revert -m 1 <commit>' to revert a merge commit`);
      }
      
      throw new Error(`git revert failed: ${errorMessage}`);
    }
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
}
