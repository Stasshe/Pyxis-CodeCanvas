import type { ProjectFile } from '@/types';
import { FifoDescriptors } from './descriptors';
import { FSError } from './errors';
import type { NamespaceLock } from './locks';
import { defaultMode } from './permissions';
import type { FifoMode, FifoOpenOptions, PipePaths } from './types';

const CAPACITY = 65536;
const PIPE_BUF = 4096;

export const FIFO_STORAGE = '.pyxis-fs-fifos';

export interface FifoEntry {
  path: string;
  mtime: number;
  mode?: number;
  inode: Fifo;
}

/** Only the named entry is persistent; a pipe's bytes and open endpoints are volatile. */
export class FifoEntries {
  readonly entries = new Map<string, FifoEntry>();
  private directory: FileSystemDirectoryHandle | null = null;

  stat(path: string): ProjectFile | undefined {
    const entry = this.entries.get(path);
    if (entry)
      return {
        path,
        type: 'fifo',
        mode: entry.mode ?? defaultMode('fifo'),
        size: 0,
        mtime: entry.mtime,
      };
  }

  async init(root: FileSystemDirectoryHandle): Promise<void> {
    this.directory = await root.getDirectoryHandle(FIFO_STORAGE, { create: true });
    for (const path of this.entries.keys())
      if (!path.startsWith('/tmp/')) this.entries.delete(path);
    for await (const [name] of this.directory.entries()) {
      const handle = await this.directory.getFileHandle(name);
      const record = JSON.parse(await (await handle.getFile()).text()) as {
        path: string;
        mtime: number;
      };
      if (
        !record ||
        typeof record.path !== 'string' ||
        !record.path.startsWith('/') ||
        record.path.startsWith('/tmp/') ||
        typeof record.mtime !== 'number'
      ) {
        throw new Error(`Invalid FIFO record: ${name}`);
      }
      this.entries.set(record.path, { ...record, inode: new Fifo() });
    }
  }

  async create(path: string, source?: FifoEntry): Promise<void> {
    let entry: FifoEntry;
    if (source) entry = { ...source, path };
    else entry = { path, mtime: Date.now(), inode: new Fifo() };
    if (!path.startsWith('/tmp/')) {
      if (!this.directory) throw new Error('FS Core is not initialized');
      const name = await this.name(path);
      let existed = true;
      let handle: FileSystemFileHandle;
      try {
        handle = await this.directory.getFileHandle(name);
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
        existed = false;
        handle = await this.directory.getFileHandle(name, { create: true });
      }
      let writer: FileSystemWritableFileStream | undefined;
      try {
        writer = await handle.createWritable();
        await writer.write(JSON.stringify({ path, mtime: entry.mtime }));
        await writer.close();
      } catch (error) {
        const failures = [error];
        if (writer) {
          try {
            await writer.abort();
          } catch (abortError) {
            failures.push(abortError);
          }
        }
        if (!existed) {
          try {
            await this.directory.removeEntry(name);
          } catch (cleanupError) {
            failures.push(cleanupError);
          }
        }
        if (failures.length > 1)
          throw new AggregateError(failures, `Failed to persist FIFO ${path}`);
        throw error;
      }
    }
    this.entries.set(path, entry);
  }

  async remove(path: string): Promise<void> {
    if (!path.startsWith('/tmp/')) {
      if (!this.directory) throw new Error('FS Core is not initialized');
      await this.directory.removeEntry(await this.name(path));
    }
    this.entries.delete(path);
  }

  async replace(
    path: string,
    source: FifoEntry,
    ordinary: boolean,
    remove: () => Promise<void>
  ): Promise<void> {
    await this.create(path, source);
    if (!ordinary) return;
    try {
      await remove();
    } catch (error) {
      try {
        await this.remove(path);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `Failed to replace ${path}`);
      }
      throw error;
    }
  }

  async removeTree(path: string): Promise<void> {
    for (const entry of this.entries.keys()) {
      if (entry === path || entry.startsWith(`${path}/`)) await this.remove(entry);
    }
  }

  private async name(path: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
}

export interface FifoEndpoint {
  id: string;
  ownerId: string;
  path: string;
  descriptorPath: string;
  mode: FifoMode;
  nonblocking: boolean;
  opened: boolean;
  closed: boolean;
  inode?: Fifo;
  waiters: Set<() => void>;
}

