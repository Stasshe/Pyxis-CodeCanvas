/**
 * fs モジュールのエミュレーション
 * - fileRepositoryを直接使用してIndexedDBに保存
 * - GitFileSystemへの同期は自動的に実行される
 * - 読み取りはgitFileSystem.getFS()から直接実行
 * - 書き込みはfileRepositoryのみを使用（自動同期）
 */

import { fileRepository } from '@/engine/core/fileRepository';
import {
  fsPathToAppPath,
  normalizeDotSegments,
  toAppPath,
  toFSPath,
} from '@/engine/core/pathUtils';

export interface FSModuleOptions {
  projectDir: string;
  projectId: string;
  projectName: string;
}

export function createFSModule(options: FSModuleOptions) {
  const { projectDir, projectId, projectName } = options;
  const tmpRoot = '/tmp';

  function splitOptionsAndCallback(
    options?: any,
    callback?: ((error: Error | null, data?: any) => void) | undefined
  ): {
    options: any;
    callback?: (error: Error | null, data?: any) => void;
  } {
    if (typeof options === 'function') {
      return { options: undefined, callback: options };
    }

    return { options, callback };
  }

  function createFsError(
    code: string,
    syscall: string,
    path: string,
    message?: string
  ): Error & { code: string; errno: number; syscall: string; path: string } {
    const error = new Error(
      message ?? `${code}: no such file or directory, ${syscall} '${path}'`
    ) as Error & {
      code: string;
      errno: number;
      syscall: string;
      path: string;
    };

    error.name = 'Error';
    error.code = code;
    error.errno = code === 'ENOENT' ? -2 : -1;
    error.syscall = syscall;
    error.path = path;

    return error;
  }

  function isTmpPath(path: string): boolean {
    return path === tmpRoot || path.startsWith(`${tmpRoot}/`);
  }

  function ensureTmpParents(path: string): void {
    let current = tmpRoot;
    const relative = path.slice(tmpRoot.length).split('/').filter(Boolean);
    for (const part of relative.slice(0, -1)) {
      current = `${current}/${part}`;
      tmpDirs.add(current);
    }
  }

  function encodeContent(content: string | Uint8Array): Uint8Array {
    return typeof content === 'string' ? new TextEncoder().encode(content) : content;
  }

  function decodeContent(content: string | Uint8Array): string {
    return typeof content === 'string' ? content : new TextDecoder().decode(content);
  }

  function normalizeEncoding(options?: any): string | null | undefined {
    if (typeof options === 'string') return options;
    return options?.encoding;
  }

  function formatReadContent(content: string | Uint8Array, options?: any): string | Uint8Array {
    const encoding = normalizeEncoding(options);
    if (encoding === null) {
      return encodeContent(content);
    }

    return typeof content === 'string' ? content : new TextDecoder().decode(content);
  }

  function makeStats(
    type: 'file' | 'directory',
    size = 0,
    mtime = new Date()
  ) {
    return {
      size,
      mtime,
      ctime: mtime,
      birthtime: mtime,
      atime: mtime,
      mode: type === 'directory' ? 0o40755 : 0o100644,
      isFile: () => type === 'file',
      isDirectory: () => type === 'directory',
      isSymbolicLink: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
    };
  }

  /**
   * パスを正規化してフルパスと相対パス（AppPath）を取得
   * pathResolverを使用
   * POSIX準拠: . と .. を解決
   */
  function normalizeModulePath(path: string): { fullPath: string; relativePath: string } {
    // すでにprojectDirで始まる場合（FSPath形式）
    if (path.startsWith(projectDir)) {
      const relativePath = fsPathToAppPath(path, projectName);
      // . と .. を解決
      const resolvedPath = normalizeDotSegments(relativePath);
      return {
        fullPath: toFSPath(projectName, resolvedPath),
        relativePath: resolvedPath,
      };
    }

    // AppPath形式またはGitPath形式の場合
    // まずAppPath形式に変換し、. と .. を解決
    const appPath = normalizeDotSegments(toAppPath(path));
    return {
      fullPath: toFSPath(projectName, appPath),
      relativePath: appPath,
    };
  }

  /**
   * ファイルを書き込む（IndexedDBに保存し、自動的にGitFileSystemに同期）
   * GitFileSystemへの直接書き込みは不要
   */
  async function handleWriteFile(
    path: string,
    data: string | Uint8Array,
    isNodeRuntime = true
  ): Promise<void> {
    // projectIdのバリデーション
    if (!projectId || typeof projectId !== 'string') {
      console.error('[fsModule] Invalid projectId:', projectId);
      throw new Error(`Invalid projectId: ${projectId}`);
    }

    const { relativePath } = normalizeModulePath(path);

    // 親ディレクトリをIndexedDBに作成
    const parentPath = relativePath.substring(0, relativePath.lastIndexOf('/'));
    if (parentPath) {
      try {
        // Prefer direct lookup of the parent folder instead of listing all files
        const folder = await fileRepository.getFileByPath(projectId, parentPath);
        const folderExists = folder && folder.type === 'folder';
        if (!folderExists) {
          await fileRepository.createFile(projectId, parentPath, '', 'folder');
        }
      } catch (error) {
        console.error('[fsModule] Failed to create parent directory in IndexedDB:', error);
      }
    }

    // IndexedDBに保存（自動的にGitFileSystemに同期される）
    try {
      const existingFile = await fileRepository.getFileByPath(projectId, relativePath);

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
      console.error('[fsModule] Failed to save file to IndexedDB:', error);
      throw error;
    }
  }

  // メモリキャッシュ（同期読み込み用）
  const memoryCache = new Map<string, string | Uint8Array>();
  const knownDirs = new Set<string>(['/']);
  const tmpFiles = new Map<string, string | Uint8Array>();
  const tmpDirs = new Set<string>([tmpRoot]);

  function rememberPath(path: string, type: 'file' | 'folder'): void {
    let current = '/';
    for (const part of path.split('/').filter(Boolean).slice(0, type === 'file' ? -1 : undefined)) {
      current = current === '/' ? `/${part}` : `${current}/${part}`;
      knownDirs.add(current);
    }

    if (type === 'folder') {
      knownDirs.add(path);
    }
  }

  async function getStats(path: string, syscall: 'stat' | 'lstat'): Promise<any> {
    const { relativePath } = normalizeModulePath(path);

    if (isTmpPath(relativePath)) {
      if (tmpDirs.has(relativePath)) {
        return makeStats('directory');
      }
      if (tmpFiles.has(relativePath)) {
        const content = tmpFiles.get(relativePath)!;
        return makeStats('file', encodeContent(content).length);
      }
      throw createFsError('ENOENT', syscall, path);
    }

    if (knownDirs.has(relativePath)) {
      return makeStats('directory');
    }

    if (memoryCache.has(relativePath)) {
      const content = memoryCache.get(relativePath)!;
      return makeStats('file', encodeContent(content).length);
    }

    const file = await fileRepository.getFileByPath(projectId, relativePath);
    if (!file) {
      throw createFsError('ENOENT', syscall, path);
    }

    rememberPath(relativePath, file.type);
    return makeStats(
      file.type === 'folder' ? 'directory' : 'file',
      file.content ? new TextEncoder().encode(file.content).length : 0,
      file.updatedAt
    );
  }

  function getStatsSync(path: string, syscall: 'stat' | 'lstat', options?: any): any {
    const { relativePath } = normalizeModulePath(path);
    let stats: any;

    if (isTmpPath(relativePath)) {
      if (tmpDirs.has(relativePath)) {
        stats = makeStats('directory');
      } else if (tmpFiles.has(relativePath)) {
        const content = tmpFiles.get(relativePath)!;
        stats = makeStats('file', encodeContent(content).length);
      }
    } else if (knownDirs.has(relativePath)) {
      stats = makeStats('directory');
    } else if (memoryCache.has(relativePath)) {
      const content = memoryCache.get(relativePath)!;
      stats = makeStats('file', encodeContent(content).length);
    }

    if (stats) {
      return stats;
    }

    if (options?.throwIfNoEntry === false) {
      return undefined;
    }

    throw createFsError('ENOENT', syscall, path);
  }

  const fsModule = {
    /**
     * ファイルを読み取る
     */
    readFile: (
      path: string,
      options?: any,
      callback?: (error: Error | null, data?: string | Uint8Array) => void
    ): Promise<string | Uint8Array> | void => {
      const normalized = splitOptionsAndCallback(options, callback);
      const readTask = (async (): Promise<string | Uint8Array> => {
      try {
        const { relativePath } = normalizeModulePath(path);

        if (isTmpPath(relativePath)) {
          if (!tmpFiles.has(relativePath)) {
            throw createFsError('ENOENT', 'open', path);
          }
          return formatReadContent(tmpFiles.get(relativePath)!, normalized.options);
        }

        // キャッシュにあればそれを返す
        if (memoryCache.has(relativePath)) {
          return formatReadContent(memoryCache.get(relativePath)!, normalized.options);
        }

        const file = await fileRepository.getFileByPath(projectId, relativePath);
        if (!file) {
          throw createFsError('ENOENT', 'open', path);
        }
        const content = file.content ?? '';

        // キャッシュ更新
        memoryCache.set(relativePath, content);

        return formatReadContent(content, normalized.options);
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          typeof (error as any).code === 'string'
        ) {
          throw error;
        }
        throw createFsError(
          'EIO',
          'open',
          path,
          `ファイルの読み取りに失敗しました: ${path} - ${(error as Error).message}`
        );
      }
      })();

      if (normalized.callback) {
        readTask
          .then(data => normalized.callback!(null, data))
          .catch(error => normalized.callback!(error as Error));
        return;
      }

      return readTask;
    },

    /**
     * ファイルに書き込む
     */
    writeFile: (
      path: string,
      data: string | Uint8Array,
      options?: any,
      callback?: (error: Error | null) => void
    ): Promise<void> | void => {
      const normalized = splitOptionsAndCallback(options, callback);
      const writeTask = (async (): Promise<void> => {
      try {
        const { relativePath } = normalizeModulePath(path);
        const content = typeof data === 'string' ? data : data;

        if (isTmpPath(relativePath)) {
          ensureTmpParents(relativePath);
          tmpFiles.set(relativePath, content);
          return;
        }

        // キャッシュ更新
        memoryCache.set(relativePath, content);
        rememberPath(relativePath, 'file');

        await handleWriteFile(path, data, true);
      } catch (error) {
        throw createFsError(
          'EIO',
          'write',
          path,
          `ファイルの書き込みに失敗しました: ${path}`
        );
      }
      })();

      if (normalized.callback) {
        writeTask.then(() => normalized.callback!(null)).catch(error => normalized.callback!(error as Error));
        return;
      }

      return writeTask;
    },

    /**
     * ファイルを同期的に読み取る
     * 事前にpreloadFiles()でキャッシュにロードしておく必要がある
     */
    readFileSync: (path: string, options?: any): string | Uint8Array => {
      const { relativePath } = normalizeModulePath(path);

      if (isTmpPath(relativePath)) {
        if (!tmpFiles.has(relativePath)) {
          throw createFsError('ENOENT', 'open', path);
        }
        return formatReadContent(tmpFiles.get(relativePath)!, options);
      }

      if (memoryCache.has(relativePath)) {
        return formatReadContent(memoryCache.get(relativePath)!, options);
      }

      throw createFsError('ENOENT', 'open', path);
    },

    /**
     * ファイルに同期的に書き込む（非同期に変換）
     */
    writeFileSync: (path: string, data: string | Uint8Array, options?: any): void => {
      const { relativePath } = normalizeModulePath(path);
      const content = typeof data === 'string' ? data : data;

      if (isTmpPath(relativePath)) {
        ensureTmpParents(relativePath);
        tmpFiles.set(relativePath, content);
        return;
      }

      memoryCache.set(relativePath, content);
      rememberPath(relativePath, 'file');
      fsModule.writeFile(path, data, options).catch(err => console.error(err));
    },

    /**
     * ファイル/ディレクトリの存在を確認
     */
    existsSync: (path: string): boolean => {
      const { relativePath } = normalizeModulePath(path);
      return (
        memoryCache.has(relativePath) ||
        knownDirs.has(relativePath) ||
        tmpFiles.has(relativePath) ||
        tmpDirs.has(relativePath)
      );
    },

    accessSync: (path: string): void => {
      if (!fsModule.existsSync(path)) {
        throw createFsError('ENOENT', 'access', path);
      }
    },

    /**
     * ファイルをプリロード（メモリキャッシュにロード）
     */
    preloadFiles: async (extensions: string[] = ['.json', '.txt', '.md']): Promise<void> => {
      try {
        // 全ファイルをロード（フィルタリング付き）
        // getProjectFilesは再帰的に全ファイルを取得すると仮定
        // TODO: 全ファイルは非効率。ライブでやる感じに変える。とりあえず今は動いてる。
        const files = await fileRepository.getProjectFiles(projectId);
        let count = 0;
        for (const file of files) {
          // 拡張子フィルタ（空の場合は全ファイル）
          if (extensions.length === 0 || extensions.some(ext => file.path.endsWith(ext))) {
            rememberPath(file.path, file.type);
            if (file.type === 'file' && file.content !== undefined) {
              memoryCache.set(file.path, file.content);
              count++;
            }
          }
        }
        console.log(`[fsModule] Preloaded ${count} files into memory cache.`);
      } catch (error) {
        console.error('[fsModule] Failed to preload files:', error);
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
     * IndexedDBに保存すれば自動的にGitFileSystemに同期される
     */
    mkdir: async (path: string, options?: any): Promise<void> => {
      const { relativePath } = normalizeModulePath(path);
      const recursive = options?.recursive || false;

      try {
        if (isTmpPath(relativePath)) {
          if (recursive) {
            ensureTmpParents(`${relativePath}/.keep`);
          }
          tmpDirs.add(relativePath);
          return;
        }

        if (recursive) {
          // 再帰的にディレクトリを作成 - check each path with targeted lookup
          const parts = relativePath.split('/').filter(Boolean);
          let currentPath = '';

          for (const part of parts) {
            currentPath += `/${part}`;
            const folder = await fileRepository.getFileByPath(projectId, currentPath);
            const folderExists = folder && folder.type === 'folder';

            if (!folderExists) {
              await fileRepository.createFile(projectId, currentPath, '', 'folder');
            }
            knownDirs.add(currentPath);
          }
        } else {
          // 単一ディレクトリを作成
          const folder = await fileRepository.getFileByPath(projectId, relativePath);
          const folderExists = folder && folder.type === 'folder';

          if (!folderExists) {
            await fileRepository.createFile(projectId, relativePath, '', 'folder');
          }
          knownDirs.add(relativePath);
        }
      } catch (error) {
        console.error('[fsModule] Failed to create directory in IndexedDB:', error);
        throw error;
      }
    },

    /**
     * ディレクトリの内容を読み取る
     */
    readdir: async (path: string, options?: any): Promise<string[]> => {
      try {
        const { relativePath } = normalizeModulePath(path);

        if (isTmpPath(relativePath)) {
          const dirPath = relativePath.endsWith('/') ? relativePath : `${relativePath}/`;
          return [...tmpDirs, ...tmpFiles.keys()]
            .filter(p => p.startsWith(dirPath) && p !== relativePath)
            .map(p => p.slice(dirPath.length).split('/')[0])
            .filter((v, i, arr) => v && arr.indexOf(v) === i);
        }

        const dirPath = relativePath.endsWith('/') ? relativePath : `${relativePath}/`;
        // Use prefix-based listing to avoid loading all files
        const files =
          typeof fileRepository.getFilesByPrefix === 'function'
            ? await fileRepository.getFilesByPrefix(projectId, dirPath)
            : await fileRepository.getProjectFiles(projectId);
        // 直下のファイル/フォルダ名のみ返す
        const children = files
          .filter(f => f.path.startsWith(dirPath) && f.path !== dirPath)
          .map(f => f.path.slice(dirPath.length).split('/')[0])
          .filter((v, i, arr) => v && arr.indexOf(v) === i);
        return children;
      } catch (error) {
        throw new Error(`ディレクトリの読み取りに失敗しました: ${path}`);
      }
    },

    /**
     * 同期的にディレクトリの内容を読み取る
     * 注意: IndexedDBは同期でアクセスできないため、事前に`preloadFiles()`でキャッシュをロードしておく必要があります。
     */
    readdirSync: (path: string, options?: any): string[] => {
      const { relativePath } = normalizeModulePath(path);
      const dirPath = relativePath.endsWith('/') ? relativePath : `${relativePath}/`;

      if (isTmpPath(relativePath)) {
        return [...tmpDirs, ...tmpFiles.keys()]
          .filter(p => p.startsWith(dirPath) && p !== relativePath)
          .map(p => p.slice(dirPath.length).split('/')[0])
          .filter((v, i, arr) => v && arr.indexOf(v) === i);
      }

      // メモリキャッシュから直接取得
      const keys = Array.from(memoryCache.keys());
      const children = keys
        .filter(k => k.startsWith(dirPath) && k !== dirPath)
        .map(k => k.slice(dirPath.length).split('/')[0])
        .filter((v, i, arr) => v && arr.indexOf(v) === i);

      if (children.length > 0) return children;

      // キャッシュにない場合は同期での取得はできないため警告して空配列を返す
      console.warn(
        `⚠️  fs.readdirSync: Directory not preloaded: ${path} (normalized: ${relativePath}). Returning empty array. Call preloadFiles() first.`
      );
      return [];
    },

    /**
     * ファイルを削除
     * IndexedDBから削除すれば自動的にGitFileSystemからも削除される
     */
    unlink: async (path: string): Promise<void> => {
      const { relativePath } = normalizeModulePath(path);

      if (isTmpPath(relativePath)) {
        if (!tmpFiles.delete(relativePath)) {
          throw createFsError('ENOENT', 'unlink', path);
        }
        return;
      }

      // キャッシュから削除
      if (memoryCache.has(relativePath)) {
        memoryCache.delete(relativePath);
      }

      try {
        const file = await fileRepository.getFileByPath(projectId, relativePath);
        if (file) {
          await fileRepository.deleteFile(file.id);
        } else {
          throw createFsError('ENOENT', 'unlink', path);
        }
      } catch (error) {
        console.error('[fsModule] Failed to delete file from IndexedDB:', error);
        throw error;
      }
    },

    /**
     * ファイルに追記
     */
    appendFile: async (path: string, data: string, options?: any): Promise<void> => {
      try {
        const { relativePath } = normalizeModulePath(path);
        let existingContent = '';

        // キャッシュまたはDBから取得
        if (memoryCache.has(relativePath)) {
          const cacheContent = memoryCache.get(relativePath)!;
          existingContent =
            typeof cacheContent === 'string'
              ? cacheContent
              : new TextDecoder().decode(cacheContent);
        } else {
          try {
            const file = await fileRepository.getFileByPath(projectId, relativePath);
            if (file) existingContent = file.content ?? '';
          } catch {
            // ファイルが存在しない場合は新規作成
          }
        }

        await fsModule.writeFile(path, existingContent + data, options);
      } catch (error) {
        throw new Error(`ファイルへの追記に失敗しました: ${path}`);
      }
    },

    /**
     * ファイル/ディレクトリの情報を取得
     */
    stat: async (path: string): Promise<any> => {
      try {
        return await getStats(path, 'stat');
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          typeof (error as any).code === 'string'
        ) {
          throw error;
        }

        throw createFsError(
          'EIO',
          'stat',
          path,
          `ファイル情報の取得に失敗しました: ${path}`
        );
      }
    },

    lstat: async (path: string): Promise<any> => {
      try {
        return await getStats(path, 'lstat');
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          typeof (error as any).code === 'string'
        ) {
          throw error;
        }

        throw createFsError(
          'EIO',
          'lstat',
          path,
          `ファイル情報の取得に失敗しました: ${path}`
        );
      }
    },

    statSync: (path: string, options?: any): any => getStatsSync(path, 'stat', options),
    lstatSync: (path: string, options?: any): any => getStatsSync(path, 'lstat', options),

    mkdirSync: (path: string, options?: any): void => {
      const { relativePath } = normalizeModulePath(path);
      if (isTmpPath(relativePath)) {
        if (options?.recursive) {
          ensureTmpParents(`${relativePath}/.keep`);
        }
        tmpDirs.add(relativePath);
        return;
      }

      knownDirs.add(relativePath);
      fsModule.mkdir(path, options).catch(err => console.error(err));
    },

    unlinkSync: (path: string): void => {
      const { relativePath } = normalizeModulePath(path);
      if (isTmpPath(relativePath)) {
        if (!tmpFiles.delete(relativePath)) {
          throw createFsError('ENOENT', 'unlink', path);
        }
        return;
      }

      memoryCache.delete(relativePath);
      fsModule.unlink(path).catch(err => console.error(err));
    },

    rmSync: (path: string, options?: any): void => {
      const { relativePath } = normalizeModulePath(path);
      if (isTmpPath(relativePath)) {
        if (tmpFiles.delete(relativePath)) return;
        if (tmpDirs.has(relativePath)) {
          for (const key of [...tmpFiles.keys()]) {
            if (key.startsWith(`${relativePath}/`)) tmpFiles.delete(key);
          }
          for (const key of [...tmpDirs]) {
            if (key !== tmpRoot && (key === relativePath || key.startsWith(`${relativePath}/`))) {
              tmpDirs.delete(key);
            }
          }
          return;
        }
        if (!options?.force) {
          throw createFsError('ENOENT', 'rm', path);
        }
        return;
      }

      memoryCache.delete(relativePath);
      if (!options?.recursive) return;
      for (const key of [...memoryCache.keys()]) {
        if (key.startsWith(`${relativePath}/`)) memoryCache.delete(key);
      }
    },

    constants: {
      F_OK: 0,
      R_OK: 4,
      W_OK: 2,
      X_OK: 1,
    },
  };

  (fsModule as any).promises = {
    readFile: (path: string, options?: any) => fsModule.readFile(path, options),
    writeFile: (path: string, data: string | Uint8Array, options?: any) =>
      fsModule.writeFile(path, data, options),
    stat: (path: string) => fsModule.stat(path),
    lstat: (path: string) => fsModule.lstat(path),
    readdir: (path: string, options?: any) => fsModule.readdir(path, options),
    mkdir: (path: string, options?: any) => fsModule.mkdir(path, options),
    unlink: (path: string) => fsModule.unlink(path),
    rm: async (path: string, options?: any) => fsModule.rmSync(path, options),
  };

  return fsModule;
}
