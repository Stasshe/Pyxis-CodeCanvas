import * as Comlink from 'comlink';
import type { TranspilerDescriptor } from '@/engine/core/fs/types';
import type { ProjectFile } from '@/types/index';
import { FSError, registerFsErrors } from './errors';
import type { FsWorkerApi } from './protocol';
import { type ScopedFsApi, scopedFs } from './scoped';
import type { SearchRequest, SearchResult } from './search';
import type {
  FifoMode,
  FifoOpenOptions,
  FsApi,
  FsChangeEvent,
  FsFifoApi,
  FsWriteApi,
  FsWriteOptions,
  MkdirOptions,
  PipePaths,
  RenameOptions,
  RmOptions,
} from './types';

registerFsErrors();

export class FsClient implements FsApi, FsFifoApi, FsWriteApi {
  private worker: Worker | null = null;
  private remote: Comlink.Remote<FsWorkerApi> | null = null;
  private initialization: Promise<void> | null = null;
  private listeners = new Set<(event: FsChangeEvent) => void>();
  private releaseLock: (() => void) | null = null;

  init(): Promise<void> {
    if (!this.initialization) this.initialization = this.initialize();
    return this.initialization;
  }

  private async initialize(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      navigator.locks
        .request('pyxis-fs-owner', { ifAvailable: true }, async lock => {
          if (!lock) {
            reject(
              new Error('Pyxis is already open in another tab. Close that tab before continuing.')
            );
            return;
          }
          await new Promise<void>(release => {
            this.releaseLock = release;
            resolve();
          });
        })
        .catch(reject);
    });
    try {
      this.worker = new Worker(new URL('../../system/runtime/fs/worker.ts', import.meta.url), {
        type: 'module',
      });
      this.remote = Comlink.wrap<FsWorkerApi>(this.worker);
      await this.remote.init(
        Comlink.proxy((event: FsChangeEvent) => {
          for (const listener of this.listeners) {
            try {
              listener(event);
            } catch (error) {
              console.error('Filesystem change listener failed', error);
            }
          }
        })
      );
    } catch (error) {
      this.close();
      throw error;
    }
  }

  private async api(): Promise<Comlink.Remote<FsWorkerApi>> {
    await this.init();
    if (!this.remote) throw new Error('Filesystem worker is closed.');
    return this.remote;
  }

  scoped(ownerId: string): ScopedFsApi {
    return scopedFs(this, ownerId);
  }

  async readFile(path: string, ownerId?: string, signal?: AbortSignal): Promise<Uint8Array> {
    const api = await this.api();
    if (signal?.aborted) throw new FSError('EINTR', path);
    return api.readFile(path, undefined, ownerId);
  }
  async readText(path: string, ownerId?: string, signal?: AbortSignal): Promise<string> {
    const api = await this.api();
    if (signal?.aborted) throw new FSError('EINTR', path);
    return api.readText(path, ownerId);
  }
  async writeFile(
    path: string,
    data: string | Uint8Array,
    options?: FsWriteOptions,
    ownerId?: string,
    signal?: AbortSignal
  ): Promise<void> {
    const api = await this.api();
    if (signal?.aborted) throw new FSError('EINTR', path);
    await api.writeFile(path, data, undefined, ownerId, options?.mode);
  }
  async mkfifo(path: string): Promise<void> {
    await (await this.api()).mkfifo(path);
  }
  async createPipe(readOwnerId: string, writeOwnerId: string): Promise<PipePaths> {
    return (await this.api()).createPipe(readOwnerId, writeOwnerId);
  }
  async getDescriptorPath(endpointId: string): Promise<string> {
    return (await this.api()).getDescriptorPath(endpointId);
  }
  async openFifo(
    path: string,
    mode: FifoMode,
    endpointId: string,
    ownerId: string,
    options?: FifoOpenOptions,
    signal?: AbortSignal
  ): Promise<void> {
    const api = await this.api();
    if (signal?.aborted) throw new FSError('EINTR', path);
    await api.openFifo(path, mode, endpointId, ownerId, options);
  }
  async readFifo(endpointId: string, maxBytes: number): Promise<Uint8Array> {
    return (await this.api()).readFifo(endpointId, maxBytes);
  }
  async writeFifo(endpointId: string, bytes: Uint8Array): Promise<number> {
    return (await this.api()).writeFifo(endpointId, bytes);
  }
  async closeFifo(endpointId: string): Promise<void> {
    await (await this.api()).closeFifo(endpointId);
  }
  async closeFifos(ownerId: string): Promise<void> {
    await (await this.api()).closeFifos(ownerId);
  }
  async writeRange(
    path: string,
    data: Uint8Array,
    position: number | null,
    create = false,
    exclusive = false,
    mode?: number
  ): Promise<number> {
    return (await this.api()).writeRange(path, data, position, create, exclusive, undefined, mode);
  }
  async readdir(path: string): Promise<ProjectFile[]> {
    return (await this.api()).readdir(path);
  }
  async stat(path: string): Promise<ProjectFile> {
    return (await this.api()).stat(path);
  }
  async lstat(path: string): Promise<ProjectFile> {
    return (await this.api()).lstat(path);
  }
  async realpath(path: string): Promise<string> {
    return (await this.api()).realpath(path);
  }
  async readlink(path: string): Promise<string> {
    return (await this.api()).readlink(path);
  }
  async symlink(target: string, path: string): Promise<void> {
    await (await this.api()).symlink(target, path);
  }
  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    await (await this.api()).mkdir(path, options);
  }
  async chmod(path: string, mode: number): Promise<void> {
    await (await this.api()).chmod(path, mode);
  }
  async rm(path: string, options?: RmOptions): Promise<void> {
    await (await this.api()).rm(path, options);
  }
  async rename(oldPath: string, newPath: string, options?: RenameOptions): Promise<void> {
    await (await this.api()).rename(oldPath, newPath, undefined, options);
  }
  async walk(root: string): Promise<ProjectFile[]> {
    return (await this.api()).walk(root);
  }
  async exists(path: string): Promise<boolean> {
    return (await this.api()).exists(path);
  }
  async createWorkspace(name: string): Promise<string> {
    return (await this.api()).createWorkspace(name);
  }

  async ensureDemoWorkspace(): Promise<string> {
    return (await this.api()).ensureDemoWorkspace();
  }

  async configureTranspilers(descriptors: TranspilerDescriptor[]): Promise<void> {
    await (await this.api()).configureTranspilers(descriptors);
  }

  async search(root: string, request: SearchRequest): Promise<SearchResult[]> {
    return (await this.api()).search(root, request);
  }

  async createRuntimePort(): Promise<MessagePort> {
    return (await this.api()).createRuntimePort();
  }

  async getNpm(rootPath: string) {
    return (await this.api()).getNpm(rootPath);
  }
  async getGit(root: string) {
    return (await this.api()).getGit(root);
  }

  addChangeListener(listener: (event: FsChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.remote?.[Comlink.releaseProxy]();
    this.worker?.terminate();
    this.releaseLock?.();
    this.remote = null;
    this.worker = null;
    this.releaseLock = null;
    this.initialization = null;
  }
}

export const fsClient = new FsClient();