export interface FifoReference {
  kind: 'fifo';
  inode: Fifo;
  opened: boolean;
}

export type FileReference = FifoReference | { kind: 'null' };

/** An inode outlives its directory entry while an endpoint still refers to it. */
export class Fifo {
  private buffer: Uint8Array | null = null;
  private readonly endpoints = new Set<FifoEndpoint>();
  private start = 0;
  private length = 0;

  attach(endpoint: FifoEndpoint, opened = false): void {
    if (endpoint.closed) throw new FSError('EINTR', endpoint.path);
    endpoint.inode = this;
    this.endpoints.add(endpoint);
    endpoint.opened = opened;
    if (!opened && endpoint.nonblocking && endpoint.mode === 'write' && !this.hasReaders()) {
      this.endpoints.delete(endpoint);
      throw new FSError('ENXIO', endpoint.path);
    }
    this.notify();
  }

  async open(endpoint: FifoEndpoint): Promise<void> {
    while (!endpoint.opened) {
      this.active(endpoint);
      await this.wait(endpoint);
    }
    this.active(endpoint);
  }

  async read(endpoint: FifoEndpoint, maxBytes: number): Promise<Uint8Array> {
    if (!Number.isInteger(maxBytes) || maxBytes < 0) throw new FSError('EINVAL', endpoint.path);
    this.readable(endpoint);
    if (maxBytes === 0) return new Uint8Array();
    for (;;) {
      this.readable(endpoint);
      if (this.length > 0) {
        const count = Math.min(maxBytes, this.length);
        const data = new Uint8Array(count);
        const first = Math.min(count, CAPACITY - this.start);
        data.set(this.buffer!.subarray(this.start, this.start + first));
        data.set(this.buffer!.subarray(0, count - first), first);
        this.start = (this.start + count) % CAPACITY;
        this.length -= count;
        this.notify();
        return data;
      }
      if (!this.hasWriters()) return new Uint8Array();
      if (endpoint.nonblocking) throw new FSError('EAGAIN', endpoint.path);
      await this.wait(endpoint);
    }
  }

  async write(endpoint: FifoEndpoint, bytes: Uint8Array): Promise<number> {
    this.writable(endpoint);
    if (bytes.length === 0) return 0;
    const data = bytes.subarray(0, CAPACITY).slice();
    for (;;) {
      this.writable(endpoint);
      if (!this.hasReaders()) throw new FSError('EPIPE', endpoint.path);
      const free = CAPACITY - this.length;
      if (free > 0 && (data.length > PIPE_BUF || free >= data.length)) {
        const count = Math.min(free, data.length);
        const end = (this.start + this.length) % CAPACITY;
        const first = Math.min(count, CAPACITY - end);
        if (!this.buffer) this.buffer = new Uint8Array(CAPACITY);
        this.buffer.set(data.subarray(0, first), end);
        this.buffer.set(data.subarray(first, count), 0);
        this.length += count;
        this.notify();
        return count;
      }
      if (endpoint.nonblocking) throw new FSError('EAGAIN', endpoint.path);
      await this.wait(endpoint);
    }
  }

  close(endpoint: FifoEndpoint): void {
    endpoint.closed = true;
    this.endpoints.delete(endpoint);
    this.wake(endpoint);
    if (this.endpoints.size === 0) {
      this.start = 0;
      this.length = 0;
      this.buffer = null;
    }
    this.notify();
  }

  private active(endpoint: FifoEndpoint): void {
    if (endpoint.closed) throw new FSError('EINTR', endpoint.path);
  }

  private readable(endpoint: FifoEndpoint): void {
    this.active(endpoint);
    if (!endpoint.opened || endpoint.mode === 'write') throw new FSError('EBADF', endpoint.path);
  }

  private writable(endpoint: FifoEndpoint): void {
    this.active(endpoint);
    if (!endpoint.opened || endpoint.mode === 'read') throw new FSError('EBADF', endpoint.path);
  }

  private hasReaders(): boolean {
    for (const endpoint of this.endpoints) if (endpoint.mode !== 'write') return true;
    return false;
  }

  private hasWriters(): boolean {
    for (const endpoint of this.endpoints) if (endpoint.mode !== 'read') return true;
    return false;
  }

