import FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';

// 仮想ファイルシステムのインスタンス
let fs: FS | null = null;

// ファイルシステムの初期化
export const initializeFileSystem = () => {
  if (typeof window !== 'undefined' && !fs) {
    fs = new FS('pyxis-fs');
  }
  return fs;
};

// ファイルシステムの取得
export const getFileSystem = () => {
  if (!fs) {
    return initializeFileSystem();
  }
  return fs;
};

// プロジェクトのベースディレクトリ
export const getProjectDir = (projectName: string) => `/projects/${projectName}`;

// プロジェクトファイルをターミナルファイルシステムに同期
export const syncProjectFiles = async (projectName: string, files: Array<{ path: string; content?: string; type: 'file' | 'folder' }>) => {
  const fs = getFileSystem();
  if (!fs) return;

  const projectDir = getProjectDir(projectName);
  
  try {
    // プロジェクトディレクトリを作成
    try {
      await fs.promises.mkdir(projectDir, { recursive: true } as any);
    } catch {
      // ディレクトリが既に存在する場合は無視
    }
    
    // 既存のファイルをクリア（.gitディレクトリは保持）
    try {
      const existingFiles = await fs.promises.readdir(projectDir);
      for (const file of existingFiles) {
        if (file !== '.git') {
          const filePath = `${projectDir}/${file}`;
          try {
            const stat = await fs.promises.stat(filePath);
            if (stat.isDirectory()) {
              await removeDirectoryRecursive(fs, filePath);
            } else {
              await fs.promises.unlink(filePath);
            }
          } catch {
            // ファイル削除エラーは無視
          }
        }
      }
    } catch {
      // ディレクトリが存在しない場合は無視
    }

    // ディレクトリを先に作成
    const directories = files.filter(f => f.type === 'folder').sort((a, b) => a.path.length - b.path.length);
    for (const dir of directories) {
      const fullPath = `${projectDir}${dir.path}`;
      try {
        await fs.promises.mkdir(fullPath, { recursive: true } as any);
      } catch {
        // ディレクトリ作成エラーは無視
      }
    }

    // ファイルを作成
    const fileItems = files.filter(f => f.type === 'file');
    for (const file of fileItems) {
      const fullPath = `${projectDir}${file.path}`;
      
      // 親ディレクトリが存在することを確認
      const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
      if (parentDir && parentDir !== projectDir) {
        try {
          await fs.promises.mkdir(parentDir, { recursive: true } as any);
        } catch {
          // ディレクトリ作成エラーは無視
        }
      }
      
      try {
        await fs.promises.writeFile(fullPath, file.content || '');
      } catch (error) {
        console.warn(`Failed to sync file ${fullPath}:`, error);
      }
    }
  } catch (error) {
    console.error('Failed to sync project files:', error);
  }
};

// ディレクトリを再帰的に削除するヘルパー関数
const removeDirectoryRecursive = async (fs: any, dirPath: string): Promise<void> => {
  try {
    const files = await fs.promises.readdir(dirPath);
    
    for (const file of files) {
      const filePath = `${dirPath}/${file}`;
      const stat = await fs.promises.stat(filePath);
      
      if (stat.isDirectory()) {
        await removeDirectoryRecursive(fs, filePath);
      } else {
        await fs.promises.unlink(filePath);
      }
    }
    
    await fs.promises.rmdir(dirPath);
  } catch {
    // エラーは無視
  }
};

// UNIXライクなコマンド実装
export class UnixCommands {
  private fs: FS;
  private currentDir: string;

  constructor(projectName: string) {
    this.fs = getFileSystem()!;
    this.currentDir = getProjectDir(projectName);
    // プロジェクトディレクトリが存在しない場合は作成
    this.ensureProjectDirectory();
  }

  // プロジェクトディレクトリの存在を確認し、なければ作成
  private async ensureProjectDirectory(): Promise<void> {
    try {
      await this.fs.promises.stat(this.currentDir);
    } catch {
      // ディレクトリが存在しない場合は作成
      await this.fs.promises.mkdir(this.currentDir, { recursive: true } as any);
    }
  }

  // pwd - 現在のディレクトリを表示
  pwd(): string {
    return this.currentDir;
  }

  // 現在のディレクトリをワークスペース相対パスで取得
  getRelativePath(): string {
    const projectBase = this.currentDir.split('/')[2]; // /projects/{projectName}
    const relativePath = this.currentDir.replace(`/projects/${projectBase}`, '');
    return relativePath || '/';
  }

