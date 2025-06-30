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

// UNIXライクなコマンド実装
export class UnixCommands {
  private fs: FS;
  private currentDir: string;

  constructor(projectName: string) {
    this.fs = getFileSystem()!;
    this.currentDir = getProjectDir(projectName);
  }

  // pwd - 現在のディレクトリを表示
  pwd(): string {
    return this.currentDir;
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
        const parts = normalizedPath.split('/').filter(part => part);
        let currentPath = '';
        
        for (const part of parts) {
          currentPath += '/' + part;
          try {
            await this.fs.promises.stat(currentPath);
          } catch {
            // ディレクトリが存在しない場合は作成
            await this.fs.promises.mkdir(currentPath);
          }
        }
      } else {
        await this.fs.promises.mkdir(normalizedPath);
      }
      return `Directory created: ${normalizedPath}`;
    } catch (error) {
      throw new Error(`mkdir: cannot create directory '${dirName}': ${(error as Error).message}`);
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
  }

  // git init - リポジトリ初期化
  async init(): Promise<string> {
    try {
      await git.init({ fs: this.fs, dir: this.dir });
      return `Initialized empty Git repository in ${this.dir}`;
    } catch (error) {
      throw new Error(`git init failed: ${(error as Error).message}`);
    }
  }

  // git status - ステータス確認
  async status(): Promise<string> {
    try {
      const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
      
      if (status.length === 0) {
        return 'On branch main\nnothing to commit, working tree clean';
      }

      const untracked: string[] = [];
      const modified: string[] = [];
      const staged: string[] = [];

      status.forEach(([filepath, , worktreeStatus, stageStatus]) => {
        if (worktreeStatus === 0) {
          // deleted
        } else if (stageStatus === 0) {
          untracked.push(filepath);
        } else if (worktreeStatus !== stageStatus) {
          modified.push(filepath);
        } else if (stageStatus === 2) {
          staged.push(filepath);
        }
      });

      let result = 'On branch main\n';
      
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
      }

      return result;
    } catch (error) {
      throw new Error(`git status failed: ${(error as Error).message}`);
    }
  }

  // git add - ファイルをステージング
  async add(filepath: string): Promise<string> {
    try {
      await git.add({ fs: this.fs, dir: this.dir, filepath });
      return `Added ${filepath} to staging area`;
    } catch (error) {
      throw new Error(`git add failed: ${(error as Error).message}`);
    }
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
