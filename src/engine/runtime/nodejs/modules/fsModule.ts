import { Buffer } from 'buffer';
import type { RuntimeBridge } from '@/engine/runtime/bridge/client';
import type { RuntimeFsMount } from '@/engine/runtime/storage/RuntimeFsMount';
import type { MountStat } from '@/engine/runtime/storage/types';
import { constants } from './constantsModule';
import { RuntimeFsDescriptors } from './fsDescriptors';
import { createFsStats, type FsStats, fileMode, type StatOptions } from './fsStats';

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
  writeStdout: (data: string | Uint8Array) => void;
  writeStderr: (data: string | Uint8Array) => void;
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

function dirent(name: string | Buffer, type: MountStat['type']): FsDirent {
  return {
    name,
    isFile: () => type === 'file',
    isDirectory: () => type === 'directory',
    isSymbolicLink: () => type === 'symlink',
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

function linkResult(value: string, encoding?: FsEncoding): string | Buffer {
  if (encoding === 'buffer') return Buffer.from(value);
  return Buffer.from(value).toString(encoding ?? 'utf8');
}

function linkEncoding(options?: ReadOptions | FsEncoding): FsEncoding | undefined {
  return optionEncoding(options);
}

export function createFSModule(options: FSModuleOptions) {
  const filesystem = options.filesystem;
  const descriptors = new RuntimeFsDescriptors(
    filesystem,
    data => options.writeStdout(data),
    data => options.writeStderr(data)
  );
  let stdinRemainder: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  const track = <T>(task: Promise<T>): Promise<T> => {
    const tracker = options.getTrackIO?.();
    if (tracker) return tracker(task);
    return task;
  };
  const normalize = (path: string): string => {
    if (path.startsWith('/')) return path;
    const cwd = options.getCwd();
    if (cwd === '/') return `/${path}`;
    return `${cwd}/${path}`;
  };

  function childPath(path: string, name: string): string {
    if (path === '/') return `/${name}`;
    if (path.endsWith('/')) return `${path}${name}`;
    return `${path}/${name}`;
  }

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

  async function readlink(
    path: string,
    options?: ReadOptions | FsEncoding
  ): Promise<string | Buffer> {
    const target = await filesystem.readlink(normalize(path));
    return linkResult(target, linkEncoding(options));
  }

  async function resolveRealpath(
    path: string,
    options?: ReadOptions | FsEncoding
  ): Promise<string | Buffer> {
    const resolved = await filesystem.realpath(normalize(path));
    return linkResult(resolved, linkEncoding(options));
  }

  function readlinkSync(path: string, options?: ReadOptions | FsEncoding): string | Buffer {
    const target = filesystem.readlinkSync(normalize(path));
    return linkResult(target, linkEncoding(options));
  }

  function realpathSyncImpl(path: string, options?: ReadOptions | FsEncoding): string | Buffer {
    const resolved = filesystem.realpathSync(normalize(path));
    return linkResult(resolved, linkEncoding(options));
  }

  const realpathSync = Object.assign(realpathSyncImpl, { native: realpathSyncImpl });

  function realpathOperation(
    path: string,
    optionsOrCallback?: ReadOptions | FsEncoding | FsCallback<string | Buffer>,
    callback?: FsCallback<string | Buffer>
  ): Promise<string | Buffer> | void {
    let encodingOptions: ReadOptions | FsEncoding | undefined;
    let done = callback;
    if (isCallback<string | Buffer>(optionsOrCallback)) done = optionsOrCallback;
    else encodingOptions = optionsOrCallback;
    const task = resolveRealpath(path, encodingOptions);
    if (!done) return track(task);
    track(
      task.then(
        value => done(null, value),
        error => done(callbackError(error))
      )
    );
  }

  const realpath = Object.assign(realpathOperation, { native: realpathOperation });

  function createSymlink(target: string, path: string): Promise<void> {
    return filesystem.symlink(target, normalize(path));
  }

  function createSymlinkSync(target: string, path: string): void {
    filesystem.symlinkSync(target, normalize(path));
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

  async function getStats(
    path: string,
    syscall: 'stat' | 'lstat',
    statOptions?: StatOptions
  ): Promise<FsStats> {
    const normalized = normalize(path);
    let value: MountStat | null;
    try {
      if (syscall === 'stat') value = await filesystem.stat(normalized);
      else value = await filesystem.lstat(normalized);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw fsError('ENOENT', syscall, path);
      }
      throw error;
    }
    if (!value) throw fsError('ENOENT', syscall, path);
    return createFsStats(value, statOptions?.bigint === true);
  }

  function getStatsSync(
    path: string,
    syscall: 'stat' | 'lstat',
    statOptions?: StatOptions
  ): FsStats | undefined {
    const normalized = normalize(path);
    let value: MountStat | null;
    if (syscall === 'stat') value = filesystem.statSync(normalized);
    else value = filesystem.lstatSync(normalized);
    if (value) return createFsStats(value, statOptions?.bigint === true);
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
        const entryPath = childPath(normalized, name);
        const value = await mount.lstat(entryPath);
        const displayName = directoryName(name, directoryOptions.encoding);
        if (!value) throw fsError('ENOENT', 'lstat', entryPath);
        return dirent(displayName, value.type);
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

  function completeCall<T>(task: Promise<T>, callback?: FsCallback<T>): Promise<T> | void {
    if (!callback) return track(task);
    track(
      task.then(
        value => callback(null, value),
        error => callback(callbackError(error))
      )
    );
  }

  function makeDirectory(path: string, options: MkdirOptions = {}): Promise<void> {
    return filesystem.mkdir(normalize(path), options.recursive === true);
  }

  function renamePath(oldPath: string, newPath: string): Promise<void> {
    return filesystem.rename(normalize(oldPath), normalize(newPath));
  }

  async function unlinkPath(path: string): Promise<void> {
    const normalized = normalize(path);
    const value = await filesystem.lstat(normalized);
    if (!value) throw fsError('ENOENT', 'unlink', path);
    if (value.type === 'directory') throw fsError('EISDIR', 'unlink', path);
    await filesystem.deleteFile(normalized);
  }

  async function removePath(path: string, options: RmOptions = {}): Promise<void> {
    const normalized = normalize(path);
    const value = await filesystem.lstat(normalized);
    if (!value && options.force) return;
    if (!value) throw fsError('ENOENT', 'rm', path);
    if (value.type === 'directory') await filesystem.rmdir(normalized, options.recursive === true);
    else await filesystem.deleteFile(normalized);
  }

  function checkPermissions(path: string, mode: number, permissions: number): void {
    if ((mode & constants.R_OK) !== 0 && (permissions & 0o444) === 0) {
      throw fsError('EACCES', 'access', path);
    }
    if ((mode & constants.W_OK) !== 0 && (permissions & 0o222) === 0) {
      throw fsError('EACCES', 'access', path);
    }
    if ((mode & constants.X_OK) !== 0 && (permissions & 0o111) === 0) {
      throw fsError('EACCES', 'access', path);
    }
  }

  async function accessPath(path: string, mode: number = constants.F_OK): Promise<void> {
    const value = await filesystem.stat(normalize(path));
    if (!value) throw fsError('ENOENT', 'access', path);
    checkPermissions(path, mode, fileMode(value.type));
  }

  function checkAccess(path: string, mode: number = constants.F_OK): void {
    const value = filesystem.statSync(normalize(path));
    if (!value) throw fsError('ENOENT', 'access', path);
    checkPermissions(path, mode, fileMode(value.type));
  }

  function statOperation(
    path: string,
    syscall: 'stat' | 'lstat',
    optionsOrCallback?: StatOptions | FsCallback<FsStats>,
    callback?: FsCallback<FsStats>
  ): Promise<FsStats> | void {
    let statOptions: StatOptions | undefined;
    let done = callback;
    if (isCallback<FsStats>(optionsOrCallback)) done = optionsOrCallback;
    else statOptions = optionsOrCallback;
    return completeCall(getStats(path, syscall, statOptions), done);
  }

  function writeSync(
    descriptor: number,
    data: Uint8Array,
    offset?: number,
    length?: number,
    position?: number | null
  ): number;
  function writeSync(
    descriptor: number,
    data: string,
    position?: number | null,
    encoding?: BufferEncoding
  ): number;
  function writeSync(
    descriptor: number,
    data: string | Uint8Array,
    offsetOrPosition?: number | null,
    lengthOrEncoding?: number | BufferEncoding,
    position?: number | null
  ): number {
    return descriptors.writeSync(descriptor, data, offsetOrPosition, lengthOrEncoding, position);
  }

  const operations = {
    openSync: (path: string, flags: string | number, _mode?: number): number =>
      descriptors.openSync(normalize(path), flags),
    closeSync: (descriptor: number): void => descriptors.closeSync(descriptor),
    fstatSync: (descriptor: number, statOptions?: StatOptions): FsStats => {
      const value = descriptors.statSync(descriptor);
      if (!value) throw fsError('ENOENT', 'fstat', descriptor);
      return createFsStats(value, statOptions?.bigint === true);
    },
    writeSync,
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
      length = target.byteLength - offset,
      position: number | null = null
    ): number => {
      if (fd !== 0) return descriptors.readSync(fd, target, offset, length, position);
      if (length === 0) return 0;
      let input = stdinRemainder;
      if (input.length === 0) input = requestStdin();
      const count = Math.min(length, input.byteLength);
      target.set(input.subarray(0, count), offset);
      stdinRemainder = input.subarray(count);
      return count;
    },
    access: (
      path: string,
      modeOrCallback?: number | FsCallback<void>,
      callback?: FsCallback<void>
    ): Promise<void> | void => {
      let mode: number = constants.F_OK;
      let done = callback;
      if (isCallback<void>(modeOrCallback)) done = modeOrCallback;
      else if (modeOrCallback !== undefined) mode = modeOrCallback;
      return completeCall(accessPath(path, mode), done);
    },
    accessSync: (path: string, mode: number = constants.F_OK): void => {
      checkAccess(path, mode);
    },
    exists: (path: string, callback: (exists: boolean) => void): void => {
      const task = filesystem.stat(normalize(path)).then(
        () => true,
        () => false
      );
      track(task.then(callback));
    },
    existsSync: (path: string): boolean => filesystem.statSync(normalize(path)) !== null,
    mkdir: (
      path: string,
      optionsOrCallback?: MkdirOptions | FsCallback<void>,
      callback?: FsCallback<void>
    ): Promise<void> | void => {
      let mkdirOptions: MkdirOptions | undefined;
      let done = callback;
      if (isCallback<void>(optionsOrCallback)) done = optionsOrCallback;
      else mkdirOptions = optionsOrCallback;
      return completeCall(makeDirectory(path, mkdirOptions), done);
    },
    mkdirSync: (path: string, mkdirOptions: MkdirOptions = {}): void => {
      filesystem.mkdirSync(normalize(path), mkdirOptions.recursive === true);
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
        const entryPath = childPath(normalized, name);
        const value = mount.lstatSync(entryPath);
        if (!value) throw fsError('ENOENT', 'lstat', entryPath);
        return dirent(directoryName(name, readdirOptions.encoding), value.type);
      });
    },
    unlink: (path: string, callback?: FsCallback<void>): Promise<void> | void =>
      completeCall(unlinkPath(path), callback),
    unlinkSync: (path: string): void => {
      const normalized = normalize(path);
      const value = filesystem.lstatSync(normalized);
      if (!value) throw fsError('ENOENT', 'unlink', path);
      if (value.type === 'directory') throw fsError('EISDIR', 'unlink', path);
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
    rename: (oldPath: string, newPath: string, callback?: FsCallback<void>): Promise<void> | void =>
      completeCall(renamePath(oldPath, newPath), callback),
    renameSync: (oldPath: string, newPath: string): void => {
      const oldNormalized = normalize(oldPath);
      const newNormalized = normalize(newPath);
      filesystem.renameSync(oldNormalized, newNormalized);
    },
    stat: (
      path: string,
      optionsOrCallback?: StatOptions | FsCallback<FsStats>,
      callback?: FsCallback<FsStats>
    ): Promise<FsStats> | void => statOperation(path, 'stat', optionsOrCallback, callback),
    lstat: (
      path: string,
      optionsOrCallback?: StatOptions | FsCallback<FsStats>,
      callback?: FsCallback<FsStats>
    ): Promise<FsStats> | void => statOperation(path, 'lstat', optionsOrCallback, callback),
    statSync: (path: string, statOptions?: StatOptions): FsStats | undefined =>
      getStatsSync(path, 'stat', statOptions),
    lstatSync: (path: string, statOptions?: StatOptions): FsStats | undefined =>
      getStatsSync(path, 'lstat', statOptions),
    readlink: (
      path: string,
      optionsOrCallback?: ReadOptions | FsEncoding | FsCallback<string | Buffer>,
      callback?: FsCallback<string | Buffer>
    ): Promise<string | Buffer> | void => {
      let encodingOptions: ReadOptions | FsEncoding | undefined;
      let done = callback;
      if (isCallback<string | Buffer>(optionsOrCallback)) done = optionsOrCallback;
      else encodingOptions = optionsOrCallback;
      const task = readlink(path, encodingOptions);
      if (!done) return track(task);
      track(
        task.then(
          value => done(null, value),
          error => done(callbackError(error))
        )
      );
    },
    readlinkSync,
    realpath,
    realpathSync,
    symlink: (
      target: string,
      path: string,
      typeOrCallback?: string | FsCallback<void>,
      callback?: FsCallback<void>
    ): Promise<void> | void => {
      let done = callback;
      if (isCallback<void>(typeOrCallback)) done = typeOrCallback;
      const task = createSymlink(target, path);
      return completeWrite(task, done);
    },
    symlinkSync: createSymlinkSync,
    rm: (
      path: string,
      optionsOrCallback?: RmOptions | FsCallback<void>,
      callback?: FsCallback<void>
    ): Promise<void> | void => {
      let rmOptions: RmOptions | undefined;
      let done = callback;
      if (isCallback<void>(optionsOrCallback)) done = optionsOrCallback;
      else rmOptions = optionsOrCallback;
      return completeCall(removePath(path, rmOptions), done);
    },
    rmSync: (path: string, rmOptions: RmOptions = {}): void => {
      const normalized = normalize(path);
      const mount = filesystem;
      const value = mount.lstatSync(normalized);
      if (!value && rmOptions.force) return;
      if (!value) throw fsError('ENOENT', 'rm', path);
      if (value.type === 'directory') mount.rmdirSync(normalized, rmOptions.recursive === true);
      else mount.deleteFileSync(normalized);
    },
    constants,
  };

  const promises = {
    readFile: (path: string, encoding?: ReadOptions | FsEncoding) =>
      track(readFile(path, encoding)),
    writeFile: (path: string, data: string | Uint8Array, writeOptions?: ReadOptions | FsEncoding) =>
      track(writeFile(path, data, writeOptions)),
    readdir: (path: string, readdirOptions?: ReaddirOptions) =>
      track(readDirectory(path, readdirOptions)),
    stat: (path: string, statOptions?: StatOptions) => track(getStats(path, 'stat', statOptions)),
    lstat: (path: string, statOptions?: StatOptions) => track(getStats(path, 'lstat', statOptions)),
    access: (path: string, mode?: number) => track(accessPath(path, mode)),
    readlink: (path: string, encoding?: ReadOptions | FsEncoding) =>
      track(readlink(path, encoding)),
    realpath: (path: string, encoding?: ReadOptions | FsEncoding) =>
      track(resolveRealpath(path, encoding)),
    symlink: (target: string, path: string) => track(createSymlink(target, path)),
    mkdir: (path: string, options?: MkdirOptions) => track(makeDirectory(path, options)),
    unlink: (path: string) => track(unlinkPath(path)),
    appendFile: (
      path: string,
      data: string | Uint8Array,
      writeOptions?: ReadOptions | FsEncoding
    ) => track(appendFile(path, data, writeOptions)),
    rename: (oldPath: string, newPath: string) => track(renamePath(oldPath, newPath)),
    rm: (path: string, options?: RmOptions) => track(removePath(path, options)),
  };
  return { ...operations, promises };
}
