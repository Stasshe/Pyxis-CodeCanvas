/**
 * fs モジュールのエミュレーション
 *
 * Storage concerns are delegated to runtime mounts:
 * - /tmp is backed by MemoryMount
 * - /cache is backed by RuntimeCacheMount
 * - all other paths are backed by ProjectMount
 */

import {
  fsPathToAppPath,
  normalizeDotSegments,
  toAppPath,
  toFSPath,
} from '@/engine/core/pathUtils';
import type { MountRouter } from '@/engine/runtime/storage/MountRouter';
import { runtimeStorageRegistry } from '@/engine/runtime/storage/RuntimeStorageRegistry';

export interface FSModuleOptions {
  projectDir: string;
  projectId: string;
  projectName: string;
  mountRouter?: MountRouter;
  getTrackIO?: () => ((p: Promise<any>) => void) | undefined;
}

type FsCallback<T = any> = (error: Error | null, data?: T) => void;

export function createFSModule(options: FSModuleOptions) {
  const { projectDir, projectId, projectName } = options;
  const mountRouter =
    options.mountRouter ?? runtimeStorageRegistry.get(projectId, projectName).mountRouter;

  function trackTask<T>(task: Promise<T>): Promise<T> {
    options.getTrackIO?.()?.(task);
    return task;
  }

  function splitOptionsAndCallback(
    options?: any,
    callback?: FsCallback | undefined
  ): {
    options: any;
    callback?: FsCallback;
  } {
    if (typeof options === 'function') {
      return { options: undefined, callback: options };
    }

    return { options, callback };
  }

  function isPromiseLike<T>(value: void | Promise<T>): value is Promise<T> {
    return typeof value !== 'undefined';
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

  function makeStats(type: 'file' | 'directory', size = 0, mtime = new Date()) {
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

  function normalizeModulePath(path: string): { fullPath: string; relativePath: string } {
    if (path.startsWith(projectDir)) {
      const relativePath = normalizeDotSegments(fsPathToAppPath(path, projectName));
      return {
        fullPath: toFSPath(projectName, relativePath),
        relativePath,
      };
    }

    const appPath = normalizeDotSegments(toAppPath(path));
    return {
      fullPath: toFSPath(projectName, appPath),
      relativePath: appPath,
    };
  }

  async function getStats(path: string, syscall: 'stat' | 'lstat'): Promise<any> {
    const { relativePath } = normalizeModulePath(path);
    const stat = await mountRouter.resolve(relativePath).stat(relativePath);
    if (!stat) {
      throw createFsError('ENOENT', syscall, path);
    }
    return makeStats(stat.type, stat.size, stat.mtime);
  }

  function getStatsSync(path: string, syscall: 'stat' | 'lstat', options?: any): any {
    const { relativePath } = normalizeModulePath(path);
    const mount = mountRouter.resolve(relativePath);
    if (mount.hasDir(relativePath)) {
      return makeStats('directory');
    }

    const content = mount.getFileSync(relativePath);
    if (content !== undefined) {
      return makeStats('file', encodeContent(content).length);
    }

    if (options?.throwIfNoEntry === false) {
      return undefined;
    }

    throw createFsError('ENOENT', syscall, path);
  }

  function makeDirent(name: string, isDir: boolean) {
    return {
      name,
      isDirectory: () => isDir,
      isFile: () => !isDir,
      isSymbolicLink: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
    };
  }

  const fsModule = {
    readFile: (
      path: string,
      options?: any,
      callback?: FsCallback<string | Uint8Array>
    ): Promise<string | Uint8Array> | void => {
      const normalized = splitOptionsAndCallback(options, callback);
      const readTask = trackTask(
        (async (): Promise<string | Uint8Array> => {
          try {
            const { relativePath } = normalizeModulePath(path);
            const mount = mountRouter.resolve(relativePath);
            const syncContent = mount.getFileSync(relativePath);
            const content =
              syncContent !== undefined ? syncContent : await mount.getFile(relativePath);

            if (content === undefined) {
              throw createFsError('ENOENT', 'open', path);
            }

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
        })()
      );

      if (normalized.callback) {
        readTask
          .then(data => normalized.callback!(null, data))
          .catch(error => normalized.callback!(error as Error));
        return;
      }

      return readTask;
    },

    writeFile: (
      path: string,
      data: string | Uint8Array,
      options?: any,
      callback?: FsCallback<void>
    ): Promise<void> | void => {
      const normalized = splitOptionsAndCallback(options, callback);
      const writeTask = trackTask(
        (async (): Promise<void> => {
          try {
            const { relativePath } = normalizeModulePath(path);
            await mountRouter.resolve(relativePath).setFile(relativePath, data);
          } catch (error) {
            console.warn('[fsModule.ts] caught non-fatal error', error);
            throw createFsError('EIO', 'write', path, `ファイルの書き込みに失敗しました: ${path}`);
          }
        })()
      );

      if (normalized.callback) {
        writeTask
          .then(() => normalized.callback!(null))
          .catch(error => normalized.callback!(error as Error));
        return;
      }

      return writeTask;
    },

    readFileSync: (path: string, options?: any): string | Uint8Array => {
      const { relativePath } = normalizeModulePath(path);
      const content = mountRouter.resolve(relativePath).getFileSync(relativePath);
      if (content === undefined) {
        throw createFsError('ENOENT', 'open', path);
      }
      return formatReadContent(content, options);
    },

    writeFileSync: (path: string, data: string | Uint8Array, options?: any): void => {
      const writeTask = fsModule.writeFile(path, data, options);
      if (isPromiseLike(writeTask)) {
        writeTask.catch((err: unknown) => console.error(err));
      }
    },

    existsSync: (path: string): boolean => {
      const { relativePath } = normalizeModulePath(path);
      const mount = mountRouter.resolve(relativePath);
      return mount.hasFile(relativePath) || mount.hasDir(relativePath);
    },

    accessSync: (path: string): void => {
      if (!fsModule.existsSync(path)) {
        throw createFsError('ENOENT', 'access', path);
      }
    },

    preloadFiles: async (extensions: string[] = ['.json', '.txt', '.md']): Promise<void> => {
      const projectMount = mountRouter.resolve('/') as {
        preload?: (extensions: string[]) => Promise<number>;
      };

      if (!projectMount.preload) return;

      try {
        const count = await projectMount.preload(extensions);
        console.log(`[fsModule] Preloaded ${count} files into memory cache.`);
      } catch (error) {
        console.error('[fsModule] Failed to preload files:', error);
      }
    },

    asyncWriteFile: async (
      path: string,
      data: string | Uint8Array,
      options?: any
    ): Promise<void> => {
      await fsModule.writeFile(path, data, options);
    },

    asyncReadFile: async (path: string, options?: any): Promise<string | Uint8Array> => {
      const readTask = fsModule.readFile(path, options);
      if (!isPromiseLike(readTask)) {
        throw new Error(`fsModule.readFile returned void without a callback: ${path}`);
      }
      return await readTask;
    },

    asyncRemoveFile: async (path: string): Promise<void> => {
      await fsModule.unlink(path);
    },

    mkdir: (path: string, options?: any): Promise<void> =>
      trackTask(
        (async (): Promise<void> => {
          const { relativePath } = normalizeModulePath(path);
          await mountRouter.resolve(relativePath).mkdir(relativePath, options?.recursive || false);
        })()
      ),

    readdir: (path: string, options?: any, callback?: any): any => {
      let cb: FsCallback<any[]> | undefined;
      let opts: any = {};
      if (typeof options === 'function') {
        cb = options;
      } else if (typeof callback === 'function') {
        cb = callback;
        opts = options ?? {};
      } else {
        opts = options ?? {};
      }

      const withFileTypes = opts?.encoding === 'buffer' ? false : opts?.withFileTypes === true;

      const doReaddir = (): Promise<any[]> =>
        trackTask(
          (async (): Promise<any[]> => {
            const { relativePath } = normalizeModulePath(path);
            const mount = mountRouter.resolve(relativePath);
            const names = await mount.listDir(relativePath);

            if (!withFileTypes) return names;

            return Promise.all(
              names.map(async name => {
                const childPath =
                  relativePath === '/' ? `/${name}` : `${relativePath.replace(/\/$/, '')}/${name}`;
                const stat = await mount.stat(childPath);
                return makeDirent(name, stat?.type === 'directory');
              })
            );
          })()
        );

      if (cb) {
        doReaddir()
          .then(result => cb!(null, result))
          .catch(err => cb!(err, []));
        return;
      }
      return doReaddir();
    },

    readdirSync: (path: string, options?: any): any[] => {
      const withFileTypes = options?.withFileTypes === true;
      const { relativePath } = normalizeModulePath(path);
      const dirPath = relativePath.endsWith('/') ? relativePath : `${relativePath}/`;
      const mount = mountRouter.resolve(relativePath);
      const knownFiles = new Set<string>();
      const names = new Set<string>();

      // VirtualMount intentionally exposes synchronous file lookup only; sync readdir
      // relies on mounted hot caches populated by writes or preloadFiles().
      const maybeCache = mount as unknown as { files?: Map<string, unknown>; dirs?: Set<string> };
      for (const key of maybeCache.files?.keys?.() ?? []) {
        knownFiles.add(key);
      }
      for (const key of maybeCache.dirs?.values?.() ?? []) {
        knownFiles.add(key);
      }
      for (const key of knownFiles) {
        if (key.startsWith(dirPath) && key !== dirPath) {
          names.add(key.slice(dirPath.length).split('/')[0]);
        }
      }

      const result = [...names].filter(Boolean);
      if (!withFileTypes) return result;

      return result.map(name => {
        const childPath = dirPath + name;
        return makeDirent(name, mount.hasDir(childPath));
      });
    },

    unlink: (path: string): Promise<void> =>
      trackTask(
        (async (): Promise<void> => {
          const { relativePath } = normalizeModulePath(path);
          const deleted = await mountRouter.resolve(relativePath).deleteFile(relativePath);
          if (!deleted) {
            throw createFsError('ENOENT', 'unlink', path);
          }
        })()
      ),

    appendFile: (path: string, data: string, options?: any): Promise<void> =>
      trackTask(
        (async (): Promise<void> => {
          try {
            const { relativePath } = normalizeModulePath(path);
            const mount = mountRouter.resolve(relativePath);
            const content = (await mount.getFile(relativePath)) ?? '';
            await fsModule.writeFile(path, decodeContent(content) + data, options);
          } catch (error) {
            console.warn('[fsModule.ts] caught non-fatal error', error);
            throw new Error(`ファイルへの追記に失敗しました: ${path}`);
          }
        })()
      ),

    stat: (path: string, callback?: any): any => {
      const doStat = () =>
        trackTask(
          (async () => {
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
              throw createFsError('EIO', 'stat', path, `ファイル情報の取得に失敗しました: ${path}`);
            }
          })()
        );
      if (typeof callback === 'function') {
        doStat()
          .then(s => callback(null, s))
          .catch(e => callback(e));
        return;
      }
      return doStat();
    },

    lstat: (path: string, callback?: any): any => {
      const doLstat = () =>
        trackTask(
          (async () => {
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
          })()
        );
      if (typeof callback === 'function') {
        doLstat()
          .then(s => callback(null, s))
          .catch(e => callback(e));
        return;
      }
      return doLstat();
    },

    statSync: (path: string, options?: any): any => getStatsSync(path, 'stat', options),
    lstatSync: (path: string, options?: any): any => getStatsSync(path, 'lstat', options),

    mkdirSync: (path: string, options?: any): void => {
      const mkdirTask = fsModule.mkdir(path, options);
      if (isPromiseLike(mkdirTask)) {
        mkdirTask.catch((err: unknown) => console.error(err));
      }
    },

    unlinkSync: (path: string): void => {
      const { relativePath } = normalizeModulePath(path);
      const mount = mountRouter.resolve(relativePath);
      if (!mount.hasFile(relativePath)) {
        throw createFsError('ENOENT', 'unlink', path);
      }
      const unlinkTask = fsModule.unlink(path);
      if (isPromiseLike(unlinkTask)) {
        unlinkTask.catch((err: unknown) => console.error(err));
      }
    },

    rmSync: (path: string, options?: any): void => {
      const { relativePath } = normalizeModulePath(path);
      const mount = mountRouter.resolve(relativePath);
      if (mount.hasFile(relativePath)) {
        const deleteTask = mount.deleteFile(relativePath);
        deleteTask.catch((err: unknown) => console.error(err));
        return;
      }

      if (mount.hasDir(relativePath)) {
        const deleteTask = mount.rmdir(relativePath, options?.recursive || false);
        deleteTask.catch((err: unknown) => console.error(err));
        return;
      }

      if (!options?.force) {
        throw createFsError('ENOENT', 'rm', path);
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
    rm: async (path: string, options?: any) => {
      const { relativePath } = normalizeModulePath(path);
      const mount = mountRouter.resolve(relativePath);
      if (mount.hasFile(relativePath)) {
        const deleted = await mount.deleteFile(relativePath);
        if (!deleted && !options?.force) throw createFsError('ENOENT', 'rm', path);
        return;
      }
      if (mount.hasDir(relativePath)) {
        await mount.rmdir(relativePath, options?.recursive || false);
        return;
      }
      if (!options?.force) throw createFsError('ENOENT', 'rm', path);
    },
  };

  return fsModule;
}
