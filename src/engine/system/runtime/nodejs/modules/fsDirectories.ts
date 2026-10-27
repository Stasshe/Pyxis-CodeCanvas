import { Buffer } from 'buffer';
import type { RuntimeFsMount } from '@/engine/system/runtime/fs/RuntimeFsMount';
import type { MountStat } from '@/engine/system/runtime/fs/types';
import type { FsPath } from './fsPaths';

export interface FsDirectoryEntry {
  name: string | Buffer;
  parentPath: string | Buffer;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
  isFIFO(): boolean;
  isSocket(): boolean;
}

export interface FsDirectoryOptions {
  encoding?: BufferEncoding | 'buffer' | null;
  bufferSize?: number;
}
export interface FsReadDirectoryOptions extends FsDirectoryOptions {
  withFileTypes?: boolean;
}

export type FsDirectoryItems = Array<string | Buffer | FsDirectoryEntry>;
export type FsDirectoryCallback<T = void> = (error: Error | null, value?: T) => void;
type Tracker = <T>(task: Promise<T>) => Promise<T>;
type NormalizePath = (path: FsPath) => string;

function entryName(name: string, encoding?: BufferEncoding | 'buffer' | null): string | Buffer {
  if (encoding === 'buffer') return Buffer.from(name);
  return name;
}

function displayedPath(path: FsPath, normalized: string): string | Buffer {
  if (Buffer.isBuffer(path)) return Buffer.from(path);
  if (typeof path === 'string') return path;
  return normalized;
}

function dirent(
  name: string | Buffer,
  parentPath: string | Buffer,
  type: MountStat['type']
): FsDirectoryEntry {
  return {
    name,
    parentPath,
    isFile: () => type === 'file',
    isDirectory: () => type === 'directory',
    isSymbolicLink: () => type === 'symlink',
    isBlockDevice: () => false,
    isCharacterDevice: () => type === 'characterDevice',
    isFIFO: () => type === 'fifo',
    isSocket: () => false,
  };
}

function pathError(error: unknown, syscall: string, path: string): Error {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    if (!('syscall' in error)) Object.assign(error, { syscall });
    if (!('path' in error)) Object.assign(error, { path });
    return error;
  }
  return Object.assign(new Error(`${String(error)}: ${syscall} '${path}'`), {
    syscall,
    path,
  });
}

function missingEntryError(syscall: string, path: string): Error & { code: string } {
  return Object.assign(new Error(`ENOENT: ${syscall} '${path}'`), {
    code: 'ENOENT',
    errno: -2,
    syscall,
    path,
  });
}

function directoryClosedError(): Error & { code: string } {
  return Object.assign(new Error('Directory handle was closed'), { code: 'ERR_DIR_CLOSED' });
}

function concurrentOperationError(): Error & { code: string } {
  return Object.assign(
    new Error(
      'Cannot do synchronous work on directory handle with concurrent asynchronous operations'
    ),
    { code: 'ERR_DIR_CONCURRENT_OPERATION' }
  );
}

function callbackTypeError(): Error & { code: string } {
  return Object.assign(
    new TypeError('The "callback" argument must be of type function. Received null'),
    { code: 'ERR_INVALID_ARG_TYPE' }
  );
}

function callbackError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

export class RuntimeFsDir {
  private index = 0;
  private closing = false;
  private closed = false;
  private readQueue: Promise<void> = Promise.resolve();
  private readonly pendingReads = new Set<Promise<FsDirectoryEntry | null>>();

  constructor(
    readonly path: string | Buffer,
    private readonly normalizedPath: string,
    private readonly names: string[],
    private readonly filesystem: RuntimeFsMount,
    private readonly encoding: FsDirectoryOptions['encoding'],
    private readonly track: Tracker
  ) {}

  read(): Promise<FsDirectoryEntry | null>;
  read(callback: FsDirectoryCallback<FsDirectoryEntry | null>): void;
  read(
    callback?: FsDirectoryCallback<FsDirectoryEntry | null>
  ): Promise<FsDirectoryEntry | null> | void {
    if (callback !== undefined && typeof callback !== 'function') throw callbackTypeError();
    const task = this.beginRead();
    if (typeof callback !== 'function') return task;
    void task.then(
      value => callback(null, value),
      error => callback(callbackError(error))
    );
  }

  readSync(): FsDirectoryEntry | null {
    this.assertOpen();
    if (this.pendingReads.size > 0) throw concurrentOperationError();
    const name = this.names[this.index];
    if (name === undefined) return null;
    this.index += 1;
    const child = this.childPath(name);
    const value = this.filesystem.lstatSync(child);
    if (!value) throw missingEntryError('lstat', child);
    return dirent(entryName(name, this.encoding), this.path, value.type);
  }

  close(): Promise<void>;
  close(callback: FsDirectoryCallback): void;
  close(callback?: FsDirectoryCallback): Promise<void> | void {
    if (callback !== undefined && typeof callback !== 'function') throw callbackTypeError();
    const task = this.closeAsync();
    if (typeof callback !== 'function') return task;
    void task.then(
      () => callback(null),
      error => callback(callbackError(error))
    );
  }

