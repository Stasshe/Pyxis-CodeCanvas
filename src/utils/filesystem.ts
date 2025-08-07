// Lightning-FS配下の全ファイル・ディレクトリを再帰的に取得
export const getAllFilesAndDirs = async (baseDir: string = '/projects'): Promise<Array<{ path: string; content?: string; type: 'file' | 'folder' }>> => {
  const fs = getFileSystem();
  if (!fs) return [];
  const result: Array<{ path: string; content?: string; type: 'file' | 'folder' }> = [];

  async function walk(currentPath: string) {
    if (!fs) return;
    let stat;
    try {
      stat = await fs.promises.stat(currentPath);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      if (currentPath !== baseDir) {
        result.push({ path: currentPath.replace(baseDir, '') || '/', type: 'folder' });
      }
      let files: string[] = [];
      try {
        files = await fs.promises.readdir(currentPath);
      } catch { return; }
      for (const file of files) {
        if (file === '.' || file === '..' || file === '.git' || file.startsWith('.git')) continue;
        await walk(`${currentPath}/${file}`);
      }
    } else {
      // ファイル
      let content = '';
      try {
        content = await fs.promises.readFile(currentPath, { encoding: 'utf8' });
      } catch {}
      result.push({ path: currentPath.replace(baseDir, ''), content, type: 'file' });
    }
  }
  await walk(baseDir);
  return result;
};
import FS from '@isomorphic-git/lightning-fs';

// 仮想ファイルシステムのインスタンス
let fs: FS | null = null;

