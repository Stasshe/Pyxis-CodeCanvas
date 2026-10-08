import * as Comlink from 'comlink';
import type { TranspilerDescriptor } from '@/engine/runtime/core/RuntimeProvider';
import type { ProjectFile } from '@/types';
import { registerFsErrors } from './errors';
import type { SearchRequest, SearchResult } from './search';
import type { FsApi, FsChangeEvent, MkdirOptions, RmOptions } from './types';
import type { FsWorkerApi } from './worker';

registerFsErrors();

export class FsClient implements FsApi {
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
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
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

  async readFile(path: string): Promise<Uint8Array> {
    return (await this.api()).readFile(path);
  }
  async readText(path: string): Promise<string> {
    return (await this.api()).readText(path);
  }
  async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    await (await this.api()).writeFile(path, data);
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
  async rm(path: string, options?: RmOptions): Promise<void> {
    await (await this.api()).rm(path, options);
  }
  async rename(oldPath: string, newPath: string): Promise<void> {
    await (await this.api()).rename(oldPath, newPath);
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

  async createPort(): Promise<MessagePort> {
    return (await this.api()).createPort();
  }

  async getNpm(rootPath: string) {
    return (await this.api()).getNpm(rootPath);
  }
  async getGit(root: string) {
    return (await this.api()).getGit(root);
  }

  getWorker(): Worker {
    if (!this.worker) throw new Error('Initialize the filesystem before accessing its worker.');
    return this.worker;
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