  closeSync(): void {
    this.assertOpen();
    if (this.pendingReads.size > 0) throw concurrentOperationError();
    this.closed = true;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<FsDirectoryEntry> {
    const directory = this;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next(): Promise<IteratorResult<FsDirectoryEntry>> {
        try {
          const value = await directory.read();
          if (value !== null) return { value, done: false };
          await directory.closeForIterator();
          return { value: undefined, done: true };
        } catch (error) {
          await directory.closeForIterator();
          throw error;
        }
      },
      async return(): Promise<IteratorResult<FsDirectoryEntry>> {
        await directory.closeForIterator();
        return { value: undefined, done: true };
      },
      async throw(error?: unknown): Promise<IteratorResult<FsDirectoryEntry>> {
        await directory.closeForIterator();
        throw error;
      },
    };
  }

  private beginRead(): Promise<FsDirectoryEntry | null> {
    if (this.closed || this.closing) return Promise.reject(directoryClosedError());
    const task = this.readQueue.then(() => this.readEntry());
    this.readQueue = task.then(
      () => undefined,
      () => undefined
    );
    const trackedTask = this.track(task);
    this.pendingReads.add(trackedTask);
    void trackedTask.then(
      () => this.pendingReads.delete(trackedTask),
      () => this.pendingReads.delete(trackedTask)
    );
    return trackedTask;
  }

  private async readEntry(): Promise<FsDirectoryEntry | null> {
    if (this.closed) throw directoryClosedError();
    const name = this.names[this.index];
    if (name === undefined) return null;
    this.index += 1;
    const child = this.childPath(name);
    let value: MountStat | null;
    try {
      value = await this.filesystem.lstat(child);
    } catch (error) {
      throw pathError(error, 'lstat', child);
    }
    if (!value) throw missingEntryError('lstat', child);
    return dirent(entryName(name, this.encoding), this.path, value.type);
  }

  private async closeAsync(): Promise<void> {
    this.assertOpen();
    this.closing = true;
    const pending = [...this.pendingReads];
    await this.track(
      Promise.all(
        pending.map(task =>
          task.then(
            () => undefined,
            () => undefined
          )
        )
      ).then(() => {
        this.closed = true;
      })
    );
  }

  private async closeForIterator(): Promise<void> {
    if (this.closed || this.closing) return;
    await this.closeAsync();
  }

  private assertOpen(): void {
    if (this.closed || this.closing) throw directoryClosedError();
  }

  private childPath(name: string): string {
    return makeChildPath(this.normalizedPath, name);
  }
}

export function createFsDirectoryOperations(
  filesystem: RuntimeFsMount,
  normalize: NormalizePath,
  getTracker: () => Tracker | undefined
) {
  function track<T>(task: Promise<T>): Promise<T> {
    const tracker = getTracker();
    if (tracker) return tracker(task);
    return task;
  }

  async function readDirectory(
    path: FsPath,
    options?: FsReadDirectoryOptions
  ): Promise<FsDirectoryItems> {
    const normalized = normalize(path);
    const names = await filesystem.listDir(normalized);
    if (!options?.withFileTypes) return names.map(name => entryName(name, options?.encoding));
    const parent = displayedPath(path, normalized);
    return Promise.all(
      names.map(async name => {
        const child = makeChildPath(normalized, name);
        const value = await filesystem.lstat(child);
        if (!value) throw missingEntryError('lstat', child);
        return dirent(entryName(name, options.encoding), parent, value.type);
      })
    );
  }

  function readDirectorySync(path: FsPath, options?: FsReadDirectoryOptions): FsDirectoryItems {
    const normalized = normalize(path);
    const names = filesystem.listDirSync(normalized);
    if (!options?.withFileTypes) return names.map(name => entryName(name, options?.encoding));
    const parent = displayedPath(path, normalized);
    return names.map(name => {
      const child = makeChildPath(normalized, name);
      const value = filesystem.lstatSync(child);
      if (!value) throw missingEntryError('lstat', child);
      return dirent(entryName(name, options.encoding), parent, value.type);
    });
  }

  async function opendir(path: FsPath, options?: FsDirectoryOptions): Promise<RuntimeFsDir> {
    const normalized = normalize(path);
    const names = await filesystem.listDir(normalized);
    return new RuntimeFsDir(
      displayedPath(path, normalized),
      normalized,
      names,
      filesystem,
      options?.encoding,
      track
    );
  }

  function opendirSync(path: FsPath, options?: FsDirectoryOptions): RuntimeFsDir {
    const normalized = normalize(path);
    const names = filesystem.listDirSync(normalized);
    return new RuntimeFsDir(
      displayedPath(path, normalized),
      normalized,
      names,
      filesystem,
      options?.encoding,
      track
    );
  }

  return { readDirectory, readDirectorySync, opendir, opendirSync };
}

function makeChildPath(path: string, name: string): string {
  if (path === '/') return `/${name}`;
  if (path.endsWith('/')) return `${path}${name}`;
  return `${path}/${name}`;
}
