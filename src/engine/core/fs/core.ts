import type { ProjectFile } from '@/types';
import { basename, getParentPath, HOME_DIR, normalizePath, resolvePath } from '../pathUtils';
import { FSError, translateFsError } from './errors';
import { FIFO_STORAGE, FifoEntries, FifoService } from './fifo';
import type { OpfsMovableFile } from './fileMove';
import { mountRoot, NPM_CACHE_PATH, RUNTIME_CACHE_PATH, TMP_PATH } from './layout';
import { LINK_STORAGE, Links } from './links';
import { NamespaceLock } from './locks';
import { RootPins } from './pins';
import { renamePath } from './rename';
import { removeDirectory, removeDirectorySidecars } from './sidecars';
import type { FsChangeEvent, MkdirOptions, RenameOptions, RmOptions } from './types';
import { rangeEnd, type WriteRange, writeStored } from './write';

export { FSError } from './errors';
export type { FsChangeEvent, MkdirOptions, RenameOptions, RmOptions } from './types';

interface SyncAccessHandle {
  getSize(): number;
  read(buffer: Uint8Array, options: { at: number }): number;
  close(): void;
}

interface OpfsFileHandle extends OpfsMovableFile {
  createSyncAccessHandle(): Promise<SyncAccessHandle>;
}

interface MemoryEntry {
  metadata: ProjectFile;
  data?: Uint8Array;
}

interface DirectoryEntry {
  segment: string;
  handle: FileSystemDirectoryHandle;
}

type MutationAttempt<T> =
  | { blocked: true; waiting: Promise<void[]> }
  | { blocked: false; value: T };

/** The worker owns persistent handles; /tmp is an ephemeral mount. */
export class FsCore {
  private readonly namespace = new NamespaceLock();
  private readonly rootPins = new RootPins();
  private root: FileSystemDirectoryHandle | null = null;
  private readonly links = new Links();
  private readonly fifoEntries = new FifoEntries();
  private readonly fifos = new FifoService(
    this.namespace,
    this.fifoEntries,
    async (input, required) => {
      const path = await this.resolve(input);
      if (required) await this.rawStat(path);
      return path;
    },
    input => this.mkfifoUnlocked(input)
  );
  readonly mkfifo = this.fifos.mkfifo.bind(this.fifos);
  readonly openFifo = this.fifos.openFifo.bind(this.fifos);
  readonly readFifo = this.fifos.readFifo.bind(this.fifos);
  readonly writeFifo = this.fifos.writeFifo.bind(this.fifos);
  readonly closeFifo = this.fifos.closeFifo.bind(this.fifos);
  readonly closeFifos = this.fifos.closeFifos.bind(this.fifos);
  readonly createPipe = this.fifos.createPipe.bind(this.fifos);
  readonly getDescriptorPath = this.fifos.getDescriptorPath.bind(this.fifos);
  private directoryChain: DirectoryEntry[] = [];
  private directoryEpoch = 0;
  private readonly memory = new Map<string, MemoryEntry>();
  private readonly accessQueues = new Map<string, Promise<void>>();
  private changeListener: ((event: FsChangeEvent) => void) | null = null;

  constructor() {
    this.memory.set(TMP_PATH, { metadata: mountRoot(TMP_PATH, 'memory', Date.now()) });
  }

  init(root?: FileSystemDirectoryHandle): Promise<void> {
    return this.mutate(['/'], () => this.initUnlocked(root));
  }

  realpath(path: string): Promise<string> {
    return this.namespace.shared(() => this.realpathUnlocked(path));
  }

  readlink(path: string): Promise<string> {
    return this.namespace.shared(() => this.readlinkUnlocked(path));
  }

  symlink(target: string, path: string, emit = true): Promise<void> {
    return this.namespace.exclusive(() => this.symlinkUnlocked(target, path, emit));
  }

  stat(path: string): Promise<ProjectFile> {
    return this.namespace.shared(() => this.statUnlocked(path));
  }

  lstat(path: string): Promise<ProjectFile> {
    return this.namespace.shared(() => this.lstatUnlocked(path));
  }

