import { FSError } from './errors';
import type {
  FifoMode,
  FifoOpenOptions,
  FsApi,
  FsFifoApi,
  FsWriteApi,
  RenameOptions,
} from './types';

export interface OwnerAwareFsApi extends FsApi, FsFifoApi, FsWriteApi {
  readFile(path: string, ownerId?: string, signal?: AbortSignal): Promise<Uint8Array>;
  readText(path: string, ownerId?: string, signal?: AbortSignal): Promise<string>;
  writeFile(
    path: string,
    data: string | Uint8Array,
    ownerId?: string,
    signal?: AbortSignal
  ): Promise<void>;
  openFifo(
    path: string,
    mode: FifoMode,
    endpointId: string,
    ownerId: string,
    options?: FifoOpenOptions,
    signal?: AbortSignal
  ): Promise<void>;
}

export interface ScopedFsApi extends OwnerAwareFsApi {
  scoped(ownerId: string): ScopedFsApi;
}

export function scopedFs(source: OwnerAwareFsApi, ownerId: string): ScopedFsApi {
  const controller = new AbortController();
  const assertOpen = (path: string) => {
    if (controller.signal.aborted) throw new FSError('EINTR', path);
  };

  return {
    scoped: nextOwnerId => scopedFs(source, nextOwnerId),
    readFile: async path => {
      assertOpen(path);
      return source.readFile(path, ownerId, controller.signal);
    },
    readText: async path => {
      assertOpen(path);
      return source.readText(path, ownerId, controller.signal);
    },
    writeFile: async (path, data) => {
      assertOpen(path);
      return source.writeFile(path, data, ownerId, controller.signal);
    },
    writeRange: (path, data, position, create, exclusive) =>
      source.writeRange(path, data, position, create, exclusive),
    readdir: path => source.readdir(path),
    stat: path => source.stat(path),
    lstat: path => source.lstat(path),
    realpath: path => source.realpath(path),
    readlink: path => source.readlink(path),
    symlink: (target, path) => source.symlink(target, path),
    mkdir: (path, options) => source.mkdir(path, options),
    rm: (path, options) => source.rm(path, options),
    rename: (oldPath, path, options?: RenameOptions) => source.rename(oldPath, path, options),
    walk: path => source.walk(path),
    exists: path => source.exists(path),
    createPipe: (readOwnerId, writeOwnerId) => source.createPipe(readOwnerId, writeOwnerId),
    getDescriptorPath: endpointId => source.getDescriptorPath(endpointId),
    mkfifo: path => source.mkfifo(path),
    openFifo: async (path, mode, endpointId, endpointOwnerId, options) => {
      let signal: AbortSignal | undefined;
      if (endpointOwnerId === ownerId) signal = controller.signal;
      if (signal?.aborted) throw new FSError('EINTR', path);
      return source.openFifo(path, mode, endpointId, endpointOwnerId, options, signal);
    },
    readFifo: (endpointId, maxBytes) => source.readFifo(endpointId, maxBytes),
    writeFifo: (endpointId, bytes) => source.writeFifo(endpointId, bytes),
    closeFifo: endpointId => source.closeFifo(endpointId),
    closeFifos: endpointOwnerId => {
      if (endpointOwnerId === ownerId && !controller.signal.aborted) controller.abort();
      return source.closeFifos(endpointOwnerId);
    },
  };
}