  private notify(): void {
    const readers = this.hasReaders();
    const writers = this.hasWriters();
    for (const endpoint of this.endpoints) {
      if (
        endpoint.mode === 'readwrite' ||
        endpoint.nonblocking ||
        (endpoint.mode === 'read' && writers) ||
        (endpoint.mode === 'write' && readers)
      ) {
        endpoint.opened = true;
      }
      this.wake(endpoint);
    }
  }

  private wake(endpoint: FifoEndpoint): void {
    for (const resolve of endpoint.waiters) resolve();
    endpoint.waiters.clear();
  }

  private wait(endpoint: FifoEndpoint): Promise<void> {
    return new Promise(resolve => endpoint.waiters.add(resolve));
  }
}

/** Reservations exist before namespace lookup, so cancellation also covers queued opens. */
export class FifoEndpoints {
  private readonly endpoints = new Map<string, FifoEndpoint>();

  constructor(private readonly descriptors: FifoDescriptors) {}

  reserve(
    path: string,
    mode: FifoMode,
    id: string,
    ownerId: string,
    options: FifoOpenOptions = {}
  ): FifoEndpoint {
    if (this.endpoints.has(id)) throw new FSError('EBUSY', path);
    if (mode !== 'read' && mode !== 'write' && mode !== 'readwrite')
      throw new FSError('EINVAL', path);
    const endpoint: FifoEndpoint = {
      id,
      ownerId,
      path,
      descriptorPath: '',
      mode,
      nonblocking: options.nonblocking === true,
      opened: false,
      closed: false,
      waiters: new Set(),
    };
    endpoint.descriptorPath = this.descriptors.allocate(endpoint);
    this.endpoints.set(id, endpoint);
    return endpoint;
  }

  async open(endpoint: FifoEndpoint): Promise<void> {
    if (endpoint.closed) throw new FSError('EINTR', endpoint.path);
    if (!endpoint.inode) throw new FSError('EINVAL', endpoint.path);
    try {
      await endpoint.inode.open(endpoint);
    } catch (error) {
      this.release(endpoint);
      throw error;
    }
  }

  read(id: string, maxBytes: number): Promise<Uint8Array> {
    const endpoint = this.get(id);
    return endpoint.inode!.read(endpoint, maxBytes);
  }

  write(id: string, bytes: Uint8Array): Promise<number> {
    const endpoint = this.get(id);
    return endpoint.inode!.write(endpoint, bytes);
  }

  close(id: string): void {
    const endpoint = this.endpoints.get(id);
    if (!endpoint) return;
    endpoint.closed = true;
    endpoint.inode?.close(endpoint);
    this.descriptors.release(endpoint);
    this.endpoints.delete(id);
  }

  closeOwner(ownerId: string): void {
    for (const endpoint of this.endpoints.values()) {
      if (endpoint.ownerId === ownerId) this.close(endpoint.id);
    }
  }

  release(endpoint: FifoEndpoint): void {
    if (this.endpoints.get(endpoint.id) === endpoint) this.close(endpoint.id);
  }

  descriptorPath(id: string): string {
    return this.get(id).descriptorPath;
  }

  createPipe(readOwnerId: string, writeOwnerId: string): PipePaths {
    const inode = new Fifo();
    const reader = this.reserve('', 'read', crypto.randomUUID(), readOwnerId);
    const writer = this.reserve('', 'write', crypto.randomUUID(), writeOwnerId);
    reader.path = reader.descriptorPath;
    writer.path = writer.descriptorPath;
    inode.attach(reader, true);
    inode.attach(writer, true);
    return { readPath: reader.descriptorPath, writePath: writer.descriptorPath };
  }

  async readFile(endpoint: FifoEndpoint): Promise<Uint8Array> {
    try {
      await this.open(endpoint);
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const chunk = await endpoint.inode!.read(endpoint, CAPACITY);
        if (chunk.length === 0) break;
        chunks.push(chunk);
        length += chunk.length;
      }
      const data = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
      }
      return data;
    } finally {
      this.release(endpoint);
    }
  }

  async writeFile(endpoint: FifoEndpoint, content: string | Uint8Array): Promise<void> {
    try {
      await this.open(endpoint);
      let data: Uint8Array;
      if (typeof content === 'string') data = new TextEncoder().encode(content);
      else data = content;
      let offset = 0;
      while (offset < data.length)
        offset += await endpoint.inode!.write(endpoint, data.subarray(offset));
    } finally {
      this.release(endpoint);
    }
  }

  private get(id: string): FifoEndpoint {
    const endpoint = this.endpoints.get(id);
    if (!endpoint?.inode || !endpoint.opened) throw new FSError('EBADF', id);
    return endpoint;
  }
}