  exists(path: string): Promise<boolean> {
    return this.namespace.shared(() => this.entryExists(path, true));
  }

  readFile(path: string, ownerId = ''): Promise<Uint8Array> {
    return this.fifos.readFile(path, ownerId, () => this.readFileUnlocked(path));
  }

  async readText(path: string, ownerId = ''): Promise<string> {
    return new TextDecoder('utf-8').decode(await this.readFile(path, ownerId));
  }

  writeFile(path: string, data: string | Uint8Array, emit = true, ownerId = ''): Promise<void> {
    return this.fifos.writeFile(path, data, ownerId, () =>
      this.writeFileUnlocked(path, data, emit)
    );
  }

  /** Range updates share the same resolved-path queue as whole-file writes. */
  writeRange(
    input: string,
    data: Uint8Array,
    position: number | null,
    create = false,
    exclusive = false
  ): Promise<number> {
    return this.namespace.shared(async () => {
      if (
        !(data instanceof Uint8Array) ||
        typeof create !== 'boolean' ||
        typeof exclusive !== 'boolean' ||
        (position !== null && (!Number.isSafeInteger(position) || position < 0))
      ) {
        throw new FSError('EINVAL', input);
      }
      if (exclusive && (await this.entryExists(input))) throw new FSError('EEXIST', input);
      return this.writeUnlocked(input, data, true, { position, create, exclusive });
    });
  }

  readdir(path: string): Promise<ProjectFile[]> {
    return this.namespace.shared(() => this.readdirUnlocked(path));
  }

  mkdir(path: string, options: MkdirOptions = {}, emit = true): Promise<void> {
    return this.namespace.exclusive(() => this.mkdirUnlocked(path, options, emit));
  }

  rm(path: string, options: RmOptions = {}, emit = true): Promise<void> {
    return this.mutate([path], () => this.rmUnlocked(path, options, emit));
  }

  walk(path: string): Promise<ProjectFile[]> {
    return this.namespace.shared(() => this.walkUnlocked(path));
  }

  rename(oldPath: string, path: string, options?: RenameOptions): Promise<void> {
    return this.mutate([oldPath, path], () => this.renameUnlocked(oldPath, path, options));
  }

  /** Pin root identity across a service transaction without holding the namespace lease. */
  async withPinnedRoot<T>(input: string, operation: (root: string) => Promise<T>): Promise<T> {
    const lease = await this.namespace.shared(async () => {
      const paths = new Set<string>();
      const root = await this.resolve(input, true, true, paths);
      if ((await this.rawStat(root)).type !== 'folder') throw new FSError('ENOTDIR', input);
      paths.add(root);
      return { root, release: this.rootPins.acquire(paths) };
    });
    try {
      return await operation(lease.root);
    } finally {
      lease.release();
    }
  }

  private async mutate<T>(inputs: string[], operation: () => Promise<T>): Promise<T> {
    while (true) {
      const attempt = await this.namespace.exclusive(async (): Promise<MutationAttempt<T>> => {
        const paths: string[] = [];
        for (const input of inputs) paths.push(await this.resolve(input, false, false));
        const waiting = this.rootPins.blockers(paths);
        if (waiting.length > 0) return { blocked: true, waiting: Promise.all(waiting) };
        return { blocked: false, value: await operation() };
      });
      if (!attempt.blocked) return attempt.value;
      await attempt.waiting;
    }
  }

  private async initUnlocked(root?: FileSystemDirectoryHandle): Promise<void> {
    this.invalidateDirectories();
    if (root) this.root = root;
    else this.root = await navigator.storage.getDirectory();
    this.invalidateDirectories();
    await this.links.init(this.root);
    await this.fifoEntries.init(this.root);
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
    return this.queueAccess(path, async () => {
      const handle = await this.fileHandle(path, create);
      const access = await handle.createSyncAccessHandle();
      try {
        return operation(access);
      } finally {
        access.close();
      }
    });
  }

