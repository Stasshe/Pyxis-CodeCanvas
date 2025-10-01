/**
 * [NEW ARCHITECTURE] fs モジュールのエミュレーション
 * - onFileOperationコールバックを完全に削除
 * - fileRepositoryを直接使用してIndexedDBに保存
 * - GitFileSystemへの同期は自動的に実行される
 */

import { fileRepository } from '@/engine/core/fileRepository';
import { gitFileSystem } from '@/engine/core/gitFileSystem';

export interface FSModuleOptions {
  projectDir: string;
  projectId: string;
  projectName: string;
}

export function createFSModule(options: FSModuleOptions) {
  const { projectDir, projectId, projectName } = options;
  const fs = gitFileSystem.getFS();

  if (!fs) {
    throw new Error('ファイルシステムが初期化されていません');
  }

  /**
   * パスを正規化してフルパスと相対パスを取得
   */
  function normalizePath(path: string): { fullPath: string; relativePath: string } {
    if (path.startsWith('/')) {
      return {
        fullPath: `${projectDir}${path}`,
        relativePath: path,
      };
    } else {
      return {
        fullPath: `${projectDir}/${path}`,
        relativePath: `/${path}`,
      };
    }
  }

  /**
   * ディレクトリを再帰的に作成
   */
  async function ensureDirectory(dirPath: string): Promise<void> {
    const parts = dirPath.split('/').filter(Boolean);
    let currentPath = '';

    for (const part of parts) {
      currentPath += `/${part}`;
      try {
        await fs.promises.stat(currentPath);
      } catch {
        await fs.promises.mkdir(currentPath);
      }
    }
  }

  /**
   * ファイルを書き込む（IndexedDBに保存し、自動的にGitFileSystemに同期）
   */
  async function handleWriteFile(
    path: string,
    data: string | Uint8Array,
    isNodeRuntime: boolean = true
  ): Promise<void> {
    const { fullPath, relativePath } = normalizePath(path);

    // 親ディレクトリを作成
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    if (parentDir && parentDir !== projectDir) {
      await ensureDirectory(parentDir);

      // 親ディレクトリをIndexedDBに作成
      const parentRelativePath = parentDir.replace(projectDir, '');
      if (parentRelativePath) {
        try {
          const existingFiles = await fileRepository.getProjectFiles(projectId);
          const folderExists = existingFiles.some(
            f => f.path === parentRelativePath && f.type === 'folder'
          );

          if (!folderExists) {
            await fileRepository.createFile(projectId, parentRelativePath, '', 'folder');
          }
        } catch (error) {
          console.error('[fsModule] Failed to create parent directory in IndexedDB:', error);
        }
      }
    }

    // GitFileSystemに書き込み
    await fs.promises.writeFile(fullPath, data);
    await gitFileSystem.flush();

    // IndexedDBに保存（自動的にGitFileSystemに同期される）
    try {
      const existingFiles = await fileRepository.getProjectFiles(projectId);
      const existingFile = existingFiles.find(f => f.path === relativePath);

      if (existingFile) {
        // 既存ファイルを更新
        const content = typeof data === 'string' ? data : '';
        const bufferContent =
          typeof data === 'string'
            ? undefined
            : data.buffer instanceof ArrayBuffer
              ? data.buffer
              : undefined;

        await fileRepository.saveFile({
          ...existingFile,
          content,
          bufferContent,
          updatedAt: new Date(),
        });
      } else {
        // 新規ファイルを作成
        const content = typeof data === 'string' ? data : '';
        const isBufferArray = typeof data !== 'string';
        const bufferContent =
          isBufferArray && data.buffer instanceof ArrayBuffer ? data.buffer : undefined;

        await fileRepository.createFile(
          projectId,
          relativePath,
          content,
          'file',
          isBufferArray,
          bufferContent
        );
      }
    } catch (error) {
      console.error('[fsModule] Failed to sync file to IndexedDB:', error);
    }
  }

  const fsModule = {
    /**
     * ファイルを読み取る
     */
    readFile: async (path: string, options?: any): Promise<string | Uint8Array> => {
      try {
        const { fullPath } = normalizePath(path);
        const content = await fs.promises.readFile(fullPath, { encoding: 'utf8' });

        // エンコーディングが指定されていない場合はUint8Arrayを返す
        if (options && options.encoding === null) {
          const encoder = new TextEncoder();
          return encoder.encode(content as string);
        }

        return content as string;
      } catch (error) {
        throw new Error(`ファイルの読み取りに失敗しました: ${path} - ${(error as Error).message}`);
      }
    },

    /**
     * ファイルに書き込む
     */
    writeFile: async (path: string, data: string | Uint8Array, options?: any): Promise<void> => {
      try {
        await handleWriteFile(path, data, true);
      } catch (error) {
        throw new Error(`ファイルの書き込みに失敗しました: ${path}`);
      }
    },

    /**
     * ファイルを同期的に読み取る（非同期に変換）
     */
    readFileSync: (path: string, options?: any): Promise<string | Uint8Array> => {
      console.warn(
        '⚠️  fs.readFileSync detected: Converting to async operation. Please await the result or use .then()'
      );
      return fsModule.readFile(path, options);
    },

    /**
     * ファイルに同期的に書き込む（非同期に変換）
     */
    writeFileSync: (path: string, data: string | Uint8Array, options?: any): Promise<void> => {
      console.warn(
        '⚠️  fs.writeFileSync detected: Converting to async operation. Please await the result or use .then()'
      );
      return fsModule.writeFile(path, data, options);
    },

    /**
     * ファイル/ディレクトリの存在を確認
     */
    existsSync: async (path: string): Promise<boolean> => {
      try {
        const { fullPath } = normalizePath(path);
        await fs.promises.stat(fullPath);
        return true;
      } catch {
        return false;
      }
    },

    /**
     * ファイルに非同期で書き込む
     */
    asyncWriteFile: async (
      path: string,
      data: string | Uint8Array,
      options?: any
    ): Promise<void> => {
      await fsModule.writeFile(path, data, options);
    },

    /**
     * ファイルを非同期で読み取る
     */
    asyncReadFile: async (path: string, options?: any): Promise<string | Uint8Array> => {
      return await fsModule.readFile(path, options);
    },

    /**
     * ファイルを非同期で削除
     */
    asyncRemoveFile: async (path: string): Promise<void> => {
      await fsModule.unlink(path);
    },

    /**
     * ディレクトリを作成
     */
    mkdir: async (path: string, options?: any): Promise<void> => {
      const { fullPath, relativePath } = normalizePath(path);
      const recursive = options?.recursive || false;

      if (recursive) {
        await ensureDirectory(fullPath);
      } else {
        await fs.promises.mkdir(fullPath);
      }

      // IndexedDBに作成（自動的にGitFileSystemに同期される）
      try {
        const existingFiles = await fileRepository.getProjectFiles(projectId);
        const folderExists = existingFiles.some(
          f => f.path === relativePath && f.type === 'folder'
        );

        if (!folderExists) {
          await fileRepository.createFile(projectId, relativePath, '', 'folder');
        }
      } catch (error) {
        console.error('[fsModule] Failed to create directory in IndexedDB:', error);
      }
    },

    /**
     * ディレクトリの内容を読み取る
     */
    readdir: async (path: string, options?: any): Promise<string[]> => {
      try {
        const { fullPath } = normalizePath(path);
        return await fs.promises.readdir(fullPath);
      } catch (error) {
        throw new Error(`ディレクトリの読み取りに失敗しました: ${path}`);
      }
    },

    /**
     * ファイルを削除
     */
    unlink: async (path: string): Promise<void> => {
      const { fullPath, relativePath } = normalizePath(path);

      // GitFileSystemから削除
      await fs.promises.unlink(fullPath);
      await gitFileSystem.flush();

      // IndexedDBから削除（自動的にGitFileSystemに同期される）
      try {
        const existingFiles = await fileRepository.getProjectFiles(projectId);
        const file = existingFiles.find(f => f.path === relativePath);

        if (file) {
          await fileRepository.deleteFile(file.id);
        }
      } catch (error) {
        console.error('[fsModule] Failed to delete file from IndexedDB:', error);
      }
    },

    /**
     * ファイルに追記
     */
    appendFile: async (path: string, data: string, options?: any): Promise<void> => {
      try {
        const { fullPath } = normalizePath(path);
        let existingContent = '';

        try {
          existingContent = (await fs.promises.readFile(fullPath, {
            encoding: 'utf8',
          })) as string;
        } catch {
          // ファイルが存在しない場合は新規作成
        }

        await handleWriteFile(path, existingContent + data, true);
      } catch (error) {
        throw new Error(`ファイルへの追記に失敗しました: ${path}`);
      }
    },

    /**
     * ファイル/ディレクトリの情報を取得
     */
    stat: async (path: string): Promise<any> => {
      try {
        const { fullPath } = normalizePath(path);
        return await fs.promises.stat(fullPath);
      } catch (error) {
        throw new Error(`ファイル情報の取得に失敗しました: ${path}`);
      }
    },
  };

  // fs.promisesプロパティを追加
  (fsModule as any).promises = fsModule;

  return fsModule;
}