/** Namespace leases cover lookup and registration, never rendezvous or byte transfers. */
export class FifoService {
  readonly descriptors = new FifoDescriptors();
  private readonly endpoints = new FifoEndpoints(this.descriptors);

  constructor(
    private readonly namespace: NamespaceLock,
    private readonly entries: FifoEntries,
    private readonly resolve: (path: string, required?: boolean) => Promise<string>,
    private readonly create: (path: string) => Promise<void>
  ) {}

  mkfifo(path: string): Promise<void> {
    return this.namespace.exclusive(() => this.create(path));
  }

  async openFifo(
    path: string,
    mode: FifoMode,
    id: string,
    ownerId: string,
    options?: FifoOpenOptions
  ): Promise<void> {
    const endpoint = this.endpoints.reserve(path, mode, id, ownerId, options);
    try {
      await this.namespace.shared(async () => {
        const reference = await this.lookup(path, true);
        if (reference?.kind !== 'fifo') throw new FSError('EINVAL', path);
        reference.inode.attach(endpoint, reference.opened);
      });
      await this.endpoints.open(endpoint);
    } catch (error) {
      const interrupted = endpoint.closed;
      this.endpoints.release(endpoint);
      if (interrupted) throw new FSError('EINTR', path);
      throw error;
    }
  }

  async readFifo(id: string, maxBytes: number): Promise<Uint8Array> {
    return this.endpoints.read(id, maxBytes);
  }

  async writeFifo(id: string, bytes: Uint8Array): Promise<number> {
    return this.endpoints.write(id, bytes);
  }

  async closeFifo(id: string): Promise<void> {
    this.endpoints.close(id);
  }

  async closeFifos(ownerId: string): Promise<void> {
    this.endpoints.closeOwner(ownerId);
  }

  async createPipe(readOwnerId: string, writeOwnerId: string): Promise<PipePaths> {
    return this.endpoints.createPipe(readOwnerId, writeOwnerId);
  }

  async getDescriptorPath(endpointId: string): Promise<string> {
    return this.endpoints.descriptorPath(endpointId);
  }

  private async lookup(path: string, required = false): Promise<FileReference | undefined> {
    const resolved = await this.resolve(path, required);
    const descriptor = this.descriptors.lookup(resolved);
    if (descriptor) return descriptor;
    const entry = this.entries.entries.get(resolved);
    if (entry) return { kind: 'fifo', inode: entry.inode, opened: false };
  }

  readFile(path: string, ownerId: string, regular: () => Promise<Uint8Array>): Promise<Uint8Array> {
    return this.withFile(
      path,
      'read',
      ownerId,
      regular,
      endpoint => this.endpoints.readFile(endpoint),
      async () => new Uint8Array()
    );
  }

  writeFile(
    path: string,
    data: string | Uint8Array,
    ownerId: string,
    regular: () => Promise<void>
  ): Promise<void> {
    return this.withFile(
      path,
      'write',
      ownerId,
      regular,
      endpoint => this.endpoints.writeFile(endpoint, data),
      async () => {}
    );
  }

  private async withFile<T>(
    path: string,
    mode: FifoMode,
    ownerId: string,
    regular: () => Promise<T>,
    transfer: (endpoint: FifoEndpoint) => Promise<T>,
    device: () => Promise<T>
  ): Promise<T> {
    const endpoint = this.endpoints.reserve(path, mode, crypto.randomUUID(), ownerId);
    try {
      const result = await this.namespace.shared(
        async (): Promise<{ value: T } | { endpoint: FifoEndpoint }> => {
          const reference = await this.lookup(path).catch(error => {
            if (endpoint.closed) throw new FSError('EINTR', path);
            throw error;
          });
          if (endpoint.closed) throw new FSError('EINTR', path);
          if (!reference) return { value: await regular() };
          if (reference.kind === 'null') return { value: await device() };
          reference.inode.attach(endpoint, reference.opened);
          return { endpoint };
        }
      );
      if ('endpoint' in result) return await transfer(result.endpoint);
      return result.value;
    } finally {
      this.endpoints.release(endpoint);
    }
  }
}
