import type { ProjectFile } from '@/types/index';

export interface FsChangeEvent {
  type: 'create' | 'update' | 'delete' | 'rename';
  path: string;
  oldPath?: string;
  file?: ProjectFile;
}

export interface MkdirOptions {
  recursive?: boolean;
  mode?: number;
}

export interface FsWriteOptions {
  mode?: number;
}

export interface RmOptions {
  recursive?: boolean;
  force?: boolean;
}

export interface FsWriteApi {
  writeRange(
    path: string,
    data: Uint8Array,
    position: number | null,
    create?: boolean,
    exclusive?: boolean,
    mode?: number
  ): Promise<number>;
}

export type FifoMode = 'read' | 'write' | 'readwrite';

export interface FifoOpenOptions {
  nonblocking?: boolean;
}

export interface PipePaths {
  readPath: string;
  writePath: string;
}

export interface FsFifoApi {
  createPipe(readOwnerId: string, writeOwnerId: string): Promise<PipePaths>;
  getDescriptorPath(endpointId: string): Promise<string>;
  mkfifo(path: string): Promise<void>;
  openFifo(
    path: string,
    mode: FifoMode,
    endpointId: string,
    ownerId: string,
    options?: FifoOpenOptions
  ): Promise<void>;
  readFifo(endpointId: string, maxBytes: number): Promise<Uint8Array>;
  writeFifo(endpointId: string, bytes: Uint8Array): Promise<number>;
  closeFifo(endpointId: string): Promise<void>;
  closeFifos(ownerId: string): Promise<void>;
}

function hasFifoApi(fs: FsApi): fs is FsApi & FsFifoApi {
  if (
    'mkfifo' in fs &&
    typeof fs.mkfifo === 'function' &&
    'openFifo' in fs &&
    typeof fs.openFifo === 'function' &&
    'readFifo' in fs &&
    typeof fs.readFifo === 'function' &&
    'writeFifo' in fs &&
    typeof fs.writeFifo === 'function' &&
    'closeFifo' in fs &&
    typeof fs.closeFifo === 'function' &&
    'closeFifos' in fs &&
    typeof fs.closeFifos === 'function' &&
    'createPipe' in fs &&
    typeof fs.createPipe === 'function' &&
    'getDescriptorPath' in fs &&
    typeof fs.getDescriptorPath === 'function'
  ) {
    return true;
  }
  return false;
}

export function getFifoApi(fs: FsApi): (FsApi & FsFifoApi) | null {
  if (hasFifoApi(fs)) return fs;
  return null;
}

export interface FsApi {
  readFile(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  writeFile(path: string, data: string | Uint8Array, options?: FsWriteOptions): Promise<void>;
  readdir(path: string): Promise<ProjectFile[]>;
  stat(path: string): Promise<ProjectFile>;
  lstat(path: string): Promise<ProjectFile>;
  chmod(path: string, mode: number): Promise<void>;
  realpath(path: string): Promise<string>;
  readlink(path: string): Promise<string>;
  symlink(target: string, path: string): Promise<void>;
  mkdir(path: string, options?: MkdirOptions): Promise<void>;
  rm(path: string, options?: RmOptions): Promise<void>;
  rename(oldPath: string, newPath: string, options?: RenameOptions): Promise<void>;
  walk(root: string): Promise<ProjectFile[]>;
  exists(path: string): Promise<boolean>;
}

export interface RenameOptions {
  overwrite?: boolean;
}

export interface TranspilerDescriptor {
  readonly id: string;
  readonly supportedExtensions: string[];
  readonly workerTransform: 'typescript';
}
