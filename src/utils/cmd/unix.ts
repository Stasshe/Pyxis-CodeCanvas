// zipファイル解凍用
import JSZip from 'jszip';
import FS from '@isomorphic-git/lightning-fs';
import { getFileSystem, getProjectDir } from '@/utils/core/filesystem';

// UNIXライクなコマンド実装
export class UnixCommands {
  public fs: FS;
  private currentDir: string;
  private onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean, isBufferArray?: boolean, bufferContent?: ArrayBuffer) => Promise<void>;

  // バッチ処理用のキュー
  private fileOperationQueue: Array<{
    path: string;
    type: 'file' | 'folder' | 'delete';
    content?: string;
    isNodeRuntime?: boolean;
    isBufferArray?: boolean;
    bufferContent?: ArrayBuffer;
  }> = [];
  private batchProcessing = false;

  constructor(projectName: string, onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean, isBufferArray?: boolean, bufferContent?: ArrayBuffer) => Promise<void>) {
    this.fs = getFileSystem()!;
    this.currentDir = getProjectDir(projectName);
    this.onFileOperation = onFileOperation;
    // プロジェクトディレクトリが存在しない場合は作成
    this.ensureProjectDirectory();
  }

  // バッチ処理を開始
  startBatchProcessing(): void {
    this.batchProcessing = true;
    this.fileOperationQueue = [];
    console.log('[UnixCommands] Started batch processing mode');
  }

  // バッチ処理を終了し、キューをフラッシュ
  async finishBatchProcessing(): Promise<void> {
    if (!this.batchProcessing || !this.onFileOperation) {
      return;
    }

    console.log(`[UnixCommands] Finishing batch processing, ${this.fileOperationQueue.length} operations queued`);
    
    // キューに溜まった操作を並列実行（適度な並列度で）
    const BATCH_SIZE = 10;
    for (let i = 0; i < this.fileOperationQueue.length; i += BATCH_SIZE) {
      const batch = this.fileOperationQueue.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(op => this.onFileOperation!(op.path, op.type, op.content, op.isNodeRuntime, op.isBufferArray, op.bufferContent))
      );

      // バッチごとに短い遅延を挟む
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    this.batchProcessing = false;
    this.fileOperationQueue = [];
    console.log('[UnixCommands] Batch processing completed');
  }

  // ファイル操作を実行（バッチモード対応）
  private async executeFileOperation(
    path: string,
    type: 'file' | 'folder' | 'delete',
    content?: string,
    isNodeRuntime?: boolean,
    isBufferArray?: boolean,
    bufferContent?: ArrayBuffer
  ): Promise<void> {
    if (!this.onFileOperation) {
      return;
    }

    if (this.batchProcessing) {
      // バッチモードの場合はキューに追加
      this.fileOperationQueue.push({ path, type, content, isNodeRuntime, isBufferArray, bufferContent });
    } else {
      // 通常モードの場合は即座に実行
      await this.onFileOperation(path, type, content, isNodeRuntime, isBufferArray, bufferContent);
    }
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

  // ls - ファイル一覧表示（ツリー形式、オプション対応）
  async ls(path?: string, options: string[] = []): Promise<string> {
    const targetPath = path ? 
      (path.startsWith('/') ? path : `${this.currentDir}/${path}`) : 
      this.currentDir;
    
    // オプション解析
    const showAll = options.includes('-a') || options.includes('--all'); // 隠しファイルも表示
    const showLong = options.includes('-l') || options.includes('--long'); // 詳細表示
    const recursive = options.includes('-R') || options.includes('--recursive'); // 再帰表示
    //const treeFormat = options.includes('--tree'); // ツリー形式強制
    
    try {
      // ファイル/ディレクトリの存在確認
      const stat = await this.fs.promises.stat(targetPath);
      
      if (!stat.isDirectory()) {
        // ファイルの場合は詳細情報を表示
        if (showLong) {
          const size = stat.size || 0;
          const date = new Date().toLocaleDateString();
          return `${stat.isDirectory() ? 'd' : '-'}rw-r--r-- 1 user user ${size} ${date} ${path}`;
        }
        return path || targetPath.split('/').pop() || '';
      }
      
      // 現在のディレクトリの内容を取得（フィルタリング条件を調整）
      const files = await this.fs.promises.readdir(targetPath);
      let filteredFiles = files;
      
      if (!showAll) {
        // 通常は隠しファイル（.で始まる）と.git関連を除外
        filteredFiles = files.filter(file => 
          file !== '.git' && 
          file !== '.' && 
          file !== '..' &&
          !file.startsWith('.git') &&
          !file.startsWith('.')
        );
      } else {
        // -a オプション時は.gitのみ除外（安全性のため）
        filteredFiles = files.filter(file => 
          file !== '.git' && 
          file !== '.' && 
          file !== '..' &&
          !file.startsWith('.git')
        );
      }
      
      if (filteredFiles.length === 0) {
        return '(empty directory)';
      }

      // ファイルとディレクトリの情報を取得
      const fileDetails = await Promise.all(
        filteredFiles.map(async (file) => {
          try {
            const filePath = `${targetPath}/${file}`;
            const fileStat = await this.fs.promises.stat(filePath);
            return { 
              name: file, 
              isDirectory: fileStat.isDirectory(),
              path: filePath,
              size: fileStat.size || 0,
              mtime: new Date(fileStat.mtimeMs || Date.now())
            };
          } catch (error) {
            return { 
              name: file, 
              isDirectory: false, 
              path: `${targetPath}/${file}`,
              size: 0,
              mtime: new Date()
            };
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

      // 表示形式の選択
      if (showLong) {
        // 詳細表示（ls -l形式）
        let result = `total ${sortedFiles.length}\n`;
        for (const file of sortedFiles) {
          const type = file.isDirectory ? 'd' : '-';
          const size = file.size.toString().padStart(8);
          const date = file.mtime.toLocaleDateString();
          const time = file.mtime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          result += `${type}rw-r--r-- 1 user user ${size} ${date} ${time} ${file.name}${file.isDirectory ? '/' : ''}\n`;
        }
        return result.trim();
      } else {
        // ツリー形式で表示
        const maxDepth = recursive ? 10 : (showAll ? 3 : 2);
        return await this.generateSimpleTree(targetPath, sortedFiles, 0, '', showAll, maxDepth);
      }
    } catch (error) {
      throw new Error(`ls: ${path || this.currentDir}: No such file or directory`);
    }
  }

  // tree コマンド専用（常にツリー形式）
  async tree(path?: string, options: string[] = []): Promise<string> {
    const showAll = options.includes('-a') || options.includes('--all');
    const showSize = options.includes('-s') || options.includes('--size');
    const maxDepthOption = options.find(opt => opt.startsWith('-L'));
    let maxDepth = showAll ? 10 : 3;
    
    if (maxDepthOption) {
      const depthMatch = maxDepthOption.match(/-L(\d+)/);
      if (depthMatch) {
        maxDepth = parseInt(depthMatch[1], 10);
      }
    }
    
    const targetPath = path ? 
      (path.startsWith('/') ? path : `${this.currentDir}/${path}`) : 
      this.currentDir;
    
    try {
      const stat = await this.fs.promises.stat(targetPath);
      
      if (!stat.isDirectory()) {
        return path || targetPath.split('/').pop() || '';
      }
      
      const files = await this.fs.promises.readdir(targetPath);
      
      // フィルタリング
      let filteredFiles = files;
      if (!showAll) {
        filteredFiles = files.filter(file => 
          file !== '.git' && 
          file !== '.' && 
          file !== '..' &&
          !file.startsWith('.git') &&
          !file.startsWith('.')
        );
      } else {
        filteredFiles = files.filter(file => 
          file !== '.git' && 
          file !== '.' && 
          file !== '..' &&
          !file.startsWith('.git')
        );
      }
      
      if (filteredFiles.length === 0) {
        return `${targetPath}\n\n0 directories, 0 files`;
      }
      
      // ファイル詳細情報を取得
      const fileDetails = await Promise.all(
        filteredFiles.map(async (file) => {
          try {
            const filePath = `${targetPath}/${file}`;
            const fileStat = await this.fs.promises.stat(filePath);
            return { 
              name: file, 
              isDirectory: fileStat.isDirectory(), 
              path: filePath,
              size: fileStat.size || 0
            };
          } catch {
            return { 
              name: file, 
              isDirectory: false, 
              path: `${targetPath}/${file}`,
              size: 0
            };
          }
        })
      );

      const sortedFiles = fileDetails.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      let result = `${targetPath}\n`;
      const treeContent = await this.generateSimpleTree(targetPath, sortedFiles, 0, '', showAll, maxDepth, showSize);
      result += treeContent;
      
      // 統計情報を追加
      const { dirCount, fileCount } = await this.countFilesAndDirs(targetPath, showAll, maxDepth);
      result += `\n${dirCount} directories, ${fileCount} files`;
      
      return result;
    } catch (error) {
      throw new Error(`tree: ${path || this.currentDir}: No such file or directory`);
    }
  }

  // シンプルなツリー形式表示（.git、「.」フォルダを除外、オプション対応）
  private async generateSimpleTree(
    basePath: string, 
    files: Array<{name: string, isDirectory: boolean, path: string, size?: number}>, 
    depth = 0, 
    prefix = '', 
    showAll = false, 
    maxDepth = 10, 
    showSize = false
  ): Promise<string> {
    let result = '';
    
    // 深度制限（無限ループ防止）
    if (depth >= maxDepth) {
      return '';
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isLast = i === files.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const sizeInfo = showSize && file.size !== undefined ? ` [${this.formatFileSize(file.size)}]` : '';
      
      if (file.isDirectory) {
        result += `${prefix}${connector}${file.name}/${sizeInfo}\n`;
        
        // サブディレクトリの内容を取得（深度制限内で）
        if (depth < maxDepth - 1) {
          try {
            const subFiles = await this.fs.promises.readdir(file.path);
            
            // フィルタリング条件を調整
            let filteredSubFiles = subFiles;
            if (!showAll) {
              filteredSubFiles = subFiles.filter(f => 
                f !== '.git' && 
                f !== '.' && 
                f !== '..' &&
                !f.startsWith('.git') &&
                !f.startsWith('.')
              );
            } else {
              filteredSubFiles = subFiles.filter(f => 
                f !== '.' && 
                f !== '..'
              );
            }
            
            if (filteredSubFiles.length > 0) {
              const subDetails = await Promise.all(
                filteredSubFiles.map(async (subFile) => {
                  try {
                    const subPath = `${file.path}/${subFile}`;
                    const stat = await this.fs.promises.stat(subPath);
                    return { 
                      name: subFile, 
                      isDirectory: stat.isDirectory(), 
                      path: subPath,
                      size: stat.size || 0
                    };
                  } catch {
                    return { 
                      name: subFile, 
                      isDirectory: false, 
                      path: `${file.path}/${subFile}`,
                      size: 0
                    };
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
              const subTree = await this.generateSimpleTree(file.path, sortedSubFiles, depth + 1, nextPrefix, showAll, maxDepth, showSize);
              result += subTree;
            }
          } catch {
            // サブディレクトリの読み取りに失敗した場合は無視
          }
        }
      } else {
        result += `${prefix}${connector}${file.name}${sizeInfo}\n`;
      }
    }
    
    return result;
  }

  // ファイルサイズをフォーマット
  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // ファイルとディレクトリの数を数える
  private async countFilesAndDirs(
    basePath: string, 
    showAll = false, 
    maxDepth = 3, 
    currentDepth = 0
  ): Promise<{ dirCount: number; fileCount: number }> {
    let dirCount = 0;
    let fileCount = 0;

    if (currentDepth >= maxDepth) {
      return { dirCount, fileCount };
    }

    try {
      const files = await this.fs.promises.readdir(basePath);
      
      // フィルタリング条件を調整
      let filteredFiles = files;
      if (!showAll) {
        filteredFiles = files.filter(f => 
          f !== '.git' && 
          f !== '.' && 
          f !== '..' &&
          !f.startsWith('.git') &&
          !f.startsWith('.')
        );
      } else {
        filteredFiles = files.filter(f => 
          f !== '.git' && 
          f !== '.' && 
          f !== '..' &&
          !f.startsWith('.git')
        );
      }

      for (const file of filteredFiles) {
        try {
          const filePath = `${basePath}/${file}`;
          const stat = await this.fs.promises.stat(filePath);
          
          if (stat.isDirectory()) {
            dirCount++;
            // 再帰的にサブディレクトリを数える
            const subCounts = await this.countFilesAndDirs(filePath, showAll, maxDepth, currentDepth + 1);
            dirCount += subCounts.dirCount;
            fileCount += subCounts.fileCount;
          } else {
            fileCount++;
          }
        } catch {
          // ファイルアクセスエラーは無視
        }
      }
    } catch {
      // ディレクトリアクセスエラーは無視
    }

    return { dirCount, fileCount };
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
                // IndexedDBにも同期（touchのようにtry-catchで握りつぶす）
        if (this.onFileOperation) {
          const relativePath = this.getRelativePathFromProject(normalizedPath);
          try {
            await this.executeFileOperation(relativePath, 'folder');
          } catch (syncError) {
            console.error(`[mkdir] IndexedDB sync failed: ${relativePath}`, syncError);
          }
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
              await this.executeFileOperation(relativePath, 'folder', undefined, false, false, undefined);
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
            await this.executeFileOperation(relativePath, 'file', '', false, false, undefined);
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
    return this.executeUnixOperation(async () => {
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
          await this.onFileOperation('.', 'folder', undefined, false, false, undefined);
          
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
            await this.onFileOperation('.', 'folder', undefined, false, false, undefined);
            
            // 追加的な同期処理（Git削除検知を確実にするため）
            await new Promise(resolve => setTimeout(resolve, 200));
            await this.flushFileSystemCache();
          }
          return result.message || `removed '${fileName}'`;
        } else {
          return `file or dir: '${fileName}' not found`;
          //throw new Error(result.error || `cannot remove '${fileName}'`);
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
                  if (this.onFileOperation) await this.onFileOperation(relChildPath, 'delete', undefined, false, false, undefined);
                } else {
                  if (this.onFileOperation) await this.onFileOperation(relChildPath, 'delete', undefined, false, false, undefined);
                }
              } catch {}
            }
            // 最後に自身（ディレクトリ）
            const relDirPath = this.getRelativePathFromProject(dir);
            if (this.onFileOperation) await this.onFileOperation(relDirPath, 'delete', undefined, false, false, undefined);
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
          await this.onFileOperation(relPath, 'delete', undefined, false, false, undefined);
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
  private async executeUnixOperation<T>(operation: () => Promise<T>, errorPrefix: string): Promise<T> {
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
          await this.executeFileOperation(relativePath, 'file', content);
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

  // mv - ファイル/ディレクトリの移動・名前変更
  async mv(source: string, destination: string): Promise<string> {
    return this.executeUnixOperation(async () => {
      console.log('[mv] Starting move operation:', { source, destination, currentDir: this.currentDir });
      
      // プロジェクトディレクトリの確認
      await this.ensureProjectDirectory();
      
      // ワイルドカード対応
      if (source.includes('*') || source.includes('?')) {
        return await this.moveMultipleFiles(source, destination);
      }
      
      // 単一ファイル/ディレクトリの移動
      return await this.moveSingleFile(source, destination);
    }, `mv operation failed`);
  }

  // 単一ファイル/ディレクトリ移動
  private async moveSingleFile(source: string, destination: string): Promise<string> {
    // パスの正規化
    const srcPath = source.startsWith('/') ? source : `${this.currentDir}/${source}`;
    const destPath = destination.startsWith('/') ? destination : `${this.currentDir}/${destination}`;
    const srcNormalized = this.normalizePath(srcPath);
    const destNormalized = this.normalizePath(destPath);
    
    console.log('[mv] Normalized paths:', { srcNormalized, destNormalized });
    
    // プロジェクトルート制限の確認
    const projectRoot = getProjectDir(this.currentDir.split('/')[2]);
    if (!srcNormalized.startsWith(projectRoot) || !destNormalized.startsWith(projectRoot)) {
      throw new Error('mv: Permission denied - Cannot move files outside project directory');
    }
    
    // ソースファイル/ディレクトリの存在確認
    let srcStat;
    try {
      srcStat = await this.fs.promises.stat(srcNormalized);
    } catch {
      throw new Error(`mv: cannot stat '${source}': No such file or directory`);
    }
    
    // 移動先の処理
    let finalDestPath = destNormalized;
    let isRename = false;
    
    try {
      const destStat = await this.fs.promises.stat(destNormalized);
      if (destStat.isDirectory()) {
        // 移動先がディレクトリの場合、その中にソースファイル/ディレクトリを移動
        const baseName = srcNormalized.substring(srcNormalized.lastIndexOf('/') + 1);
        finalDestPath = `${destNormalized}/${baseName}`;
      } else {
        // 移動先が既存ファイルの場合は上書き
        isRename = true;
      }
    } catch {
      // 移動先が存在しない場合は名前変更
      isRename = true;
    }
    
    // 同じパスへの移動はエラー
    if (srcNormalized === finalDestPath) {
      throw new Error(`mv: '${source}' and '${destination}' are the same file`);
    }
    
    // 移動先が移動元の子ディレクトリでないことを確認
    if (srcStat.isDirectory() && finalDestPath.startsWith(srcNormalized + '/')) {
      throw new Error(`mv: cannot move '${source}' to a subdirectory of itself, '${destination}'`);
    }
    
    console.log('[mv] Final destination path:', finalDestPath);
    
    // 移動処理の実行
    if (srcStat.isDirectory()) {
      // ディレクトリの移動
      await this.moveDirectory(srcNormalized, finalDestPath);
      console.log('[mv] Directory moved successfully');
    } else {
      // ファイルの移動
      await this.moveFile(srcNormalized, finalDestPath);
      console.log('[mv] File moved successfully');
    }
    
    // ファイルシステムキャッシュのフラッシュ
    await this.flushFileSystemCache();
    
    // プロジェクト全体の更新を通知
    if (this.onFileOperation) {
      console.log('[mv] Triggering project refresh after move operation');
      await this.onFileOperation('.', 'folder', undefined, false, false, undefined);
      
      // 追加的な同期処理
      await new Promise(resolve => setTimeout(resolve, 200));
      await this.flushFileSystemCache();
    }
    
    return `'${source}' -> '${finalDestPath}'`;
  }

  // 複数ファイル移動（ワイルドカード対応）
  private async moveMultipleFiles(pattern: string, destination: string): Promise<string> {
    console.log('[mv] Pattern matching for move:', pattern);
    
    // 移動先がディレクトリであることを確認
    const destPath = destination.startsWith('/') ? destination : `${this.currentDir}/${destination}`;
    const destNormalized = this.normalizePath(destPath);
    
    try {
      const destStat = await this.fs.promises.stat(destNormalized);
      if (!destStat.isDirectory()) {
        throw new Error(`mv: target '${destination}' is not a directory`);
      }
    } catch {
      throw new Error(`mv: cannot stat '${destination}': No such file or directory`);
    }
    
    // パターンにマッチするファイルを取得
    const matchedFiles = await this.getMatchingFilesForMove(pattern);
    if (matchedFiles.length === 0) {
      return `mv: no matches found: ${pattern}`;
    }
    
    console.log('[mv] Matched files for move:', matchedFiles);
    
    let movedCount = 0;
    const movedFiles: string[] = [];
    const errors: string[] = [];
    
    // バッチ処理開始
    this.startBatchProcessing();
    
    try {
      for (const file of matchedFiles) {
        try {
          console.log('[mv] Moving file:', file);
          
          // 各ファイルを移動先ディレクトリに移動
          const baseName = file.substring(file.lastIndexOf('/') + 1);
          const targetPath = `${destNormalized}/${baseName}`;
          
          // 移動先に同名ファイルが存在するかチェック
          let canMove = true;
          try {
            await this.fs.promises.stat(targetPath);
            // 既存ファイルがある場合は上書き警告（UNIXの動作に合わせて続行）
            console.log(`[mv] Overwriting existing file: ${targetPath}`);
          } catch {
            // ファイルが存在しない場合は問題なし
          }
          
          if (canMove) {
            const srcStat = await this.fs.promises.stat(file);
            if (srcStat.isDirectory()) {
              await this.moveDirectory(file, targetPath);
            } else {
              await this.moveFile(file, targetPath);
            }
            
            movedCount++;
            movedFiles.push(baseName);
            console.log(`[mv] Successfully moved: ${file} -> ${targetPath}`);
          }
        } catch (error) {
          const fileName = file.substring(file.lastIndexOf('/') + 1);
          errors.push(`${fileName}: ${(error as Error).message}`);
          console.error(`[mv] Error moving file ${file}:`, error);
        }
      }
      
      // バッチ処理終了
      await this.finishBatchProcessing();
      
      // ファイルシステムキャッシュのフラッシュ
      await this.flushFileSystemCache();
      
      // プロジェクト全体の更新を通知
      if (this.onFileOperation && movedCount > 0) {
        console.log('[mv] Triggering project refresh after batch move');
        await this.onFileOperation('.', 'folder', undefined, false, false, undefined);
        
        // 追加的な同期処理
        await new Promise(resolve => setTimeout(resolve, 200));
        await this.flushFileSystemCache();
      }
      
      if (movedCount === 0) {
        const errorMsg = errors.length > 0 ? `\nErrors:\n${errors.join('\n')}` : '';
        return `mv: no files were moved${errorMsg}`;
      }
      
      const successMsg = `moved ${movedCount} file(s) to '${destination}': ${movedFiles.join(', ')}`;
      const errorMsg = errors.length > 0 ? `\nWarnings:\n${errors.join('\n')}` : '';
      return successMsg + errorMsg;
      
    } catch (error) {
      // バッチ処理をクリーンアップ
      this.batchProcessing = false;
      this.fileOperationQueue = [];
      throw error;
    }
  }

  // 移動用のパターンマッチング
  private async getMatchingFilesForMove(pattern: string): Promise<string[]> {
    try {
      console.log('[mv] Pattern matching for move:', pattern);
      
      // パターンのディレクトリ部分を取得
      const lastSlashIndex = pattern.lastIndexOf('/');
      let searchDir = this.currentDir;
      let filePattern = pattern;
      
      if (lastSlashIndex !== -1) {
        const dirPart = pattern.substring(0, lastSlashIndex);
        filePattern = pattern.substring(lastSlashIndex + 1);
        searchDir = dirPart.startsWith('/') ? dirPart : `${this.currentDir}/${dirPart}`;
        searchDir = this.normalizePath(searchDir);
      }
      
      console.log('[mv] Search directory:', searchDir, 'Pattern:', filePattern);
      
      // 検索ディレクトリの内容を取得
      const files = await this.fs.promises.readdir(searchDir);
      // .git関連のファイルは除外
      const filteredFiles = files.filter(file => 
        file !== '.git' && 
        !file.startsWith('.git')
      );
      
      console.log('[mv] Available files for pattern matching:', filteredFiles);
      
      if (filePattern === '*') {
        // すべてのファイル（.git関連を除く）
        return filteredFiles.map(file => `${searchDir}/${file}`);
      }
      
      // ワイルドカードパターンをRegExpに変換
      const regexPattern = filePattern
        .replace(/\./g, '\\.')  // . を \. にエスケープ
        .replace(/\*/g, '.*')   // * を .* に変換
        .replace(/\?/g, '.');   // ? を . に変換
      
      const regex = new RegExp(`^${regexPattern}$`);
      const matchedFiles = filteredFiles
        .filter(file => regex.test(file))
        .map(file => `${searchDir}/${file}`);
      
      console.log('[mv] Matched files:', matchedFiles);
      return matchedFiles;
    } catch (error) {
      console.error('[mv] Error getting matching files:', error);
      return [];
    }
  }

  // ファイル移動のヘルパーメソッド
  private async moveFile(srcPath: string, destPath: string): Promise<void> {
    try {
      // 移動先の親ディレクトリを作成
      const parentDir = destPath.substring(0, destPath.lastIndexOf('/'));
      if (parentDir && parentDir !== '/') {
        try {
          await this.fs.promises.stat(parentDir);
        } catch {
          await this.fs.promises.mkdir(parentDir, { recursive: true } as any);
          if (this.onFileOperation) {
            const relParentPath = this.getRelativePathFromProject(parentDir);
            await this.executeFileOperation(relParentPath, 'folder');
          }
        }
      }
      
      // ファイル内容を読み取り
      const content = await this.fs.promises.readFile(srcPath, { encoding: 'utf8' });
      
      // 新しい場所にファイルを作成
      await this.fs.promises.writeFile(destPath, content);
      
      // 元のファイルを削除
      await this.fs.promises.unlink(srcPath);
      
      // IndexedDBの同期
      if (this.onFileOperation) {
        const srcRelPath = this.getRelativePathFromProject(srcPath);
        const destRelPath = this.getRelativePathFromProject(destPath);
        
        // 移動先に新しいファイルを作成
        await this.executeFileOperation(destRelPath, 'file', content as string);
        
        // 移動元のファイルを削除
        await this.executeFileOperation(srcRelPath, 'delete');
      }
    } catch (error) {
      throw new Error(`Failed to move file: ${(error as Error).message}`);
    }
  }

  // ディレクトリ移動のヘルパーメソッド
  private async moveDirectory(srcPath: string, destPath: string): Promise<void> {
    try {
      // バッチ処理開始
      this.startBatchProcessing();
      
      // 移動先ディレクトリを作成
      await this.fs.promises.mkdir(destPath, { recursive: true } as any);
      
      // ディレクトリの内容を再帰的にコピー
      await this.copyDirectoryForMove(srcPath, destPath);
      
      // 元のディレクトリを削除
      await this.rmdir(srcPath);
      
      // バッチ処理終了
      await this.finishBatchProcessing();
      
      // IndexedDBの同期
      if (this.onFileOperation) {
        const srcRelPath = this.getRelativePathFromProject(srcPath);
        const destRelPath = this.getRelativePathFromProject(destPath);
        
        // 移動先にディレクトリを作成
        await this.executeFileOperation(destRelPath, 'folder');
        
        // 移動元のディレクトリを削除
        await this.executeFileOperation(srcRelPath, 'delete');
      }
    } catch (error) {
      // バッチ処理をクリーンアップ
      this.batchProcessing = false;
      this.fileOperationQueue = [];
      throw new Error(`Failed to move directory: ${(error as Error).message}`);
    }
  }

  // 移動用のディレクトリコピー（IndexedDB同期付き）
  private async copyDirectoryForMove(src: string, dest: string): Promise<void> {
    const entries = await this.fs.promises.readdir(src);
    
    for (const entry of entries) {
      if (entry === '.' || entry === '..') continue;
      
      const srcPath = `${src}/${entry}`;
      const destPath = `${dest}/${entry}`;
      const stat = await this.fs.promises.stat(srcPath);
      
      if (stat.isDirectory()) {
        // サブディレクトリを作成
        await this.fs.promises.mkdir(destPath, { recursive: true } as any);
        
        // IndexedDBに同期
        if (this.onFileOperation) {
          const relPath = this.getRelativePathFromProject(destPath);
          await this.executeFileOperation(relPath, 'folder');
        }
        
        // 再帰的にコピー
        await this.copyDirectoryForMove(srcPath, destPath);
      } else {
        // ファイルをコピー
        const content = await this.fs.promises.readFile(srcPath, { encoding: 'utf8' });
        await this.fs.promises.writeFile(destPath, content);
        
        // IndexedDBに同期
        if (this.onFileOperation) {
          const relPath = this.getRelativePathFromProject(destPath);
          await this.executeFileOperation(relPath, 'file', content as string);
        }
      }
    }
  }
  // unzip - zipファイルを解凍
  async unzip(zipFileName: string, destDir: string, bufferContent: ArrayBuffer): Promise<string> {
    const targetPath = zipFileName.startsWith('/') ? zipFileName : `${this.currentDir}/${zipFileName}`;
    const normalizedPath = this.normalizePath(targetPath);
    const extractDir = destDir
      ? (destDir.startsWith('/') ? destDir : `${this.currentDir}/${destDir}`)
      : this.currentDir;
    const normalizedDest = this.normalizePath(extractDir);
    
    try {
      // zipファイルの内容を取得
      console.log('[unzip] bufferContent:', bufferContent);
      const data = bufferContent || await this.fs.promises.readFile(normalizedPath);
      console.log('[unzip] data (used for JSZip):', data);
      const zip = await JSZip.loadAsync(data);
      let fileCount = 0;
      let updated = false;
      
      // バッチ処理開始
      this.startBatchProcessing();
      
      // zip内の全ファイルを展開
      for (const relPath in zip.files) {
        const file = zip.files[relPath];
        
        // 空のパスや親ディレクトリ参照はスキップ
        if (!relPath || relPath === '/' || relPath.includes('../')) {
          continue;
        }
        
        const destPath = `${normalizedDest}/${relPath}`;
        const normalizedFilePath = this.normalizePath(destPath);
        const relativePath = this.getRelativePathFromProject(normalizedFilePath);

        console.log(`[unzip] Processing: ${relPath}, dir: ${file.dir}, relativePath: ${relativePath}`);

        if (file.dir || relPath.endsWith('/')) {
          // ディレクトリの場合
          try {
            await this.fs.promises.mkdir(normalizedFilePath, { recursive: true } as any);
            console.log(`[unzip] Created directory: ${normalizedFilePath}`);
            updated = true;
            
            // バッチキューに追加
            await this.executeFileOperation(relativePath, 'folder');
          } catch (dirError) {
            if ((dirError as any).code !== 'EEXIST') {
              console.error(`[unzip] Failed to create directory ${normalizedFilePath}:`, dirError);
            }
          }
        } else {
          // ファイルの場合
          try {
            // 親ディレクトリを確実に作成
            const parentDir = normalizedFilePath.substring(0, normalizedFilePath.lastIndexOf('/'));
            if (parentDir && parentDir !== normalizedDest) {
              try {
                await this.fs.promises.mkdir(parentDir, { recursive: true } as any);
              } catch (mkdirError) {
                if ((mkdirError as any).code !== 'EEXIST') {
                  console.warn(`[unzip] Failed to create parent directory ${parentDir}:`, mkdirError);
                }
              }
            }
            
            // ファイルが既に存在する場合はスキップ
            try {
              const existingStat = await this.fs.promises.stat(normalizedFilePath);
              if (existingStat.isDirectory()) {
                console.warn(`[unzip] Path is directory, skipping file write: ${normalizedFilePath}`);
                continue;
              }
              console.log(`[unzip] Skipping existing file: ${normalizedFilePath}`);
              continue;
            } catch {
              // ファイルが存在しない場合のみ作成
            }
            
            // バイナリかテキストかを判定
            let content: Uint8Array | string = await file.async('uint8array');
            let isText = false;
            let isBufferArray = false;
            
            // UTF-8としてデコードできるか簡易判定
            try {
              const text = new TextDecoder('utf-8', { fatal: true }).decode(content);
              // 拡張子でテキストファイルを判定
              if (/\.(txt|md|js|ts|jsx|tsx|json|html|css|py|sh|yml|yaml|xml|svg|csv)$/i.test(relPath)) {
                isText = true;
                content = text;
              } else {
                // 先頭が可視ASCIIならテキストとみなす
                if (/^[\x09\x0A\x0D\x20-\x7E]/.test(text.substring(0, 100))) {
                  isText = true;
                  content = text;
                }
              }
            } catch {
              isText = false;
              isBufferArray = true;
            }
            
            // ファイルシステムに書き込み
            await this.fs.promises.writeFile(normalizedFilePath, content);
            console.log(`[unzip] Created file: ${normalizedFilePath}, isText: ${isText}`);
            updated = true;
            
            // バッチキューに追加
            if (isText && typeof content === 'string') {
              await this.executeFileOperation(relativePath, 'file', content, false, false, undefined);
            } else if (isBufferArray && content instanceof Uint8Array) {
              const buffer = content.buffer instanceof ArrayBuffer ? content.buffer : new ArrayBuffer(content.byteLength);
              if (buffer !== content.buffer) {
                new Uint8Array(buffer).set(content);
              }
              await this.executeFileOperation(relativePath, 'file', undefined, false, true, buffer);
            } else {
              await this.executeFileOperation(relativePath, 'file', '', false, false, undefined);
            }
          } catch (fileError) {
            console.error(`[unzip] Failed to create file ${normalizedFilePath}:`, fileError);
          }
        }
        fileCount++;
      }
      
      // バッチ処理終了
      await this.finishBatchProcessing();
      
      await this.flushFileSystemCache();
      return `Unzipped ${fileCount} file(s) to ${normalizedDest}`;
    } catch (error) {
      // バッチ処理をクリーンアップ
      this.batchProcessing = false;
      this.fileOperationQueue = [];
      throw new Error(`unzip: ${zipFileName}: ${(error as Error).message}`);
    }
  }
}