  // 現在のディレクトリを設定
  setCurrentDir(dir: string): void {
    this.currentDir = dir;
  }

  // cd - ディレクトリ変更
  async cd(path: string): Promise<string> {
    const newPath = path.startsWith('/') ? path : `${this.currentDir}/${path}`;
    const normalizedPath = this.normalizePath(newPath);
    
    try {
      const stat = await this.fs.promises.stat(normalizedPath);
      if (stat.isDirectory()) {
        this.currentDir = normalizedPath;
        return `Changed directory to ${normalizedPath}`;
      } else {
        throw new Error('Not a directory');
      }
    } catch (error) {
      throw new Error(`cd: ${path}: No such directory`);
    }
  }

  // ls - ファイル一覧表示
  async ls(path?: string): Promise<string> {
    const targetPath = path ? 
      (path.startsWith('/') ? path : `${this.currentDir}/${path}`) : 
      this.currentDir;
    
    try {
      const files = await this.fs.promises.readdir(targetPath);
      if (files.length === 0) {
        return '(empty directory)';
      }
      
      const fileDetails = await Promise.all(
        files.map(async (file) => {
          try {
            const stat = await this.fs.promises.stat(`${targetPath}/${file}`);
            return stat.isDirectory() ? `${file}/` : file;
          } catch {
            return file;
          }
        })
      );
      
      return fileDetails.join('  ');
    } catch (error) {
      throw new Error(`ls: ${path || this.currentDir}: No such directory`);
    }
  }

  // mkdir - ディレクトリ作成
  async mkdir(dirName: string, recursive = false): Promise<string> {
    const targetPath = dirName.startsWith('/') ? dirName : `${this.currentDir}/${dirName}`;
    const normalizedPath = this.normalizePath(targetPath);
    
    try {
      if (recursive) {
        // 再帰的にディレクトリを作成
        await this.createDirectoryRecursive(normalizedPath);
        return `Directory created: ${normalizedPath}`;
      } else {
        // 親ディレクトリの存在確認
        const parentDir = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'));
        if (parentDir && parentDir !== '/') {
          try {
            await this.fs.promises.stat(parentDir);
          } catch {
            throw new Error(`Parent directory does not exist: ${parentDir}`);
          }
        }
        
        // ディレクトリが既に存在するかチェック
        try {
          const stat = await this.fs.promises.stat(normalizedPath);
          if (stat.isDirectory()) {
            return `Directory already exists: ${normalizedPath}`;
          } else {
            throw new Error(`File exists and is not a directory: ${normalizedPath}`);
          }
        } catch {
          // ディレクトリが存在しない場合は作成
          await this.fs.promises.mkdir(normalizedPath);
          return `Directory created: ${normalizedPath}`;
        }
      }
    } catch (error) {
      throw new Error(`mkdir: cannot create directory '${dirName}': ${(error as Error).message}`);
    }
  }

  // 再帰的ディレクトリ作成のヘルパー
  private async createDirectoryRecursive(path: string): Promise<void> {
    const parts = path.split('/').filter(part => part);
    let currentPath = '';
    
    for (const part of parts) {
      currentPath += '/' + part;
      try {
        const stat = await this.fs.promises.stat(currentPath);
        if (!stat.isDirectory()) {
          throw new Error(`Path exists but is not a directory: ${currentPath}`);
        }
      } catch (error) {
        // ディレクトリが存在しない場合は作成
        if ((error as any).code !== 'ENOENT') {
          throw error;
        }
        try {
          await this.fs.promises.mkdir(currentPath);
        } catch (mkdirError) {
          // EEXIST エラー（既に存在）は無視
          if ((mkdirError as any).code !== 'EEXIST') {
            throw mkdirError;
          }
        }
      }
    }
  }

  // touch - ファイル作成
  async touch(fileName: string): Promise<string> {
    const targetPath = fileName.startsWith('/') ? fileName : `${this.currentDir}/${fileName}`;
    const normalizedPath = this.normalizePath(targetPath);
    
    try {
      // ファイルが存在しない場合のみ作成
      try {
        await this.fs.promises.stat(normalizedPath);
        return `File already exists: ${normalizedPath}`;
      } catch {
        await this.fs.promises.writeFile(normalizedPath, '');
        return `File created: ${normalizedPath}`;
      }
    } catch (error) {
      throw new Error(`touch: cannot create file '${fileName}': ${(error as Error).message}`);
    }
  }

