import { Buffer } from 'buffer';
import { resolvePath } from '@/engine/core/pathUtils';
import type { RuntimeBridge } from '@/engine/runtime/bridge/client';
import type { RuntimeFsMount } from '@/engine/runtime/storage/RuntimeFsMount';
import type { MountStat } from '@/engine/runtime/storage/types';

export type FsEncoding = BufferEncoding | 'buffer' | null;
export interface ReadOptions {
  encoding?: FsEncoding;
}
export interface ReaddirOptions {
  encoding?: FsEncoding;
  withFileTypes?: boolean;
}
export interface MkdirOptions {
  recursive?: boolean;
}
export interface RmOptions {
  recursive?: boolean;
  force?: boolean;
}
export interface StatOptions {
  throwIfNoEntry?: boolean;
}
export interface FsStats extends MountStat {
  ctime: Date;
  birthtime: Date;
  atime: Date;
  mode: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
  isFIFO(): boolean;
  isSocket(): boolean;
}
export interface FsDirent {
  name: string | Buffer;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
  isFIFO(): boolean;
  isSocket(): boolean;
}
export type FsCallback<T = void> = (error: Error | null, data?: T) => void;
type IoTracker = <T>(task: Promise<T>) => Promise<T>;
type ReadOptionsArg = ReadOptions | FsEncoding | FsCallback<string | Buffer>;
type WriteOptionsArg = ReadOptions | FsEncoding | FsCallback<void>;
type DirectoryEntry = string | Buffer | FsDirent;

export interface FSModuleOptions {
  filesystem: RuntimeFsMount;
  bridge: RuntimeBridge;
  getCwd: () => string;
  getTrackIO?: () => IoTracker | undefined;
}

function isCallback<T>(value: unknown): value is FsCallback<T> {
  return typeof value === 'function';
}

function optionEncoding(options?: ReadOptions | FsEncoding): FsEncoding | undefined {
  if (typeof options === 'string') return options;
  if (options === null) return null;
  if (!options) return undefined;
  return options?.encoding;
}

function directoryName(name: string, encoding?: FsEncoding): string | Buffer {
  if (encoding === 'buffer') return Buffer.from(name);
  return name;
}

function callbackError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

function encode(value: string | Uint8Array, options?: ReadOptions | FsEncoding): Uint8Array {
  if (typeof value !== 'string') return value;
  const encoding = optionEncoding(options);
  if (encoding === 'buffer') throw new TypeError('Invalid string encoding: buffer');
  return Buffer.from(value, encoding ?? 'utf8');
}

function readResult(
  content: string | Uint8Array,
  options?: ReadOptions | FsEncoding
): string | Buffer {
  const bytes = Buffer.from(encode(content));
  const encoding = optionEncoding(options);
  if (encoding === undefined || encoding === null || encoding === 'buffer') return bytes;
  return bytes.toString(encoding);
}

function stats(value: MountStat): FsStats {
  const timestamp = value.mtime;
  const type = value.type;
  const result: FsStats = {
    ...value,
    ctime: timestamp,
    birthtime: timestamp,
    atime: timestamp,
    mode: 0o100644,
    isFile: () => type === 'file',
    isDirectory: () => type === 'directory',
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  };
  if (type === 'directory') result.mode = 0o40755;
  return result;
}

function dirent(name: string | Buffer, isDirectory: boolean): FsDirent {
  return {
    name,
    isFile: () => !isDirectory,
    isDirectory: () => isDirectory,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  };
}

function fsError(
  code: string,
  syscall: string,
  path: string | number
): Error & { code: string; errno: number; syscall: string; path: string } {
  const normalizedPath = String(path);
  const error = new Error(`${code}: ${syscall} '${normalizedPath}'`) as Error & {
    code: string;
    errno: number;
    syscall: string;
    path: string;
  };
  error.code = code;
  error.errno = -1;
  if (code === 'ENOENT') error.errno = -2;
  error.syscall = syscall;
  error.path = normalizedPath;
  return error;
}

function rethrowAsFsError(error: unknown, code: string, syscall: string, path: string): never {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') throw error;
  throw fsError(code, syscall, path);
}