  private async queueAccess<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.accessQueues.get(path) ?? Promise.resolve();
    const task = previous.then(async () => {
      try {
        return await operation();
      } catch (error) {
        if (error instanceof DOMException) throw translateFsError(error, path);
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

  private async directory(path: string): Promise<FileSystemDirectoryHandle> {
    if (!this.root) throw new Error('FS Core is not initialized');
    const epoch = this.directoryEpoch;
    const segments = path.split('/').filter(Boolean);
    const previous = this.directoryChain;
    let shared = 0;
    while (shared < segments.length && previous[shared]?.segment === segments[shared]) {
      shared += 1;
    }
    const chain = previous.slice(0, shared);
    let directory = this.root;
    if (shared > 0) directory = chain[shared - 1].handle;
    try {
      for (const segment of segments.slice(shared)) {
        directory = await directory.getDirectoryHandle(segment);
        chain.push({ segment, handle: directory });
      }
      if (epoch === this.directoryEpoch) this.directoryChain = chain;
      return directory;
    } catch (error) {
      if (error instanceof Error) throw translateFsError(error, path);
      throw error;
    }
  }

  private invalidateDirectories(): void {
    this.directoryEpoch += 1;
    this.directoryChain = [];
  }

  private async fileHandle(path: string, create = false): Promise<OpfsFileHandle> {
    const parent = await this.directory(getParentPath(path));
    try {
      return (await parent.getFileHandle(basename(path), { create })) as OpfsFileHandle;
    } catch (error) {
      if (error instanceof Error && error.name === 'TypeMismatchError') {
        throw new FSError('EISDIR', path);
      }
      if (error instanceof Error) throw translateFsError(error, path);
      throw error;
    }
  }

  private async resolve(
    input: string,
    followFinal = true,
    followTrailing = true,
    traversedLinks?: Set<string>
  ): Promise<string> {
    normalizePath(input);
    const pending = input.split('/').filter(Boolean);
    let path = '/';
    let followed = 0;
    let directoryRequired = input.endsWith('/');
    while (pending.length > 0) {
      const segment = pending.shift()!;
      if (segment === '.') {
        const entry = await this.rawStat(path);
        if (entry.type !== 'folder') throw new FSError('ENOTDIR', path);
        continue;
      }
      if (segment === '..') {
        const entry = await this.rawStat(path);
        if (entry.type !== 'folder') throw new FSError('ENOTDIR', path);
        path = getParentPath(path);
        continue;
      }
      path = resolvePath(path, segment);
      if (path === `/${LINK_STORAGE}` || path === `/${FIFO_STORAGE}`)
        throw new FSError('EACCES', input);
      const link = this.links.entries.get(path);
      if (
        !link ||
        (!followFinal && pending.length === 0 && (!followTrailing || !input.endsWith('/')))
      )
        continue;
      traversedLinks?.add(path);
      followed += 1;
      if (followed > 40) throw new FSError('ELOOP', input);
      if (!pending.length && link.target.endsWith('/')) directoryRequired = true;
      const target = link.target.split('/').filter(Boolean);
      if (link.target.startsWith('/')) path = '/';
      else path = getParentPath(path);
      pending.unshift(...target);
    }
    if (directoryRequired) {
      const entry = await this.rawStat(path);
      if (entry.type !== 'folder') throw new FSError('ENOTDIR', input);
    }
    return path;
  }

  private async realpathUnlocked(input: string): Promise<string> {
    const path = await this.resolve(input);
    await this.rawStat(path);
    return path;
  }

  private async readlinkUnlocked(input: string): Promise<string> {
    const path = await this.resolve(input, false);
    const link = this.links.entries.get(path);
    if (link) return link.target;
    await this.rawStat(path);
    throw new FSError('EINVAL', input);
  }

  private async symlinkUnlocked(target: string, input: string, emit = true): Promise<void> {
    if (!target || target.includes('\0')) throw new FSError('EINVAL', input);
    const path = await this.resolve(input, false, false);
    this.fifos.descriptors.assertMutable(path);
    try {
      await this.rawStat(path);
      throw new FSError('EEXIST', path);
    } catch (error) {
      if (!(error instanceof FSError) || error.code !== 'ENOENT') throw error;
    }
    const parent = await this.statUnlocked(getParentPath(path));
    if (parent.type !== 'folder') throw new FSError('ENOTDIR', parent.path);
    try {
      await this.links.create(path, target);
    } catch (error) {
      if (error instanceof DOMException) throw translateFsError(error, path);
      throw error;
    }
    if (emit) this.emit({ type: 'create', path, file: await this.lstatUnlocked(path) });
  }

  private async statUnlocked(input: string): Promise<ProjectFile> {
    return this.rawStat(await this.resolve(input));
  }

  private async lstatUnlocked(input: string): Promise<ProjectFile> {
    return this.rawStat(await this.resolve(input, false));
  }

  private async rawStat(path: string): Promise<ProjectFile> {
    const descriptor = this.fifos.descriptors.stat(path) ?? this.fifoEntries.stat(path);
    if (descriptor) return descriptor;
    const link = this.links.entries.get(path);
    if (link)
      return {
        path,
        type: 'symlink',
        size: new TextEncoder().encode(link.target).length,
        mtime: link.mtime,
      };
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
      if (error instanceof Error) throw translateFsError(error, path);
      throw error;
    }
  }

  private async entryExists(path: string, followFinal = false): Promise<boolean> {
    try {
      await this.rawStat(await this.resolve(path, followFinal));
      return true;
    } catch (error) {
      if (error instanceof FSError && error.code === 'ENOENT') return false;
      throw error;
    }
  }

  private async readFileUnlocked(input: string): Promise<Uint8Array> {
    const path = await this.resolve(input);
    this.fifos.descriptors.assertStored(path, this.fifoEntries.entries.has(path));
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

  private async writeFileUnlocked(
    input: string,
    content: string | Uint8Array,
    emit = true
  ): Promise<void> {
    let data: Uint8Array;
    if (typeof content === 'string') data = new TextEncoder().encode(content);
    else data = content;
    await this.writeUnlocked(input, data, emit);
  }

  private async writeUnlocked(
    input: string,
    data: Uint8Array,
    emit: boolean,
    range?: WriteRange
  ): Promise<number> {
    const path = await this.resolve(input);
    const deviceEnd = this.fifos.descriptors.writeNull(path, data, range);
    if (deviceEnd !== undefined) return deviceEnd;
    this.fifos.descriptors.assertStored(path, this.fifoEntries.entries.has(path));
    return this.queueAccess(path, async () => {
      if (!this.isMemory(path)) {
        const parent = await this.directory(getParentPath(path));
        const result = await writeStored(parent, path, data, range, emit);
        if (emit) this.emit(result.event);
        return result.end;
      }
      const existing = this.memory.get(path);
      if (range?.exclusive && existing) throw new FSError('EEXIST', path);
      if (existing?.metadata.type === 'folder') throw new FSError('EISDIR', path);
      if (range && !range.create && !existing) throw new FSError('ENOENT', path);
      const parent = await this.statUnlocked(getParentPath(path));
      if (parent.type !== 'folder') throw new FSError('ENOTDIR', parent.path);
      let end = data.byteLength;
      let content = data.slice();
      if (range) {
        const previous = existing?.data ?? new Uint8Array();
        end = rangeEnd(path, previous.byteLength, data, range);
        let size = previous.byteLength;
        if (data.byteLength > 0) size = Math.max(size, end);
        content = new Uint8Array(size);
        content.set(previous);
        if (data.byteLength > 0) content.set(data, end - data.byteLength);
      }
      const metadata: ProjectFile = {
        path,
        type: 'file',
        size: content.byteLength,
        mtime: Date.now(),
      };
      this.memory.set(path, { metadata, data: content });
      let type: FsChangeEvent['type'] = 'create';
      if (existing) type = 'update';
      if (emit) this.emit({ type, path, file: { ...metadata } });
      return end;
    });
  }

  private async readdirUnlocked(input: string): Promise<ProjectFile[]> {
    const path = await this.resolve(input);
    return this.fifos.descriptors.readdir(path, () => this.readDirectoryUnlocked(path));
  }

  private async readDirectoryUnlocked(path: string): Promise<ProjectFile[]> {
    const metadata = await this.lstatUnlocked(path);
    if (metadata.type !== 'folder') throw new FSError('ENOTDIR', path);
    const result: ProjectFile[] = [];
    if (this.isMemory(path)) {
      for (const [entryPath, entry] of this.memory) {
        if (entryPath !== path && getParentPath(entryPath) === path) {
          result.push({ ...entry.metadata });
        }
      }
    } else {
      for await (const name of this.fifos.descriptors.physicalNames(
        path,
        () => this.directory(path),
        this.root !== null
      )) {
        if (path === '/' && ['tmp', LINK_STORAGE, FIFO_STORAGE].includes(name)) continue;
        let childPath = `${path}/${name}`;
        if (path === '/') childPath = `/${name}`;
        result.push(await this.lstatUnlocked(childPath));
      }
      if (path === '/') result.push(await this.statUnlocked(TMP_PATH));
    }
    for (const link of this.links.entries.values()) {
      if (getParentPath(link.path) === path) result.push(await this.lstatUnlocked(link.path));
    }
    for (const fifo of this.fifoEntries.entries.values()) {
      if (getParentPath(fifo.path) === path) result.push(await this.rawStat(fifo.path));
    }
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }

  private async mkfifoUnlocked(input: string): Promise<void> {
    const path = await this.resolve(input, false, false);
    this.fifos.descriptors.assertMutable(path);
    if (await this.entryExists(path)) throw new FSError('EEXIST', path);
    const parent = await this.statUnlocked(getParentPath(path));
    if (parent.type !== 'folder') throw new FSError('ENOTDIR', parent.path);
    try {
      await this.fifoEntries.create(path);
    } catch (error) {
      if (error instanceof DOMException) throw translateFsError(error, path);
      throw error;
    }
    this.emit({ type: 'create', path, file: await this.rawStat(path) });
  }

  private async mkdirUnlocked(
    input: string,
    options: MkdirOptions = {},
    emit = true
  ): Promise<void> {
    const finalPath = await this.resolve(input.replace(/\/+$/, '') || '/', false);
    if (this.links.entries.has(finalPath)) {
      if (options.recursive && (await this.statUnlocked(input)).type === 'folder') return;
      throw new FSError('EEXIST', input);
    }
    const path = finalPath;
    if (await this.entryExists(path, true)) {
      const entry = await this.statUnlocked(path);
      if (options.recursive && entry.type === 'folder') return;
      throw new FSError('EEXIST', path);
    }
    this.fifos.descriptors.assertMutable(path);
    const parentPath = getParentPath(path);
    if (options.recursive && !(await this.entryExists(parentPath, true))) {
      await this.mkdirUnlocked(parentPath, options, emit);
    }
    const parent = await this.statUnlocked(parentPath);
    if (parent.type !== 'folder') throw new FSError('ENOTDIR', parentPath);
    if (this.isMemory(path)) this.memory.set(path, { metadata: this.folder(path) });
    else {
      const directory = await this.directory(parentPath);
      try {
        await directory.getDirectoryHandle(basename(path), { create: true });
      } catch (error) {
        if (error instanceof Error) throw translateFsError(error, path);
        throw error;
      }
    }
    if (emit) this.emit({ type: 'create', path, file: await this.statUnlocked(path) });
  }

  private async rmUnlocked(input: string, options: RmOptions = {}, emit = true): Promise<void> {
    const path = await this.resolve(input, false, false);
    this.fifos.descriptors.assertMutable(path);
    if (path === '/' || path === TMP_PATH) {
      throw new FSError('EBUSY', path);
    }
    let metadata: ProjectFile;
    try {
      metadata = await this.lstatUnlocked(path);
    } catch (error) {
      if (options.force && error instanceof FSError && error.code === 'ENOENT') return;
      throw error;
    }
    if (metadata.type === 'folder' && !options.recursive) {
      throw new FSError('EISDIR', path);
    }
    if (metadata.type === 'symlink' || metadata.type === 'fifo') {
      if (metadata.type === 'symlink') await this.links.remove(path);
      else await this.fifoEntries.remove(path);
      if (emit) this.emit({ type: 'delete', path });
      return;
    }
    if (metadata.type === 'folder' && this.isMemory(path)) {
      await removeDirectorySidecars(path, this.links, this.fifoEntries);
    }
    if (this.isMemory(path)) {
      for (const entryPath of this.memory.keys()) {
        if (entryPath === path || entryPath.startsWith(`${path}/`)) {
          this.memory.delete(entryPath);
        }
      }
    } else {
      const parent = await this.directory(getParentPath(path));
      const removalSnapshot =
        metadata.type === 'folder' && emit ? await this.walkUnlocked(path) : undefined;
      if (metadata.type === 'folder') this.invalidateDirectories();
      try {
        if (metadata.type === 'folder')
          await removeDirectory(
            path,
            parent,
            basename(path),
            this.links,
            this.fifoEntries,
            translateFsError
          );
        else await parent.removeEntry(basename(path), { recursive: options.recursive });
      } catch (error) {
        if (removalSnapshot) {
          this.invalidateDirectories();
          try {
            const current = await this.walkUnlocked(path);
            const currentPaths = new Set(current.map(entry => entry.path));
            const missing = new Set(
              removalSnapshot
                .filter(entry => !currentPaths.has(entry.path))
                .map(entry => entry.path)
            );
            for (const entry of removalSnapshot) {
              if (missing.has(entry.path) && !missing.has(getParentPath(entry.path))) {
                this.emit({ type: 'delete', path: entry.path });
              }
            }
          } catch (reconcileError) {
            if (reconcileError instanceof FSError && reconcileError.code === 'ENOENT') {
              this.emit({ type: 'delete', path });
            } else {
              const failure =
                error instanceof Error ? translateFsError(error, path) : new Error(String(error));
              throw new AggregateError(
                [failure, reconcileError],
                `Failed to reconcile removal of ${path}`
              );
            }
          }
        }
        if (error instanceof Error) throw translateFsError(error, path);
        throw error;
      } finally {
        if (metadata.type === 'folder') this.invalidateDirectories();
      }
    }
    if (metadata.type !== 'folder') {
      for (const linkPath of this.links.entries.keys()) {
        if (linkPath.startsWith(`${path}/`)) await this.links.remove(linkPath);
      }
      await this.fifoEntries.removeTree(path);
    }
    if (emit) this.emit({ type: 'delete', path });
  }

  /** Returns descendants only; each item contains metadata, never file contents. */
  private async walkUnlocked(path: string): Promise<ProjectFile[]> {
    const entries = await this.readdirUnlocked(path);
    const result: ProjectFile[] = [];
    for (const entry of entries) {
      result.push(entry);
      if (entry.type === 'folder') result.push(...(await this.walkUnlocked(entry.path)));
    }
    return result;
  }

  private renameUnlocked(
    oldInput: string,
    newInput: string,
    options?: RenameOptions
  ): Promise<void> {
    return renamePath(
      oldInput,
      newInput,
      {
        resolve: path => this.resolve(path, false, false),
        assertMutable: path => this.fifos.descriptors.assertMutable(path),
        isMemory: path => this.isMemory(path),
        lstat: path => this.lstatUnlocked(path),
        stat: path => this.statUnlocked(path),
        exists: path => this.entryExists(path),
        remove: (path, options) => this.rmUnlocked(path, options, false),
        mkdir: (path, options) => this.mkdirUnlocked(path, options, false),
        symlink: (target, path) => this.symlinkUnlocked(target, path, false),
        readlink: path => this.readlinkUnlocked(path),
        readFile: path => this.readFileUnlocked(path),
        writeFile: (path, content) => this.writeFileUnlocked(path, content, false),
        readdir: path => this.readdirUnlocked(path),
        walk: path => this.walkUnlocked(path),
        directory: path => this.directory(path),
        file: path => this.fileHandle(path),
        links: this.links,
        fifos: this.fifoEntries,
        memory: this.memory,
        emit: event => this.emit(event),
      },
      options
    );
  }
}