  // rm - ファイル削除
  async rm(fileName: string, recursive = false): Promise<string> {
    const targetPath = fileName.startsWith('/') ? fileName : `${this.currentDir}/${fileName}`;
    const normalizedPath = this.normalizePath(targetPath);
    
    try {
      const stat = await this.fs.promises.stat(normalizedPath);
      
      if (stat.isDirectory()) {
        if (!recursive) {
          throw new Error('Is a directory (use -r for recursive)');
        }
        await this.rmdir(normalizedPath);
      } else {
        await this.fs.promises.unlink(normalizedPath);
      }
      
      return `Removed: ${normalizedPath}`;
    } catch (error) {
      throw new Error(`rm: cannot remove '${fileName}': ${(error as Error).message}`);
    }
  }

  // cat - ファイル内容表示
  async cat(fileName: string): Promise<string> {
    const targetPath = fileName.startsWith('/') ? fileName : `${this.currentDir}/${fileName}`;
    const normalizedPath = this.normalizePath(targetPath);
    
    try {
      const content = await this.fs.promises.readFile(normalizedPath, { encoding: 'utf8' });
      return content as string;
    } catch (error) {
      throw new Error(`cat: ${fileName}: No such file`);
    }
  }

  // echo - テキスト出力/ファイル書き込み
  async echo(text: string, fileName?: string): Promise<string> {
    if (fileName) {
      const targetPath = fileName.startsWith('/') ? fileName : `${this.currentDir}/${fileName}`;
      const normalizedPath = this.normalizePath(targetPath);
      
      try {
        await this.fs.promises.writeFile(normalizedPath, text);
        return `Text written to: ${normalizedPath}`;
      } catch (error) {
        throw new Error(`echo: cannot write to '${fileName}': ${(error as Error).message}`);
      }
    } else {
      return text;
    }
  }

  // ヘルパーメソッド: パスの正規化
  private normalizePath(path: string): string {
    const parts = path.split('/').filter(part => part !== '' && part !== '.');
    const normalized: string[] = [];
    
    for (const part of parts) {
      if (part === '..') {
        if (normalized.length > 0 && normalized[normalized.length - 1] !== '..') {
          normalized.pop();
        }
      } else {
        normalized.push(part);
      }
    }
    
    return '/' + normalized.join('/');
  }

  // ヘルパーメソッド: ディレクトリの再帰削除
  private async rmdir(dirPath: string): Promise<void> {
    const files = await this.fs.promises.readdir(dirPath);
    
    for (const file of files) {
      const filePath = `${dirPath}/${file}`;
      const stat = await this.fs.promises.stat(filePath);
      
      if (stat.isDirectory()) {
        await this.rmdir(filePath);
      } else {
        await this.fs.promises.unlink(filePath);
      }
    }
    
    await this.fs.promises.rmdir(dirPath);
  }
}

// Git操作クラス
export class GitCommands {
  private fs: FS;
  private dir: string;

  constructor(projectName: string) {
    this.fs = getFileSystem()!;
    this.dir = getProjectDir(projectName);
    // プロジェクトディレクトリが存在しない場合は作成
    this.ensureProjectDirectory();
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
      // Gitリポジトリが初期化されているかチェック
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
      const currentBranch = await this.getCurrentBranch();
      
      if (status.length === 0) {
        return `On branch ${currentBranch}\nnothing to commit, working tree clean`;
      }

      const untracked: string[] = [];
      const modified: string[] = [];
      const staged: string[] = [];

      status.forEach(([filepath, HEAD, workdir, stage]) => {
        // HEAD=1: ファイルがHEADに存在, workdir=1: ファイルがワーキングディレクトリに存在, stage=1: ファイルがステージングエリアに存在
        if (HEAD === 1 && workdir === 1 && stage === 1) {
          // ファイルに変更なし
        } else if (HEAD === 0 && workdir === 1 && stage === 0) {
          // 新しいファイル（未追跡）
          untracked.push(filepath);
        } else if (HEAD === 1 && workdir === 1 && stage === 0) {
          // 変更されたファイル（未ステージ）
          modified.push(filepath);
        } else if ((HEAD === 0 || HEAD === 1) && stage === 3) {
          // ステージされたファイル
          staged.push(filepath);
        } else if (HEAD === 0 && workdir === 1 && stage === 3) {
          // 新しくステージされたファイル
          staged.push(filepath);
        }
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

  // git log - ログ表示
  async log(depth = 10): Promise<string> {
    try {
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
}
