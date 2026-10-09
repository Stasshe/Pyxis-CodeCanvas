import { Buffer } from 'buffer';
import type { RuntimeBridge } from '@/engine/runtime/bridge/client';
import type { RuntimeFsMount } from '@/engine/runtime/storage/RuntimeFsMount';
import type { MountStat } from '@/engine/runtime/storage/types';
import { constants } from './constantsModule';
import { RuntimeFsDescriptors } from './fsDescriptors';
import { createDescriptorCallbacks, createDescriptorWriteSync } from './fsIo';
import {
  copyFile,
  copyFileSync,
  makeTempDirectory,
  makeTempDirectorySync,
  removeDirectory,
  removeDirectorySync,
} from './fsOperations';
import { type FsPath, normalizeFsPath } from './fsPaths';
import { createFsStats, type FsStats, fileMode, type StatOptions } from './fsStats';
import { createReadStream, createWriteStream, type FsStreamOptions } from './fsStreams';

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
    isCharacterDevice: () => type === 'characterDevice',
    isFIFO: () => type === 'fifo',
    isSocket: () => false,
  };
}

function fsError(
  code: string,
  syscall: string,
  path: FsPath | number
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

function rethrowAsFsError(error: unknown, code: string, syscall: string, path: FsPath): never {
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

function tempDirectoryResult(path: string, options?: ReadOptions | FsEncoding): string | Buffer {
  const encoding = optionEncoding(options);
  if (encoding === 'buffer') return Buffer.from(path);
  return Buffer.from(path).toString(encoding ?? 'utf8');
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
  const normalize = (path: FsPath): string => normalizeFsPath(path, options.getCwd);

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

  async function readFile(
    path: FsPath,
    encoding?: ReadOptions | FsEncoding
  ): Promise<string | Buffer> {
    const normalized = normalize(path);
    const content = await filesystem.getFile(normalized);
    if (content === undefined) throw fsError('ENOENT', 'open', path);
    return readResult(content, encoding);
  }

  async function writeFile(
    path: FsPath,
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
    path: FsPath,
    data: string | Uint8Array,
    writeOptions?: ReadOptions | FsEncoding
  ): Promise<void> {
    const normalized = normalize(path);
    const newBytes = encode(data, writeOptions);
    await filesystem.writeRange(normalized, newBytes, null, true);
  }

  async function readlink(
    path: FsPath,
    options?: ReadOptions | FsEncoding
  ): Promise<string | Buffer> {
    const target = await filesystem.readlink(normalize(path));
    return linkResult(target, linkEncoding(options));
  }

  async function resolveRealpath(
    path: FsPath,
    options?: ReadOptions | FsEncoding
  ): Promise<string | Buffer> {
    const resolved = await filesystem.realpath(normalize(path));
    return linkResult(resolved, linkEncoding(options));
  }

  function readlinkSync(path: FsPath, options?: ReadOptions | FsEncoding): string | Buffer {
    const target = filesystem.readlinkSync(normalize(path));
    return linkResult(target, linkEncoding(options));
  }

  function realpathSyncImpl(path: FsPath, options?: ReadOptions | FsEncoding): string | Buffer {
    const resolved = filesystem.realpathSync(normalize(path));
    return linkResult(resolved, linkEncoding(options));
  }

  const realpathSync = Object.assign(realpathSyncImpl, { native: realpathSyncImpl });

  function realpathOperation(
    path: FsPath,
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

  function createSymlink(target: string | Buffer, path: FsPath): Promise<void> {
    return filesystem.symlink(target.toString(), normalize(path));
  }

  function createSymlinkSync(target: string | Buffer, path: FsPath): void {
    filesystem.symlinkSync(target.toString(), normalize(path));
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
    path: FsPath,
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
    path: FsPath,
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
    path: FsPath,
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
    path: FsPath,
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

  function readDescriptor(descriptor: number): Buffer {
    const chunks: Buffer[] = [];
    const chunk = Buffer.alloc(64 * 1024);
    let count = descriptors.readSync(descriptor, chunk, 0, chunk.byteLength);
    while (count > 0) {
      chunks.push(Buffer.from(chunk.subarray(0, count)));
      count = descriptors.readSync(descriptor, chunk, 0, chunk.byteLength);
    }
    return Buffer.concat(chunks);
  }

  function readStdin(): Buffer {
    const chunks: Buffer[] = [];
    if (stdinRemainder.length > 0) chunks.push(stdinRemainder);
    stdinRemainder = Buffer.alloc(0);
    let input = requestStdin();
    while (input.length > 0) {
      chunks.push(input);
      input = requestStdin();
    }
    return Buffer.concat(chunks);
  }

  function readDescriptorSync(
    descriptor: number,
    target: Uint8Array,
    offset: number,
    length: number,
    position: number | null
  ): number {
    if (descriptor !== 0) return descriptors.readSync(descriptor, target, offset, length, position);
    if (length === 0) return 0;
    let input = stdinRemainder;
    if (input.length === 0) input = requestStdin();
    const count = Math.min(length, input.byteLength);
    target.set(input.subarray(0, count), offset);
    stdinRemainder = input.subarray(count);
    return count;
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

  function makeDirectory(path: FsPath, options: MkdirOptions = {}): Promise<void> {
    return filesystem.mkdir(normalize(path), options.recursive === true);
  }

  function renamePath(oldPath: FsPath, newPath: FsPath): Promise<void> {
    return filesystem.rename(normalize(oldPath), normalize(newPath));
  }

  async function unlinkPath(path: FsPath): Promise<void> {
    const normalized = normalize(path);
    const value = await filesystem.lstat(normalized);
    if (!value) throw fsError('ENOENT', 'unlink', path);
    if (value.type === 'directory') throw fsError('EISDIR', 'unlink', path);
    await filesystem.deleteFile(normalized);
  }

  async function removePath(path: FsPath, options: RmOptions = {}): Promise<void> {
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

  async function accessPath(path: FsPath, mode: number = constants.F_OK): Promise<void> {
    const value = await filesystem.stat(normalize(path));
    if (!value) throw fsError('ENOENT', 'access', path);
    checkPermissions(String(path), mode, fileMode(value.type));
  }

  function checkAccess(path: FsPath, mode: number = constants.F_OK): void {
    const value = filesystem.statSync(normalize(path));
    if (!value) throw fsError('ENOENT', 'access', path);
    checkPermissions(String(path), mode, fileMode(value.type));
  }

  function statOperation(
    path: FsPath,
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

  const writeSync = createDescriptorWriteSync(descriptors);

  const descriptorCallbacks = createDescriptorCallbacks(
    descriptors,
    normalize,
    readDescriptorSync,
    track
  );

  const operations = {
    createReadStream: (path: FsPath, streamOptions?: FsStreamOptions) =>
      createReadStream(filesystem, normalize(path), streamOptions, options.getTrackIO?.()),
    createWriteStream: (path: FsPath, streamOptions?: FsStreamOptions) =>
      createWriteStream(filesystem, normalize(path), streamOptions, options.getTrackIO?.()),
    openSync: (path: FsPath, flags: string | number, _mode?: number): number =>
      descriptors.openSync(normalize(path), flags),
    closeSync: (descriptor: number): void => descriptors.closeSync(descriptor),
    ...descriptorCallbacks,
    fstatSync: (descriptor: number, statOptions?: StatOptions): FsStats => {
      const value = descriptors.statSync(descriptor);
      if (!value) throw fsError('ENOENT', 'fstat', descriptor);
      return createFsStats(value, statOptions?.bigint === true);
    },
    writeSync,
    copyFile: (
      source: FsPath,
      destination: FsPath,
      flagsOrCallback?: number | FsCallback<void>,
      callback?: FsCallback<void>
    ): Promise<void> | void => {
      let flags = 0;
      let done = callback;
      if (isCallback<void>(flagsOrCallback)) done = flagsOrCallback;
      else if (flagsOrCallback !== undefined) flags = flagsOrCallback;
      return completeCall(
        copyFile(filesystem, normalize(source), normalize(destination), flags),
        done
      );
    },
    copyFileSync: (source: FsPath, destination: FsPath, flags = 0): void =>
      copyFileSync(filesystem, normalize(source), normalize(destination), flags),
    rmdir: (path: FsPath, callback?: FsCallback<void>): Promise<void> | void =>
      completeCall(removeDirectory(filesystem, normalize(path)), callback),
    rmdirSync: (path: FsPath): void => removeDirectorySync(filesystem, normalize(path)),
    mkdtemp: (
      prefix: FsPath,
      optionsOrCallback?: ReadOptions | FsCallback<string | Buffer>,
      callback?: FsCallback<string | Buffer>
    ): Promise<string | Buffer> | void => {
      let readOptions: ReadOptions | undefined;
      let done = callback;
      if (isCallback<string | Buffer>(optionsOrCallback)) done = optionsOrCallback;
      else readOptions = optionsOrCallback;
      const task = makeTempDirectory(filesystem, normalize(prefix)).then(path =>
        tempDirectoryResult(path, readOptions)
      );
      return completeCall(task, done);
    },
    mkdtempSync: (prefix: FsPath, readOptions?: ReadOptions | FsEncoding): string | Buffer =>
      tempDirectoryResult(makeTempDirectorySync(filesystem, normalize(prefix)), readOptions),
    readFile: (
      path: FsPath,
      encodingOrCallback?: ReadOptionsArg,
      callback?: FsCallback<string | Buffer>
    ): Promise<string | Buffer> | void => {
      if (isCallback<string | Buffer>(encodingOrCallback))
        return readFileCallback(path, undefined, encodingOrCallback);
      return readFileCallback(path, encodingOrCallback, callback);
    },
    writeFile: (
      path: FsPath,
      data: string | Uint8Array,
      optionsOrCallback?: WriteOptionsArg,
      callback?: FsCallback<void>
    ): Promise<void> | void => {
      if (isCallback<void>(optionsOrCallback)) {
        return completeWrite(writeFile(path, data), optionsOrCallback);
      }
      return completeWrite(writeFile(path, data, optionsOrCallback), callback);
    },
    readFileSync: (path: FsPath | number, encoding?: ReadOptions | FsEncoding): string | Buffer => {
      if (typeof path === 'number') {
        if (path === 0) return readResult(readStdin(), encoding);
        return readResult(readDescriptor(path), encoding);
      }
      const normalized = normalize(path);
      if (normalized === '/dev/stdin') return readResult(readStdin(), encoding);
      const content = filesystem.getFileSync(normalized);
      if (content === undefined) throw fsError('ENOENT', 'open', path);
      return readResult(content, encoding);
    },
    writeFileSync: (
      path: FsPath,
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
    ): number => readDescriptorSync(fd, target, offset, length, position),
    access: (
      path: FsPath,
      modeOrCallback?: number | FsCallback<void>,
      callback?: FsCallback<void>
    ): Promise<void> | void => {
      let mode: number = constants.F_OK;
      let done = callback;
      if (isCallback<void>(modeOrCallback)) done = modeOrCallback;
      else if (modeOrCallback !== undefined) mode = modeOrCallback;
      return completeCall(accessPath(path, mode), done);
    },
    accessSync: (path: FsPath, mode: number = constants.F_OK): void => {
      checkAccess(path, mode);
    },
    exists: (path: FsPath, callback: (exists: boolean) => void): void => {
      const task = filesystem.stat(normalize(path)).then(
        value => value !== null,
        () => false
      );
      track(task.then(callback));
    },
    existsSync: (path: FsPath): boolean => filesystem.statSync(normalize(path)) !== null,
    mkdir: (
      path: FsPath,
      optionsOrCallback?: MkdirOptions | FsCallback<void>,
      callback?: FsCallback<void>
    ): Promise<void> | void => {
      let mkdirOptions: MkdirOptions | undefined;
      let done = callback;
      if (isCallback<void>(optionsOrCallback)) done = optionsOrCallback;
      else mkdirOptions = optionsOrCallback;
      return completeCall(makeDirectory(path, mkdirOptions), done);
    },
    mkdirSync: (path: FsPath, mkdirOptions: MkdirOptions = {}): void => {
      filesystem.mkdirSync(normalize(path), mkdirOptions.recursive === true);
    },
    readdir: (
      path: FsPath,
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
    readdirSync: (path: FsPath, readdirOptions?: ReaddirOptions): DirectoryEntry[] => {
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
    unlink: (path: FsPath, callback?: FsCallback<void>): Promise<void> | void =>
      completeCall(unlinkPath(path), callback),
    unlinkSync: (path: FsPath): void => {
      const normalized = normalize(path);
      const value = filesystem.lstatSync(normalized);
      if (!value) throw fsError('ENOENT', 'unlink', path);
      if (value.type === 'directory') throw fsError('EISDIR', 'unlink', path);
      filesystem.deleteFileSync(normalized);
    },
    appendFile: (
      path: FsPath,
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
      path: FsPath,
      data: string | Uint8Array,
      writeOptions?: ReadOptions | FsEncoding
    ): void => {
      const normalized = normalize(path);
      const newBytes = encode(data, writeOptions);
      filesystem.writeRangeSync(normalized, newBytes, null, true);
    },
    rename: (oldPath: FsPath, newPath: FsPath, callback?: FsCallback<void>): Promise<void> | void =>
      completeCall(renamePath(oldPath, newPath), callback),
    renameSync: (oldPath: FsPath, newPath: FsPath): void => {
      const oldNormalized = normalize(oldPath);
      const newNormalized = normalize(newPath);
      filesystem.renameSync(oldNormalized, newNormalized);
    },
    stat: (
      path: FsPath,
      optionsOrCallback?: StatOptions | FsCallback<FsStats>,
      callback?: FsCallback<FsStats>
    ): Promise<FsStats> | void => statOperation(path, 'stat', optionsOrCallback, callback),
    lstat: (
      path: FsPath,
      optionsOrCallback?: StatOptions | FsCallback<FsStats>,
      callback?: FsCallback<FsStats>
    ): Promise<FsStats> | void => statOperation(path, 'lstat', optionsOrCallback, callback),
    statSync: (path: FsPath, statOptions?: StatOptions): FsStats | undefined =>
      getStatsSync(path, 'stat', statOptions),
    lstatSync: (path: FsPath, statOptions?: StatOptions): FsStats | undefined =>
      getStatsSync(path, 'lstat', statOptions),
    readlink: (
      path: FsPath,
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
      path: FsPath,
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
      path: FsPath,
      optionsOrCallback?: RmOptions | FsCallback<void>,
      callback?: FsCallback<void>
    ): Promise<void> | void => {
      let rmOptions: RmOptions | undefined;
      let done = callback;
      if (isCallback<void>(optionsOrCallback)) done = optionsOrCallback;
      else rmOptions = optionsOrCallback;
      return completeCall(removePath(path, rmOptions), done);
    },
    rmSync: (path: FsPath, rmOptions: RmOptions = {}): void => {
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
    readFile: (path: FsPath, encoding?: ReadOptions | FsEncoding) =>
      track(readFile(path, encoding)),
    writeFile: (path: FsPath, data: string | Uint8Array, writeOptions?: ReadOptions | FsEncoding) =>
      track(writeFile(path, data, writeOptions)),
    readdir: (path: FsPath, readdirOptions?: ReaddirOptions) =>
      track(readDirectory(path, readdirOptions)),
    stat: (path: FsPath, statOptions?: StatOptions) => track(getStats(path, 'stat', statOptions)),
    lstat: (path: FsPath, statOptions?: StatOptions) => track(getStats(path, 'lstat', statOptions)),
    access: (path: FsPath, mode?: number) => track(accessPath(path, mode)),
    readlink: (path: FsPath, encoding?: ReadOptions | FsEncoding) =>
      track(readlink(path, encoding)),
    realpath: (path: FsPath, encoding?: ReadOptions | FsEncoding) =>
      track(resolveRealpath(path, encoding)),
    symlink: (target: string | Buffer, path: FsPath) => track(createSymlink(target, path)),
    mkdir: (path: FsPath, options?: MkdirOptions) => track(makeDirectory(path, options)),
    unlink: (path: FsPath) => track(unlinkPath(path)),
    appendFile: (
      path: FsPath,
      data: string | Uint8Array,
      writeOptions?: ReadOptions | FsEncoding
    ) => track(appendFile(path, data, writeOptions)),
    rename: (oldPath: FsPath, newPath: FsPath) => track(renamePath(oldPath, newPath)),
    rm: (path: FsPath, options?: RmOptions) => track(removePath(path, options)),
    copyFile: (source: FsPath, destination: FsPath, flags = 0) =>
      track(copyFile(filesystem, normalize(source), normalize(destination), flags)),
    rmdir: (path: FsPath) => track(removeDirectory(filesystem, normalize(path))),
    mkdtemp: (prefix: FsPath, readOptions?: ReadOptions | FsEncoding) =>
      track(
        makeTempDirectory(filesystem, normalize(prefix)).then(path =>
          tempDirectoryResult(path, readOptions)
        )
      ),
  };
  return { ...operations, promises };
}