export function createFSModule(options: FSModuleOptions) {
  const filesystem = options.filesystem;
  let stdinRemainder: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  const track = <T>(task: Promise<T>): Promise<T> => {
    const tracker = options.getTrackIO?.();
    if (tracker) return tracker(task);
    return task;
  };
  const normalize = (path: string): string => resolvePath(options.getCwd(), path);

  function requestStdin(): Buffer {
    const value = options.bridge.sync({ kind: 'stdin' });
    if (!Array.isArray(value) || !value.every(byte => typeof byte === 'number')) {
      throw new Error('stdin bridge returned an invalid byte value.');
    }
    return Buffer.from(value);
  }

  function readStdinLine(): Buffer {
    if (stdinRemainder.length > 0) {
      const buffered = stdinRemainder;
      stdinRemainder = Buffer.alloc(0);
      return buffered;
    }
    return requestStdin();
  }

  async function readFile(
    path: string,
    encoding?: ReadOptions | FsEncoding
  ): Promise<string | Buffer> {
    const normalized = normalize(path);
    const content = await filesystem.getFile(normalized);
    if (content === undefined) throw fsError('ENOENT', 'open', path);
    return readResult(content, encoding);
  }

  async function writeFile(
    path: string,
    data: string | Uint8Array,
    writeOptions?: ReadOptions | FsEncoding
  ): Promise<void> {
    const normalized = normalize(path);
    const content = encode(data, writeOptions);
    try {
      await filesystem.setFile(normalized, content);
    } catch (error) {
      rethrowAsFsError(error, 'EIO', 'write', path);
    }
  }

  async function appendFile(
    path: string,
    data: string | Uint8Array,
    writeOptions?: ReadOptions | FsEncoding
  ): Promise<void> {
    const normalized = normalize(path);
    const current = await filesystem.getFile(normalized);
    const oldBytes = current ?? new Uint8Array();
    const newBytes = encode(data, writeOptions);
    const combined = new Uint8Array(oldBytes.length + newBytes.length);
    combined.set(oldBytes);
    combined.set(newBytes, oldBytes.length);
    await filesystem.setFile(normalized, combined);
  }

  function completeWrite(task: Promise<void>, callback?: FsCallback<void>): Promise<void> | void {
    if (!callback) return track(task);
    track(
      task.then(
        () => callback(null),
        error => callback(callbackError(error))
      )
    );
  }

  async function getStats(path: string, syscall: 'stat' | 'lstat'): Promise<FsStats> {
    const normalized = normalize(path);
    let value: MountStat | null;
    try {
      value = await filesystem.stat(normalized);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw fsError('ENOENT', syscall, path);
      }
      throw error;
    }
    if (!value) throw fsError('ENOENT', syscall, path);
    return stats(value);
  }

  function getStatsSync(
    path: string,
    syscall: 'stat' | 'lstat',
    statOptions?: StatOptions
  ): FsStats | undefined {
    const normalized = normalize(path);
    const value = filesystem.statSync(normalized);
    if (value) return stats(value);
    if (statOptions?.throwIfNoEntry === false) return undefined;
    throw fsError('ENOENT', syscall, path);
  }

  async function readDirectory(
    path: string,
    directoryOptions?: ReaddirOptions
  ): Promise<DirectoryEntry[]> {
    const normalized = normalize(path);
    const mount = filesystem;
    const names = await mount.listDir(normalized);
    if (!directoryOptions?.withFileTypes) {
      return names.map(name => directoryName(name, directoryOptions?.encoding));
    }
    return Promise.all(
      names.map(async name => {
        const childPath = resolvePath(normalized, name);
        const value = await mount.stat(childPath);
        const displayName = directoryName(name, directoryOptions.encoding);
        return dirent(displayName, value?.type === 'directory');
      })
    );
  }

  function readFileCallback(
    path: string,
    encoding?: ReadOptions | FsEncoding,
    callback?: FsCallback<string | Buffer>
  ): Promise<string | Buffer> | void {
    const result = readFile(path, encoding);
    if (callback) {
      track(
        result.then(
          value => callback(null, value),
          error => callback(callbackError(error))
        )
      );
      return;
    }
    return track(result);
  }

  const operations = {
    readFile: (
      path: string,
      encodingOrCallback?: ReadOptionsArg,
      callback?: FsCallback<string | Buffer>
    ): Promise<string | Buffer> | void => {
      if (isCallback<string | Buffer>(encodingOrCallback))
        return readFileCallback(path, undefined, encodingOrCallback);
      return readFileCallback(path, encodingOrCallback, callback);
    },
    writeFile: (
      path: string,
      data: string | Uint8Array,
      optionsOrCallback?: WriteOptionsArg,
      callback?: FsCallback<void>
    ): Promise<void> | void => {
      if (isCallback<void>(optionsOrCallback)) {
        return completeWrite(writeFile(path, data), optionsOrCallback);
      }
      return completeWrite(writeFile(path, data, optionsOrCallback), callback);
    },
    readFileSync: (path: string | number, encoding?: ReadOptions | FsEncoding): string | Buffer => {
      if (typeof path === 'number' && path === 0) {
        return readResult(readStdinLine(), encoding);
      }
      if (typeof path !== 'string') throw fsError('EBADF', 'open', path);
      const normalized = normalize(path);
      const content = filesystem.getFileSync(normalized);
      if (content === undefined) throw fsError('ENOENT', 'open', path);
      return readResult(content, encoding);
    },
    writeFileSync: (
      path: string,
      data: string | Uint8Array,
      writeOptions?: ReadOptions | FsEncoding
    ): void => {
      const normalized = normalize(path);
      filesystem.setFileSync(normalized, encode(data, writeOptions));
    },
    readSync: (
      fd: number,
      target: Uint8Array,
      offset = 0,
      length = target.byteLength - offset
    ): number => {
      if (fd !== 0) throw fsError('EBADF', 'read', fd);
      if (length === 0) return 0;
      let input = stdinRemainder;
      if (input.length === 0) input = requestStdin();
      const count = Math.min(length, input.byteLength);
      target.set(input.subarray(0, count), offset);
      stdinRemainder = input.subarray(count);
      return count;
    },
    existsSync: (path: string): boolean => filesystem.statSync(normalize(path)) !== null,
    accessSync: (path: string): void => {
      if (!operations.existsSync(path)) throw fsError('ENOENT', 'access', path);
    },
    mkdir: (path: string, mkdirOptions: MkdirOptions = {}): Promise<void> => {
      const normalized = normalize(path);
      return track(filesystem.mkdir(normalized, mkdirOptions.recursive === true));
    },
    mkdirSync: (path: string, mkdirOptions: MkdirOptions = {}): void => {
      const normalized = normalize(path);
      filesystem.mkdirSync(normalized, mkdirOptions.recursive === true);
    },
    readdir: (
      path: string,
      optionsOrCallback?: ReaddirOptions | FsCallback<DirectoryEntry[]>,
      callback?: FsCallback<DirectoryEntry[]>
    ): Promise<DirectoryEntry[]> | void => {
      const readdirOptions = isCallback<DirectoryEntry[]>(optionsOrCallback)
        ? undefined
        : optionsOrCallback;
      let done = callback;
      if (isCallback<DirectoryEntry[]>(optionsOrCallback)) done = optionsOrCallback;
      const task = readDirectory(path, readdirOptions);
      if (!done) return track(task);
      track(
        task.then(
          names => done(null, names),
          error => done(callbackError(error))
        )
      );
    },
    readdirSync: (path: string, readdirOptions?: ReaddirOptions): DirectoryEntry[] => {
      const normalized = normalize(path);
      const mount = filesystem;
      const names = mount.listDirSync(normalized);
      if (!readdirOptions?.withFileTypes)
        return names.map(name => directoryName(name, readdirOptions?.encoding));
      return names.map(name => {
        const childPath = resolvePath(normalized, name);
        const value = mount.statSync(childPath);
        return dirent(directoryName(name, readdirOptions.encoding), value?.type === 'directory');
      });
    },
    unlink: (path: string): Promise<void> =>
      track(
        (async () => {
          const normalized = normalize(path);
          await filesystem.deleteFile(normalized);
        })()
      ),
    unlinkSync: (path: string): void => {
      const normalized = normalize(path);
      if (filesystem.statSync(normalized)?.type !== 'file') throw fsError('ENOENT', 'unlink', path);
      filesystem.deleteFileSync(normalized);
    },
    appendFile: (
      path: string,
      data: string | Uint8Array,
      optionsOrCallback?: WriteOptionsArg,
      callback?: FsCallback<void>
    ): Promise<void> | void => {
      if (isCallback<void>(optionsOrCallback)) {
        return completeWrite(appendFile(path, data), optionsOrCallback);
      }
      return completeWrite(appendFile(path, data, optionsOrCallback), callback);
    },
    appendFileSync: (
      path: string,
      data: string | Uint8Array,
      writeOptions?: ReadOptions | FsEncoding
    ): void => {
      const normalized = normalize(path);
      const mount = filesystem;
      const current = mount.getFileSync(normalized);
      let oldBytes: Uint8Array = new Uint8Array();
      if (current !== undefined) oldBytes = encode(current);
      const newBytes = encode(data, writeOptions);
      const combined = new Uint8Array(oldBytes.length + newBytes.length);
      combined.set(oldBytes);
      combined.set(newBytes, oldBytes.length);
      mount.setFileSync(normalized, combined);
    },
    rename: (oldPath: string, newPath: string): Promise<void> => {
      const oldNormalized = normalize(oldPath);
      const newNormalized = normalize(newPath);
      return track(filesystem.rename(oldNormalized, newNormalized));
    },
    renameSync: (oldPath: string, newPath: string): void => {
      const oldNormalized = normalize(oldPath);
      const newNormalized = normalize(newPath);
      filesystem.renameSync(oldNormalized, newNormalized);
    },
    stat: (path: string, callback?: FsCallback<FsStats>): Promise<FsStats> | void => {
      const task = getStats(path, 'stat');
      if (!callback) return track(task);
      track(
        task.then(
          value => callback(null, value),
          error => callback(callbackError(error))
        )
      );
    },
    lstat: (path: string, callback?: FsCallback<FsStats>): Promise<FsStats> | void => {
      const task = getStats(path, 'lstat');
      if (!callback) return track(task);
      track(
        task.then(
          value => callback(null, value),
          error => callback(callbackError(error))
        )
      );
    },
    statSync: (path: string, statOptions?: StatOptions): FsStats | undefined =>
      getStatsSync(path, 'stat', statOptions),
    lstatSync: (path: string, statOptions?: StatOptions): FsStats | undefined =>
      getStatsSync(path, 'lstat', statOptions),
    rm: (path: string, rmOptions: RmOptions = {}): Promise<void> =>
      track(
        (async () => {
          const normalized = normalize(path);
          const mount = filesystem;
          const value = await mount.stat(normalized);
          if (!value && rmOptions.force) return;
          if (!value) throw fsError('ENOENT', 'rm', path);
          if (value.type === 'directory')
            await mount.rmdir(normalized, rmOptions.recursive === true);
          else await mount.deleteFile(normalized);
        })()
      ),
    rmSync: (path: string, rmOptions: RmOptions = {}): void => {
      const normalized = normalize(path);
      const mount = filesystem;
      const value = mount.statSync(normalized);
      if (!value && rmOptions.force) return;
      if (!value) throw fsError('ENOENT', 'rm', path);
      if (value.type === 'directory') mount.rmdirSync(normalized, rmOptions.recursive === true);
      else mount.deleteFileSync(normalized);
    },
    constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 },
  };

  const promises = {
    readFile: (path: string, encoding?: ReadOptions | FsEncoding) =>
      track(readFile(path, encoding)),
    writeFile: (path: string, data: string | Uint8Array, writeOptions?: ReadOptions | FsEncoding) =>
      track(writeFile(path, data, writeOptions)),
    readdir: (path: string, readdirOptions?: ReaddirOptions) =>
      track(readDirectory(path, readdirOptions)),
    stat: (path: string) => track(getStats(path, 'stat')),
    lstat: (path: string) => track(getStats(path, 'lstat')),
    mkdir: operations.mkdir,
    unlink: operations.unlink,
    appendFile: (
      path: string,
      data: string | Uint8Array,
      writeOptions?: ReadOptions | FsEncoding
    ) => track(appendFile(path, data, writeOptions)),
    rename: operations.rename,
    rm: operations.rm,
  };
  return { ...operations, promises };
}
