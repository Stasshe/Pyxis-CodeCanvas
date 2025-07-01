import FS from '@isomorphic-git/lightning-fs';

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

// 単一ファイルをファイルシステムに同期
export const syncFileToFileSystem = async (projectName: string, filePath: string, content: string) => {
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
  } catch (error) {
    // ファイル同期エラーは無視（エラーログは表示しない）
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

// クラスのエクスポート
export { UnixCommands } from './cmd/unix';
export { GitCommands } from './cmd/git';
