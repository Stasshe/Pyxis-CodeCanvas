import { fileRepository } from '@/engine/core/fileRepository';

interface PyodideInterface {
  runPythonAsync(code: string): Promise<any>;
  FS: {
    readdir(path: string): string[];
    readFile(path: string, options: { encoding: string }): string;
    writeFile(path: string, content: string): void;
    mkdir(path: string): void;
    rmdir(path: string): void;
    unlink(path: string): void;
    isDir(mode: number): boolean;
    stat(path: string): { mode: number };
  };
  loadPackage(packages: string[]): Promise<void>;
}

let pyodideInstance: PyodideInterface | null = null;
let currentProjectId: string | null = null;
let currentProjectName: string | null = null;

export async function initPyodide(): Promise<PyodideInterface> {
  if (pyodideInstance) {
    return pyodideInstance;
  }

  // @ts-ignore
  const pyodide = await window.loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/',
    stdout: (msg: string) => console.log('[Python]', msg),
    stderr: (msg: string) => console.error('[Python]', msg),
  });

  pyodideInstance = pyodide;
  return pyodide;
}

export function getPyodide(): PyodideInterface | null {
  return pyodideInstance;
}

export async function setCurrentProject(projectId: string, projectName: string): Promise<void> {
  currentProjectId = projectId;
  currentProjectName = projectName;
  
  // Pyodideが初期化されていれば、ファイルシステムを同期
  if (pyodideInstance && projectId) {
    await syncPyodideFromIndexedDB(projectId);
  }
}

/**
 * IndexedDBからPyodideのファイルシステムへ同期
 * NEW-ARCHITECTURE: fileRepositoryから読み取り、Pyodideに書き込むだけ
 */
export async function syncPyodideFromIndexedDB(projectId: string): Promise<void> {
  const pyodide = await initPyodide();
  
  try {
    // IndexedDBから全ファイルを取得
    const files = await fileRepository.getProjectFiles(projectId);
    
    // Pyodideのファイルシステムをクリア（/homeディレクトリを再作成）
    try {
      const homeContents = pyodide.FS.readdir('/home');
      for (const item of homeContents) {
        if (item !== '.' && item !== '..') {
          try {
            pyodide.FS.unlink(`/home/${item}`);
          } catch {
            try {
              pyodide.FS.rmdir(`/home/${item}`);
            } catch {
              // 無視
            }
          }
        }
      }
    } catch {
      // /homeが存在しない場合は作成
      try {
        pyodide.FS.mkdir('/home');
      } catch {
        // 既に存在する場合は無視
      }
    }
    
    // 各ファイルをPyodideに書き込む
    for (const file of files) {
      if (file.type === 'file' && file.content) {
        const pyodidePath = `/home${file.path}`;
        
        // ディレクトリを作成
        const dirPath = pyodidePath.substring(0, pyodidePath.lastIndexOf('/'));
        createDirectoryRecursive(pyodide, dirPath);
        
        // ファイルを書き込む
        try {
          pyodide.FS.writeFile(pyodidePath, file.content);
        } catch (error) {
          console.warn(`Failed to write file to Pyodide: ${pyodidePath}`, error);
        }
      }
    }
    
    console.log(`Synced ${files.filter(f => f.type === 'file').length} files to Pyodide`);
  } catch (error) {
    console.error('Failed to sync Pyodide from IndexedDB:', error);
    throw error;
  }
}

/**
 * PyodideのファイルシステムからIndexedDBへ同期
 * NEW-ARCHITECTURE: Pyodideから読み取り、fileRepositoryに書き込むだけ
 * 自動的にGitFileSystemに同期される
 */
export async function syncPyodideToIndexedDB(projectId: string): Promise<void> {
  if (!pyodideInstance) {
    console.warn('Pyodide not initialized');
    return;
  }
  
  try {
    // 現在のIndexedDBファイル一覧を取得
    const existingFiles = await fileRepository.getProjectFiles(projectId);
    const existingPaths = new Set(existingFiles.map(f => f.path));
    
    // Pyodideの/homeディレクトリを再帰的にスキャン
    const pyodideFiles = scanPyodideDirectory(pyodideInstance, '/home', '');
    
    // Pyodideのファイルを同期
    for (const { path, content } of pyodideFiles) {
      const existingFile = existingFiles.find(f => f.path === path);
      
      if (existingFile) {
        // 既存ファイルの更新
        if (existingFile.content !== content) {
          await fileRepository.saveFile({
            ...existingFile,
            content,
            updatedAt: new Date(),
          });
        }
      } else {
        // 新規ファイルの作成
        await fileRepository.createFile(projectId, path, content, 'file');
      }
      
      existingPaths.delete(path);
    }
    
    // Pyodideに存在しないファイルを削除
    for (const path of existingPaths) {
      const file = existingFiles.find(f => f.path === path);
      if (file && file.type === 'file') {
        await fileRepository.deleteFile(file.id);
      }
    }
    
    console.log(`Synced ${pyodideFiles.length} files from Pyodide to IndexedDB`);
  } catch (error) {
    console.error('Failed to sync Pyodide to IndexedDB:', error);
    throw error;
  }
}

/**
 * Pyodideのディレクトリを再帰的にスキャン
 */
function scanPyodideDirectory(
  pyodide: PyodideInterface,
  pyodidePath: string,
  relativePath: string
): Array<{ path: string; content: string }> {
  const results: Array<{ path: string; content: string }> = [];
  
  try {
    const contents = pyodide.FS.readdir(pyodidePath);
    
    for (const item of contents) {
      if (item === '.' || item === '..') continue;
      
      const fullPyodidePath = `${pyodidePath}/${item}`;
      const fullRelativePath = relativePath ? `${relativePath}/${item}` : `/${item}`;
      
      try {
        const stat = pyodide.FS.stat(fullPyodidePath);
        
        if (pyodide.FS.isDir(stat.mode)) {
          // ディレクトリの場合は再帰的にスキャン
          results.push(...scanPyodideDirectory(pyodide, fullPyodidePath, fullRelativePath));
        } else {
          // ファイルの場合は内容を読み取る
          const content = pyodide.FS.readFile(fullPyodidePath, { encoding: 'utf8' });
          results.push({ path: fullRelativePath, content });
        }
      } catch (error) {
        console.warn(`Failed to process: ${fullPyodidePath}`, error);
      }
    }
  } catch (error) {
    console.warn(`Failed to read directory: ${pyodidePath}`, error);
  }
  
  return results;
}

/**
 * ディレクトリを再帰的に作成
 */
function createDirectoryRecursive(pyodide: PyodideInterface, path: string): void {
  const parts = path.split('/').filter(p => p);
  let currentPath = '';
  
  for (const part of parts) {
    currentPath += '/' + part;
    try {
      pyodide.FS.mkdir(currentPath);
    } catch {
      // ディレクトリが既に存在する場合は無視
    }
  }
}

/**
 * Pythonコードを実行（ファイルシステムの自動同期付き）
 */
export async function runPythonWithSync(
  code: string,
  projectId: string
): Promise<any> {
  const pyodide = await initPyodide();
  
  // 実行前: IndexedDBからPyodideへ同期
  await syncPyodideFromIndexedDB(projectId);
  
  // Pythonコードを実行
  const result = await pyodide.runPythonAsync(code);
  
  // 実行後: PyodideからIndexedDBへ同期（自動的にGitFileSystemにも同期される）
  await syncPyodideToIndexedDB(projectId);
  
  return result;
}
