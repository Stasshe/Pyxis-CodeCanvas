// zipファイル解凍用
import JSZip from 'jszip';
import FS from '@isomorphic-git/lightning-fs';
import { getFileSystem, getProjectDir } from '../filesystem';

// UNIXライクなコマンド実装
export class UnixCommands {
  public fs: FS;
  private currentDir: string;
  private onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean) => Promise<void>;

  constructor(projectName: string, onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean) => Promise<void>) {
    this.fs = getFileSystem()!;
    this.currentDir = getProjectDir(projectName);
    this.onFileOperation = onFileOperation;
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

  // プロジェクトディレクトリからの相対パスを取得
  public getRelativePathFromProject(fullPath: string): string {
    const projectBase = `/projects/${this.currentDir.split('/')[2]}`;
    return fullPath.replace(projectBase, '') || '/';
  }

  // cd - ディレクトリ変更
  async cd(path: string): Promise<string> {
    const projectRoot = getProjectDir(this.currentDir.split('/')[2]); // プロジェクトのルートディレクトリ
    const newPath = path.startsWith('/') ? path : `${this.currentDir}/${path}`;
    const normalizedPath = this.normalizePath(newPath);
    
    // プロジェクトルートより上への移動を制限
    if (!normalizedPath.startsWith(projectRoot)) {
      throw new Error('cd: Permission denied - Cannot navigate outside project directory');
    }
    
    try {
      const stat = await this.fs.promises.stat(normalizedPath);
      if (stat.isDirectory()) {
        this.currentDir = normalizedPath;
        return `Changed directory to ${normalizedPath}`;
      } else {
        throw new Error('Not a directory');
      }
    } catch (error) {
      // プロジェクトルート制限のエラーの場合は、そのメッセージを優先
      if ((error as Error).message.includes('Permission denied')) {
        throw error;
      }
      throw new Error(`cd: ${path}: No such directory`);
    }
  }

  // ls - ファイル一覧表示（ツリー形式）
  async ls(path?: string): Promise<string> {
    const targetPath = path ? 
      (path.startsWith('/') ? path : `${this.currentDir}/${path}`) : 
      this.currentDir;
    
    try {
      // 現在のディレクトリの内容を取得（.git、「.」フォルダは除外）
      const files = await this.fs.promises.readdir(targetPath);
      const filteredFiles = files.filter(file => 
        file !== '.git' && 
        file !== '.' && 
        file !== '..' &&
        !file.startsWith('.git')
      );
      
      if (filteredFiles.length === 0) {
        return '(empty directory)';
      }

      // ファイルとディレクトリの情報を取得
      const fileDetails = await Promise.all(
        filteredFiles.map(async (file) => {
          try {
            const filePath = `${targetPath}/${file}`;
            const stat = await this.fs.promises.stat(filePath);
            return { 
              name: file, 
              isDirectory: stat.isDirectory(),
              path: filePath
            };
          } catch (error) {
            return { name: file, isDirectory: false, path: `${targetPath}/${file}` };
          }
        })
      );

      // ディレクトリを先に、ファイルを後に並べ替え
      const sortedFiles = fileDetails.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      // ツリー形式で表示
      return await this.generateSimpleTree(targetPath, sortedFiles, 0, '');
    } catch (error) {
      throw new Error(`ls: ${path || this.currentDir}: No such directory`);
    }
  }

  // シンプルなツリー形式表示（.git、「.」フォルダを除外）
  private async generateSimpleTree(basePath: string, files: Array<{name: string, isDirectory: boolean, path: string}>, depth = 0, prefix = ''): Promise<string> {
    let result = '';
    
    // 深度制限（無限ループ防止）
    if (depth > 5) {
      return '';
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isLast = i === files.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      
      if (file.isDirectory) {
        result += `${prefix}${connector}${file.name}/\n`;
        
        // サブディレクトリの内容を取得（深度制限内で）
        if (depth < 1) {
          try {
            const subFiles = await this.fs.promises.readdir(file.path);
            // .git関連と「.」フォルダを除外して安全性を確保
            const filteredSubFiles = subFiles.filter(f => 
              f !== '.git' && 
              f !== '.' && 
              f !== '..' &&
              !f.startsWith('.git')
            );
            
            if (filteredSubFiles.length > 0) {
              const subDetails = await Promise.all(
                filteredSubFiles.map(async (subFile) => {
                  try {
                    const subPath = `${file.path}/${subFile}`;
                    const stat = await this.fs.promises.stat(subPath);
                    return { name: subFile, isDirectory: stat.isDirectory(), path: subPath };
                  } catch {
                    return { name: subFile, isDirectory: false, path: `${file.path}/${subFile}` };
                  }
                })
              );
              
              const sortedSubFiles = subDetails.sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) {
                  return a.isDirectory ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
              });
              
              // 子要素のプレフィックスを計算
              const nextPrefix = prefix + (isLast ? '    ' : '│   ');
              const subTree = await this.generateSimpleTree(file.path, sortedSubFiles, depth + 1, nextPrefix);
              result += subTree;
            }
          } catch {
            // サブディレクトリの読み取りに失敗した場合は無視
          }
        }
      } else {
        result += `${prefix}${connector}${file.name}\n`;
      }
    }
    
    return result;
  }

  // mkdir - ディレクトリ作成
  async mkdir(dirName: string, recursive = false): Promise<string> {
    const targetPath = dirName.startsWith('/') ? dirName : `${this.currentDir}/${dirName}`;
    const normalizedPath = this.normalizePath(targetPath);
    
    console.log('[mkdir] Starting:', { dirName, targetPath, normalizedPath, onFileOperation: !!this.onFileOperation });
    
    try {
      if (recursive) {
        // 再帰的にディレクトリを作成
        await this.createDirectoryRecursive(normalizedPath);
        
        // ファイルシステムのキャッシュをフラッシュ
        await this.flushFileSystemCache();
        
        // IndexedDBにも同期
        if (this.onFileOperation) {
          const relativePath = this.getRelativePathFromProject(normalizedPath);
          //console.log('[mkdir] Syncing recursive:', { relativePath });
          await this.onFileOperation(relativePath, 'folder');
          //console.log('[mkdir] Sync completed for recursive');
        }
        
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
          console.log('[mkdir] Creating directory:', normalizedPath);
          try {
            await this.fs.promises.mkdir(normalizedPath);
            console.log('[mkdir] Directory created in FS successfully');
            
            // 作成後に確認
            const stat = await this.fs.promises.stat(normalizedPath);
            console.log('[mkdir] Verification:', { exists: true, isDirectory: stat.isDirectory() });
          } catch (createError) {
            console.error('[mkdir] Failed to create directory:', createError);
            throw createError;
          }
          
          // IndexedDBにも同期
          if (this.onFileOperation) {
            const relativePath = this.getRelativePathFromProject(normalizedPath);
            //console.log('[mkdir] Syncing to IndexedDB:', { relativePath });
            try {
              await this.onFileOperation(relativePath, 'folder');
              console.log('[mkdir] Sync completed successfully');
            } catch (syncError) {
              console.error('[mkdir] Sync failed:', syncError);
            }
          } else {
            console.log('[mkdir] No onFileOperation callback available');
          }
          
          return `Directory created: ${normalizedPath}`;
        }
      }
    } catch (error) {
      console.error('[mkdir] Error:', error);
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
        // 親ディレクトリが存在することを確認
        const parentDir = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'));
        if (parentDir && parentDir !== this.currentDir) {
          try {
            await this.fs.promises.stat(parentDir);
          } catch {
            await this.fs.promises.mkdir(parentDir, { recursive: true } as any);
          }
        }
        
        // ファイルを作成
        await this.fs.promises.writeFile(normalizedPath, '');
        
        // ファイルシステムの同期処理を簡素化
        await this.flushFileSystemCache();
        
        // IndexedDBに同期（最優先で実行）
        if (this.onFileOperation) {
          const relativePath = this.getRelativePathFromProject(normalizedPath);
          try {
            await this.onFileOperation(relativePath, 'file', '');
          } catch (syncError) {
            console.error(`[touch] IndexedDB sync failed: ${relativePath}`, syncError);
          }
        }
        
        return `File created: ${normalizedPath}`;
      }
    } catch (error) {
      throw new Error(`touch: cannot create file '${fileName}': ${(error as Error).message}`);
    }
  }

  // ファイルシステムのキャッシュをフラッシュしてGitに変更を認識させる
  private async flushFileSystemCache(): Promise<void> {
    try {
      // Lightning-FSのキャッシュをフラッシュ（バックエンドストレージと同期）
      if (this.fs && (this.fs as any).sync) {
        await (this.fs as any).sync();
      }
      
      // ファイルシステムの強制同期のため短縮した遅延
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.warn('[touch] Failed to flush filesystem cache:', error);
    }
  }



  // rm - ファイル削除
  async rm(fileName: string, recursive = false): Promise<string> {
    return this.executeFileOperation(async () => {
      console.log('[rm] Starting file deletion:', { fileName, recursive, currentDir: this.currentDir });
      
      // プロジェクトディレクトリの確認
      await this.ensureProjectDirectory();
      
      if (fileName.includes('*')) {
        // ワイルドカード対応
        const files = await this.getMatchingFilesForDelete(fileName);
        if (files.length === 0) {
          return `rm: no matches found: ${fileName}`;
        }
        
        let deletedCount = 0;
        const deletedFiles: string[] = [];
        const errors: string[] = [];
        
        for (const file of files) {
          try {
            const result = await this.removeFile(file, recursive);
            if (result.success) {
              deletedFiles.push(file);
              deletedCount++;
            } else if (result.error) {
              errors.push(`${file}: ${result.error}`);
            }
          } catch (error) {
            errors.push(`${file}: ${(error as Error).message}`);
          }
        }
        
        // ファイルシステムキャッシュのフラッシュ
        await this.flushFileSystemCache();
        
        // プロジェクト全体の更新を通知
        if (this.onFileOperation && deletedCount > 0) {
          console.log('[rm] Triggering project refresh after batch deletion');
          await this.onFileOperation('.', 'folder');
          
          // 追加的な同期処理（Git削除検知を確実にするため）
          await new Promise(resolve => setTimeout(resolve, 200));
          await this.flushFileSystemCache();
        }
        
        if (deletedCount === 0) {
          const errorMsg = errors.length > 0 ? `\nErrors:\n${errors.join('\n')}` : '';
          return `rm: no files were removed${errorMsg}`;
        }
        
        const successMsg = `removed ${deletedCount} file(s): ${deletedFiles.join(', ')}`;
        const errorMsg = errors.length > 0 ? `\nWarnings:\n${errors.join('\n')}` : '';
        return successMsg + errorMsg;
      } else {
        // 単一ファイル削除
        const result = await this.removeFile(fileName, recursive);
        
        // ファイルシステムキャッシュのフラッシュ
        await this.flushFileSystemCache();
        
        if (result.success) {
          // プロジェクト全体の更新を通知
          if (this.onFileOperation) {
            console.log('[rm] Triggering project refresh after single file deletion');
            await this.onFileOperation('.', 'folder');
            
            // 追加的な同期処理（Git削除検知を確実にするため）
            await new Promise(resolve => setTimeout(resolve, 200));
            await this.flushFileSystemCache();
          }
          return result.message || `removed '${fileName}'`;
        } else {
          throw new Error(result.error || `cannot remove '${fileName}'`);
        }
      }
    }, `rm operation failed`);
  }

  // ファイル削除のヘルパーメソッド
  private async removeFile(fileName: string, recursive: boolean): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const targetPath = fileName.startsWith('/') ? fileName : `${this.currentDir}/${fileName}`;
      const normalizedPath = this.normalizePath(targetPath);
      
      console.log('[rm] Processing file:', { fileName, targetPath, normalizedPath });
      
      // ファイル/ディレクトリの存在確認
      let stat;
      try {
        stat = await this.fs.promises.stat(normalizedPath);
      } catch {
        return { success: false, error: `No such file or directory: ${fileName}` };
      }
      
      // 削除処理
      if (stat.isDirectory()) {
        // ディレクトリの場合は再帰的に削除
        await this.rmdir(normalizedPath);
        // onFileOperationを再帰的に通知
        if (this.onFileOperation) {
          // ディレクトリ配下の全ファイル・フォルダを取得
          const notifyRecursive = async (dir: string) => {
            let files: string[] = [];
            try {
              files = await this.fs.promises.readdir(dir);
            } catch {}
            for (const file of files) {
              const childPath = `${dir}/${file}`;
              try {
                const childStat = await this.fs.promises.stat(childPath);
                const relChildPath = this.getRelativePathFromProject(childPath);
                if (childStat.isDirectory()) {
                  await notifyRecursive(childPath);
                  if (this.onFileOperation) await this.onFileOperation(relChildPath, 'delete');
                } else {
                  if (this.onFileOperation) await this.onFileOperation(relChildPath, 'delete');
                }
              } catch {}
            }
            // 最後に自身（ディレクトリ）
            const relDirPath = this.getRelativePathFromProject(dir);
            if (this.onFileOperation) await this.onFileOperation(relDirPath, 'delete');
          };
          await notifyRecursive(normalizedPath);
        }
      } else {
        // ファイルの場合
        console.log('[rm] Deleting file from filesystem:', normalizedPath);
        await this.fs.promises.unlink(normalizedPath);
        console.log('[rm] File deleted from filesystem successfully');
        
        // 削除後のファイル存在確認
        try {
          await this.fs.promises.stat(normalizedPath);
          console.warn('[rm] WARNING: File still exists after deletion!', normalizedPath);
        } catch {
          console.log('[rm] Confirmed: File no longer exists in filesystem');
        }
        
        // 削除後の重要なGitキャッシュフラッシュ
        await this.flushFileSystemCache();
        
        // onFileOperationコールバックを呼ぶ
        if (this.onFileOperation) {
          const relPath = this.getRelativePathFromProject(normalizedPath);
          console.log('[rm] Calling onFileOperation for deletion:', relPath);
          await this.onFileOperation(relPath, 'delete');
        }
      }
      
      return { 
        success: true, 
        message: `removed '${fileName}'`
      };
    } catch (error) {
      console.error('[rm] Error removing file:', fileName, error);
      return { 
        success: false, 
        error: (error as Error).message 
      };
    }
  }

  // エラーハンドリング付きのファイル操作実行
  private async executeFileOperation<T>(operation: () => Promise<T>, errorPrefix: string): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      console.error('[unix] File operation error:', error);
      throw new Error(`${errorPrefix}: ${(error as Error).message}`);
    }
  }

  // 削除用のパターンマッチング
  private async getMatchingFilesForDelete(pattern: string): Promise<string[]> {
    try {
      console.log('[rm] Pattern matching for deletion:', pattern);
      
      // 現在のディレクトリの内容を取得
      const files = await this.fs.promises.readdir(this.currentDir);
      // .git関連のファイルは除外して安全性を確保
      const filteredFiles = files.filter(file => 
        file !== '.git' && 
        !file.startsWith('.git')
      );
      
      console.log('[rm] Available files for pattern matching:', filteredFiles);
      
      if (pattern === '*') {
        // すべてのファイル（.git関連を除く）
        return filteredFiles;
      }
      
      // ワイルドカードパターンをRegExpに変換
      const regexPattern = pattern
        .replace(/\./g, '\\.')  // . を \. にエスケープ
        .replace(/\*/g, '.*')   // * を .* に変換
        .replace(/\?/g, '.');   // ? を . に変換
      
      const regex = new RegExp(`^${regexPattern}$`);
      const matchedFiles = filteredFiles.filter(file => regex.test(file));
      
      console.log('[rm] Matched files:', matchedFiles);
      return matchedFiles;
    } catch (error) {
      console.error('[rm] Error getting matching files:', error);
      return [];
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
      // '>>'（追記）対応
      let append = false;
      let actualFileName = fileName;
      if (fileName.startsWith('>>')) {
        append = true;
        actualFileName = fileName.replace(/^>>\s*/, '');
      }
      // '>>'が途中にある場合（echo foo >> file.txt）
      if (fileName.startsWith('>') && !fileName.startsWith('>>')) {
        actualFileName = fileName.replace(/^>\s*/, '');
      }
      if (fileName.startsWith('>>')) {
        append = true;
        actualFileName = fileName.replace(/^>>\s*/, '');
      }
      const targetPath = actualFileName.startsWith('/') ? actualFileName : `${this.currentDir}/${actualFileName}`;
      const normalizedPath = this.normalizePath(targetPath);
      try {
        let content = text;
        if (append) {
          // 既存内容を取得（なければ空）
          try {
            const prev = await this.fs.promises.readFile(normalizedPath, { encoding: 'utf8' });
            content = (prev as string) + text;
          } catch {
            // ファイルがなければ新規作成
            content = text;
          }
        }
        await this.fs.promises.writeFile(normalizedPath, content);
        // IndexedDBにも同期
        if (this.onFileOperation) {
          const relativePath = this.getRelativePathFromProject(normalizedPath);
          await this.onFileOperation(relativePath, 'file', content);
        }
        return append ? `Appended to: ${normalizedPath}` : `Text written to: ${normalizedPath}`;
      } catch (error) {
        throw new Error(`echo: cannot write to '${actualFileName}': ${(error as Error).message}`);
      }
    } else {
      return text;
    }
  }

  // ヘルパーメソッド: パスの正規化
  public normalizePath(path: string): string {
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
  async rmdir(dirPath: string, retryCount = 0): Promise<void> {
    let files: string[] = [];
    try {
      files = await this.fs.promises.readdir(dirPath);
    } catch (error) {
      // ディレクトリが存在しない場合は何もしない
      return;
    }
    files = files.filter(file => file !== '.' && file !== '..');
    for (const file of files) {
      const filePath = `${dirPath}/${file}`;
      let stat;
      try {
        stat = await this.fs.promises.stat(filePath);
      } catch (error) {
        // 存在しない場合はスキップ
        continue;
      }
      if (stat.isDirectory()) {
        await this.rmdir(filePath);
      } else {
        try {
          await this.fs.promises.unlink(filePath);
          if (this.onFileOperation) {
            const relativePath = this.getRelativePathFromProject(filePath);
            await this.onFileOperation(relativePath, 'delete');
          }
        } catch (error) {
          // 削除失敗でもスキップ
          continue;
        }
      }
    }
    // ディレクトリ自身を削除
    try {
      await this.fs.promises.rmdir(dirPath);
      if (this.onFileOperation) {
        const relativePath = this.getRelativePathFromProject(dirPath);
        await this.onFileOperation(relativePath, 'delete');
      }
    } catch (error) {
      // 削除失敗でもthrowしない
      return;
    }
  }

  // rename - ファイル/ディレクトリの名前変更（削除＋新規作成＋書き込み）
  async rename(oldPath: string, newPath: string): Promise<string> {
    const oldAbsPath = oldPath.startsWith('/') ? oldPath : `${this.currentDir}/${oldPath}`;
    const newAbsPath = newPath.startsWith('/') ? newPath : `${this.currentDir}/${newPath}`;
    const oldNormalized = this.normalizePath(oldAbsPath);
    const newNormalized = this.normalizePath(newAbsPath);
    try {
      // 元ファイル/ディレクトリの存在確認
      const stat = await this.fs.promises.stat(oldNormalized);
      if (stat.isDirectory()) {
        // ディレクトリの場合は再帰的コピー＋削除
        await this.copyDirectory(oldNormalized, newNormalized);
        await this.rmdir(oldNormalized);
        if (this.onFileOperation) {
          await this.onFileOperation(this.getRelativePathFromProject(oldNormalized), 'delete');
          await this.onFileOperation(this.getRelativePathFromProject(newNormalized), 'folder');
        }
        return `Directory renamed: ${oldNormalized} -> ${newNormalized}`;
      } else {
        // ファイルの場合は内容取得→新規作成→削除
        const content = await this.fs.promises.readFile(oldNormalized, { encoding: 'utf8' });
        await this.fs.promises.writeFile(newNormalized, content);
        await this.fs.promises.unlink(oldNormalized);
        if (this.onFileOperation) {
          await this.onFileOperation(this.getRelativePathFromProject(oldNormalized), 'delete');
          await this.onFileOperation(this.getRelativePathFromProject(newNormalized), 'file', content as string);
        }
        return `File renamed: ${oldNormalized} -> ${newNormalized}`;
      }
    } catch (error) {
      throw new Error(`rename: cannot rename '${oldPath}' to '${newPath}': ${(error as Error).message}`);
    }
  }

  // ディレクトリの再帰コピー
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await this.fs.promises.mkdir(dest, { recursive: true } as any);
    const entries = await this.fs.promises.readdir(src);
    for (const entry of entries) {
      const srcPath = `${src}/${entry}`;
      const destPath = `${dest}/${entry}`;
      const stat = await this.fs.promises.stat(srcPath);
      if (stat.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        const content = await this.fs.promises.readFile(srcPath, { encoding: 'utf8' });
        await this.fs.promises.writeFile(destPath, content);
      }
    }
  }
  // unzip - zipファイルを解凍
  async unzip(zipFileName: string, destDir?: string): Promise<string> {
    const targetPath = zipFileName.startsWith('/') ? zipFileName : `${this.currentDir}/${zipFileName}`;
    const normalizedPath = this.normalizePath(targetPath);
    const extractDir = destDir
      ? (destDir.startsWith('/') ? destDir : `${this.currentDir}/${destDir}`)
      : this.currentDir;
    const normalizedDest = this.normalizePath(extractDir);
    try {
      // zipファイルの内容を取得
      const data = await this.fs.promises.readFile(normalizedPath);
      const zip = await JSZip.loadAsync(data);
      let fileCount = 0;
      // zip内の全ファイルを展開
      for (const relPath in zip.files) {
        const entry = zip.files[relPath];
        if (entry.dir) {
          // ディレクトリは作成
          const dirPath = this.normalizePath(`${normalizedDest}/${relPath}`);
          await this.fs.promises.mkdir(dirPath, { recursive: true } as any);
          if (this.onFileOperation) {
            const rel = this.getRelativePathFromProject(dirPath);
            await this.onFileOperation(rel, 'folder');
          }
        } else {
          // ファイルは書き込み
          const filePath = this.normalizePath(`${normalizedDest}/${relPath}`);
          const content = await entry.async('uint8array');
          // 親ディレクトリ作成
          const parentDir = filePath.substring(0, filePath.lastIndexOf('/'));
          await this.fs.promises.mkdir(parentDir, { recursive: true } as any);
          await this.fs.promises.writeFile(filePath, content);
          if (this.onFileOperation) {
            const rel = this.getRelativePathFromProject(filePath);
            await this.onFileOperation(rel, 'file', '');
          }
          fileCount++;
        }
      }
      await this.flushFileSystemCache();
      return `Unzipped ${fileCount} file(s) to ${normalizedDest}`;
    } catch (error) {
      throw new Error(`unzip: ${zipFileName}: ${(error as Error).message}`);
    }
  }
}