// ファイルシステムの初期化
export const initializeFileSystem = () => {
  if (typeof window !== 'undefined' && !fs) {
    fs = new FS('pyxis-fs');
    
    // 基本ディレクトリ構造を非同期で作成
    setTimeout(async () => {
      try {
        console.log('Initializing /projects directory...');
        await fs!.promises.mkdir('/projects', { recursive: true } as any);
        console.log('Successfully initialized /projects directory');
      } catch (error) {
        // EEXISTエラーは正常（既に存在する）
        if ((error as any).code === 'EEXIST') {
          console.log('/projects directory already exists');
        } else {
          console.warn('Failed to initialize /projects directory:', error);
          /*
          // フォールバック: 手動でディレクトリを作成
          try {
            await fs!.promises.mkdir('/projects');
            console.log('Successfully created /projects directory (fallback)');
          } catch (fallbackError) {
            if ((fallbackError as any).code === 'EEXIST') {
              console.log('/projects directory already exists (fallback check)');
            } else {
              console.error('Fallback directory creation failed:', fallbackError);
            }
          }
          */
        }
      }
    }, 0);
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
  if (!fs) {
    console.error('FileSystem not available');
    return;
  }

  const projectDir = getProjectDir(projectName);
  
  try {
    // まず/projectsディレクトリを確実に作成
    //console.log('Ensuring /projects directory exists...');
    await ensureDirectoryExists(fs, '/projects');
    
    // プロジェクトディレクトリを作成
    //console.log('Ensuring project directory exists:', projectDir);
    await ensureDirectoryExists(fs, projectDir);
    
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
    //console.log('Creating directories:', directories.map(d => d.path));
    
    for (const dir of directories) {
      const fullPath = `${projectDir}${dir.path}`;
      try {
        await ensureDirectoryExists(fs, fullPath);
      } catch (error) {
        console.warn(`Failed to create directory ${fullPath}:`, error);
      }
    }

    // ファイルを作成
    const fileItems = files.filter(f => f.type === 'file');
    
    for (const file of fileItems) {
      const fullPath = `${projectDir}${file.path}`;
      
      // 親ディレクトリパスを取得
      const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
      
      // 親ディレクトリを確実に作成
      if (parentDir && parentDir !== projectDir) {
        try {
          await ensureDirectoryExists(fs, parentDir);
        } catch (error) {
          console.warn(`Failed to ensure parent directory ${parentDir}:`, error);
        }
      }
      
      try {
        await fs.promises.writeFile(fullPath, file.content || '');
        // console.log(`Successfully synced file: ${fullPath}`);
        
        // // ファイル作成後に存在確認
        // try {
        //   const stat = await fs.promises.stat(fullPath);
        //   console.log(`File verified: ${fullPath}, size: ${stat.size}`);
        // } catch {
        //   console.warn(`File verification failed: ${fullPath}`);
        // }
      } catch (error) {
        console.error(`Failed to sync file ${fullPath}:`, error);
        
        // ENOENTエラーの場合は再度ディレクトリ作成を試行
        if ((error as any).code === 'ENOENT') {
          console.log(`Retrying file creation for: ${fullPath}`);
          
          // パス全体を再度作成
          const allPathSegments = fullPath.split('/').filter(segment => segment !== '');
          const fileName = allPathSegments.pop(); // ファイル名を除去
          
          let currentPath = '';
          for (const segment of allPathSegments) {
            currentPath += '/' + segment;
            try {
              await fs.promises.mkdir(currentPath);
              //console.log(`Retry - Created directory: ${currentPath}`);
            } catch (mkdirError) {
              if ((mkdirError as any).code !== 'EEXIST') {
                console.warn(`Retry - Failed to create directory ${currentPath}:`, mkdirError);
              }
            }
          }
          
          // ファイル作成を再試行
          try {
            await fs.promises.writeFile(fullPath, file.content || '');
            console.log(`Successfully synced file after retry: ${fullPath}`);
          } catch (retryError) {
            console.error(`Failed to sync file after retry ${fullPath}:`, retryError);
          }
        }
      }
    }
    
    //console.log('File sync completed, verifying filesystem state...');
    /*
    // 最終的なファイルシステム状態を確認
    try {
      const finalFiles = await fs.promises.readdir(projectDir);
      console.log('Final project directory contents:', finalFiles);
    } catch (error) {
      console.warn('Failed to verify final filesystem state:', error);
    }
    */
  } catch (error) {
    console.error('Failed to sync project files:', error);
  }
};

// 単一ファイルをファイルシステムに同期（作成・更新・削除対応）
export const syncFileToFileSystem = async (
  projectName: string, 
  filePath: string, 
  content: string | null, 
  operation?: 'create' | 'update' | 'delete'
) => {
  const fs = getFileSystem();
  if (!fs) {
    return;
  }

  const projectDir = getProjectDir(projectName);
  const fullPath = `${projectDir}${filePath}`;
  
  try {
    // プロジェクトディレクトリの存在を確認
    try {
      await fs.promises.stat(projectDir);
    } catch {
      await fs.promises.mkdir(projectDir, { recursive: true } as any);
    }
    
    // 削除操作の場合
    if (operation === 'delete' || content === null) {
      try {
        // ファイルが存在するかチェック
        await fs.promises.stat(fullPath);
        // ファイルを削除
        await fs.promises.unlink(fullPath);
        console.log(`[syncFileToFileSystem] Successfully deleted: ${fullPath}`);
      } catch (deleteError) {
        // ファイルが存在しない場合は警告のみ
        if ((deleteError as any).code === 'ENOENT') {
          console.warn(`[syncFileToFileSystem] File already deleted or not found: ${fullPath}`);
        } else {
          console.error(`[syncFileToFileSystem] Failed to delete file ${fullPath}:`, deleteError);
          throw deleteError;
        }
      }
    } else {
      // 作成・更新操作の場合
      // 親ディレクトリが存在することを確認
      const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
      if (parentDir && parentDir !== projectDir) {
        try {
          await fs.promises.stat(parentDir);
        } catch {
          await fs.promises.mkdir(parentDir, { recursive: true } as any);
        }
      }
      
      // ファイルを書き込み
      await fs.promises.writeFile(fullPath, content);
      console.log(`[syncFileToFileSystem] Successfully synced: ${fullPath}`);
    }
    
    // ファイルシステムの同期を確実にする
    if ((fs as any).sync) {
      try {
        await (fs as any).sync();
        console.log(`[syncFileToFileSystem] FileSystem cache flushed for: ${fullPath}`);
      } catch (syncError) {
        console.warn(`[syncFileToFileSystem] FileSystem sync failed for: ${fullPath}`, syncError);
      }
    }
  } catch (error) {
    console.error(`[syncFileToFileSystem] Failed to sync file ${fullPath}:`, error);
  }
};

// 後方互換性のためのオーバーロード関数（削除予定）
export const syncFileToFileSystemLegacy = async (projectName: string, filePath: string, content: string) => {
  return syncFileToFileSystem(projectName, filePath, content, 'update');
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

// 確実にディレクトリを作成する関数
export const ensureDirectoryExists = async (fs: FS, dirPath: string): Promise<void> => {
  const pathSegments = dirPath.split('/').filter(segment => segment !== '');
  let currentPath = '';
  
  for (const segment of pathSegments) {
    currentPath += '/' + segment;
    try {
      await fs.promises.stat(currentPath);
      // ディレクトリが存在する場合は次に進む（ログは出力しない）
    } catch {
      // ディレクトリが存在しない場合は作成
      try {
        await fs.promises.mkdir(currentPath);
        //console.log(`Created directory: ${currentPath}`);
      } catch (error) {
        if ((error as any).code === 'EEXIST') {
          // ディレクトリが既に存在する場合は正常
          console.log(`Directory already exists: ${currentPath}`);
        } else {
          console.warn(`Failed to create directory ${currentPath}:`, error);
          throw error;
        }
      }
    }
  }
};

// デバッグ用: ファイルシステムの状態を確認
export const debugFileSystem = async () => {
  const fs = getFileSystem();
  if (!fs) {
    console.log('FileSystem not available');
    return;
  }

  try {
    console.log('=== FileSystem Debug ===');
    
    // ルートディレクトリの確認
    try {
      const rootFiles = await fs.promises.readdir('/');
      console.log('Root directory contents:', rootFiles);
    } catch (error) {
      console.log('Failed to read root directory:', error);
    }
    
    // /projectsディレクトリの確認
    try {
      const projectsFiles = await fs.promises.readdir('/projects');
      console.log('/projects directory contents:', projectsFiles);
    } catch (error) {
      console.log('/projects directory does not exist or cannot be read:', error);
    }
    
    console.log('=== End Debug ===');
  } catch (error) {
    console.error('Debug failed:', error);
  }
};

// クラスのエクスポート
export { UnixCommands } from './cmd/unix';
export { GitCommands } from './cmd/git';
export { NpmCommands } from './cmd/npm';
