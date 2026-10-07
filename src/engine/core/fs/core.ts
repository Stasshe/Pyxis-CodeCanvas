import type { ProjectFile } from '@/types';
import { basename, getParentPath, HOME_DIR, normalizePath } from '../pathUtils';
import { FSError } from './errors';
import { NPM_CACHE_PATH, RUNTIME_CACHE_PATH, TMP_PATH } from './layout';
import type { FsChangeEvent, MkdirOptions, RmOptions } from './types';

export { FSError } from './errors';
export type { FsChangeEvent, MkdirOptions, RmOptions } from './types';

interface SyncAccessHandle {
  getSize(): number;
  read(buffer: Uint8Array, options: { at: number }): number;
  write(buffer: Uint8Array, options: { at: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}

interface OpfsFileHandle extends FileSystemFileHandle {
  createSyncAccessHandle(): Promise<SyncAccessHandle>;
}

interface MemoryEntry {
  metadata: ProjectFile;
  data?: Uint8Array;
}

/** The worker owns persistent handles; /tmp is an ephemeral mount. */
export class FsCore {
  private root: FileSystemDirectoryHandle | null = null;
  private readonly memory = new Map<string, MemoryEntry>();
  private readonly accessQueues = new Map<string, Promise<void>>();
  private changeListener: ((event: FsChangeEvent) => void) | null = null;

  constructor() {
    this.memory.set(TMP_PATH, { metadata: this.folder(TMP_PATH) });
  }

  async init(root?: FileSystemDirectoryHandle): Promise<void> {
    if (root) this.root = root;
    else this.root = await navigator.storage.getDirectory();
    for (const path of [HOME_DIR, RUNTIME_CACHE_PATH, NPM_CACHE_PATH]) {
      let directory = this.root;
      for (const segment of path.split('/').filter(Boolean)) {
        directory = await directory.getDirectoryHandle(segment, { create: true });
      }
    }
  }

  setChangeListener(listener: (event: FsChangeEvent) => void): void {
    this.changeListener = listener;
  }

  private folder(path: string): ProjectFile {
    return { path, type: 'folder', size: 0, mtime: Date.now() };
  }

  private isMemory(path: string): boolean {
    return path === TMP_PATH || path.startsWith(`${TMP_PATH}/`);
  }

  private emit(event: FsChangeEvent): void {
    this.changeListener?.(event);
  }

  private async withAccess<T>(
    path: string,
    create: boolean,
    operation: (access: SyncAccessHandle) => T
  ): Promise<T> {
    const previous = this.accessQueues.get(path) ?? Promise.resolve();
    const task = previous.then(async () => {
      try {
        const handle = await this.fileHandle(path, create);
        const access = await handle.createSyncAccessHandle();
        try {
          return operation(access);
        } finally {
          access.close();
        }
      } catch (error) {
        if (error instanceof DOMException) throw this.translate(error, path);
        throw error;
      }
    });
    const completion = task.then(
      () => {},
      () => {}
    );
    this.accessQueues.set(path, completion);
    try {
      return await task;
    } finally {
      if (this.accessQueues.get(path) === completion) this.accessQueues.delete(path);
    }
  }

  private translate(error: Error | DOMException, path: string): FSError {
    if (error instanceof FSError) return error;
    if (error.name === 'NotFoundError') return new FSError('ENOENT', path);
    if (error.name === 'TypeMismatchError') return new FSError('ENOTDIR', path);
    if (error.name === 'InvalidModificationError') return new FSError('ENOTEMPTY', path);
    if (error.name === 'QuotaExceededError') return new FSError('ENOSPC', path);
    if (error.name === 'NotAllowedError') return new FSError('EACCES', path);
    return new FSError('EIO', path);
  }

  private async directory(path: string): Promise<FileSystemDirectoryHandle> {
    if (!this.root) throw new Error('FS Core is not initialized');
    let directory = this.root;
    try {
      for (const segment of path.split('/').filter(Boolean)) {
        directory = await directory.getDirectoryHandle(segment);
      }
      return directory;
    } catch (error) {
      if (error instanceof Error) throw this.translate(error, path);
      throw error;
    }
  }

  private async fileHandle(path: string, create = false): Promise<OpfsFileHandle> {
    const parent = await this.directory(getParentPath(path));
    try {
      return (await parent.getFileHandle(basename(path), { create })) as OpfsFileHandle;
    } catch (error) {
      if (error instanceof Error && error.name === 'TypeMismatchError') {
        throw new FSError('EISDIR', path);
      }
      if (error instanceof Error) throw this.translate(error, path);
      throw error;
    }
  }

  async stat(input: string): Promise<ProjectFile> {
    const path = normalizePath(input);
    if (this.isMemory(path)) {
      const entry = this.memory.get(path);
      if (!entry) throw new FSError('ENOENT', path);
      return { ...entry.metadata };
    }
    if (path === '/') return { path, type: 'folder', size: 0, mtime: 0 };
    const parent = await this.directory(getParentPath(path));
    try {
      const handle = await parent.getFileHandle(basename(path));
      const file = await handle.getFile();
      return { path, type: 'file', size: file.size, mtime: file.lastModified };
    } catch (error) {
      if (error instanceof Error && error.name === 'TypeMismatchError') {
        await parent.getDirectoryHandle(basename(path));
        return { path, type: 'folder', size: 0, mtime: 0 };
      }
      if (error instanceof Error) throw this.translate(error, path);
      throw error;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch (error) {
      if (error instanceof FSError && error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async readFile(input: string): Promise<Uint8Array> {
    const path = normalizePath(input);
    if (this.isMemory(path)) {
      const entry = this.memory.get(path);
      if (!entry) throw new FSError('ENOENT', path);
      if (!entry.data) throw new FSError('EISDIR', path);
      return entry.data.slice();
    }
    return this.withAccess(path, false, access => {
      const data = new Uint8Array(access.getSize());
      let offset = 0;
      while (offset < data.byteLength) {
        const count = access.read(data.subarray(offset), { at: offset });
        if (count === 0) throw new FSError('EIO', path);
        offset += count;
      }
      return data;
    });
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder('utf-8').decode(await this.readFile(path));
  }

  async writeFile(input: string, content: string | Uint8Array, emit = true): Promise<void> {
    const path = normalizePath(input);
    let data: Uint8Array;
    if (typeof content === 'string') data = new TextEncoder().encode(content);
    else data = content;
    const existed = await this.exists(path);
    if (this.isMemory(path)) {
      const parent = await this.stat(getParentPath(path));
      if (parent.type !== 'folder') throw new FSError('ENOTDIR', parent.path);
      const existing = this.memory.get(path);
      if (existing?.metadata.type === 'folder') throw new FSError('EISDIR', path);
      this.memory.set(path, {
        metadata: { path, type: 'file', size: data.byteLength, mtime: Date.now() },
        data: data.slice(),
      });
    } else {
      await this.withAccess(path, true, access => {
        let offset = 0;
        while (offset < data.byteLength) {
          const count = access.write(data.subarray(offset), { at: offset });
          if (count === 0) throw new FSError('EIO', path);
          offset += count;
        }
        access.truncate(data.byteLength);
        access.flush();
      });
    }
    let type: FsChangeEvent['type'] = 'create';
    if (existed) type = 'update';
    if (emit) this.emit({ type, path, file: await this.stat(path) });
  }

  async readdir(input: string): Promise<ProjectFile[]> {
    const path = normalizePath(input);
    const metadata = await this.stat(path);
    if (metadata.type !== 'folder') throw new FSError('ENOTDIR', path);
    const result: ProjectFile[] = [];
    if (this.isMemory(path)) {
      for (const [entryPath, entry] of this.memory) {
        if (entryPath !== path && getParentPath(entryPath) === path) {
          result.push({ ...entry.metadata });
        }
      }
    } else {
      const directory = await this.directory(path);
      for await (const [name] of directory.entries()) {
        if (path === '/' && name === 'tmp') continue;
        let childPath = `${path}/${name}`;
        if (path === '/') childPath = `/${name}`;
        result.push(await this.stat(childPath));
      }
      if (path === '/') result.push(await this.stat(TMP_PATH));
    }
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }

  async mkdir(input: string, options: MkdirOptions = {}, emit = true): Promise<void> {
    const path = normalizePath(input);
    if (await this.exists(path)) {
      const entry = await this.stat(path);
      if (options.recursive && entry.type === 'folder') return;
      throw new FSError('EEXIST', path);
    }
    const parentPath = getParentPath(path);
    if (options.recursive && !(await this.exists(parentPath))) {
      await this.mkdir(parentPath, options, emit);
    }
    const parent = await this.stat(parentPath);
    if (parent.type !== 'folder') throw new FSError('ENOTDIR', parentPath);
    if (this.isMemory(path)) this.memory.set(path, { metadata: this.folder(path) });
    else {
      const directory = await this.directory(parentPath);
      try {
        await directory.getDirectoryHandle(basename(path), { create: true });
      } catch (error) {
        if (error instanceof Error) throw this.translate(error, path);
        throw error;
      }
    }
    if (emit) this.emit({ type: 'create', path, file: await this.stat(path) });
  }

  async rm(input: string, options: RmOptions = {}, emit = true): Promise<void> {
    const path = normalizePath(input);
    if (path === '/' || path === TMP_PATH) {
      throw new FSError('EBUSY', path);
    }
    let metadata: ProjectFile;
    try {
      metadata = await this.stat(path);
    } catch (error) {
      if (options.force && error instanceof FSError && error.code === 'ENOENT') return;
      throw error;
    }
    if (metadata.type === 'folder' && !options.recursive) {
      throw new FSError('EISDIR', path);
    }
    if (this.isMemory(path)) {
      for (const entryPath of this.memory.keys()) {
        if (entryPath === path || entryPath.startsWith(`${path}/`)) {
          this.memory.delete(entryPath);
        }
      }
    } else {
      const parent = await this.directory(getParentPath(path));
      try {
        await parent.removeEntry(basename(path), { recursive: options.recursive });
      } catch (error) {
        if (error instanceof Error) throw this.translate(error, path);
        throw error;
      }
    }
    if (emit) this.emit({ type: 'delete', path });
  }

  /** Returns descendants only; each item contains metadata, never file contents. */
  async walk(path: string): Promise<ProjectFile[]> {
    const entries = await this.readdir(path);
    const result: ProjectFile[] = [];
    for (const entry of entries) {
      result.push(entry);
      if (entry.type === 'folder') result.push(...(await this.walk(entry.path)));
    }
    return result;
  }

  async rename(oldInput: string, newInput: string): Promise<void> {
    const oldPath = normalizePath(oldInput);
    const path = normalizePath(newInput);
    if (oldPath === path) {
      await this.stat(oldPath);
      return;
    }
    if (['/', TMP_PATH].includes(oldPath) || ['/', TMP_PATH].includes(path)) {
      throw new FSError('EBUSY', oldPath);
    }
    if (path.startsWith(`${oldPath}/`)) throw new FSError('EINVAL', path);
    const source = await this.stat(oldPath);
    const parent = await this.stat(getParentPath(path));
    if (parent.type !== 'folder') throw new FSError('ENOTDIR', parent.path);
    if (await this.exists(path)) {
      const destination = await this.stat(path);
      if (source.type === 'file' && destination.type === 'folder') {
        throw new FSError('EISDIR', path);
      }
      if (source.type === 'folder' && destination.type === 'file') {
        throw new FSError('ENOTDIR', path);
      }
      if (destination.type === 'folder' && (await this.readdir(path)).length > 0) {
        throw new FSError('ENOTEMPTY', path);
      }
    }
    if (source.type === 'file') await this.writeFile(path, await this.readFile(oldPath), false);
    else {
      await this.mkdir(path, { recursive: true }, false);
      for (const entry of await this.walk(oldPath)) {
        const target = `${path}${entry.path.slice(oldPath.length)}`;
        if (entry.type === 'folder') await this.mkdir(target, { recursive: true }, false);
        else await this.writeFile(target, await this.readFile(entry.path), false);
      }
    }
    // Only remove the source after every destination write succeeds.
    await this.rm(oldPath, { recursive: true }, false);
    this.emit({ type: 'rename', oldPath, path, file: await this.stat(path) });
  }
}
