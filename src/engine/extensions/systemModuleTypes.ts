import type { GitCommands } from '@/engine/cmd/global/git';
import type { NpmCommands } from '@/engine/cmd/global/npm';
import type { UnixCommands } from '@/engine/cmd/global/unix';
import type { StreamShell } from '@/engine/cmd/shell/streamShell';
import type { FsClient } from '@/engine/core/fs/client';
import type { FsChangeEvent } from '@/engine/core/fs/types';
import type {
  basename,
  getParentPath,
  isPathWithin,
  normalizePath,
  posixPath,
  resolvePath,
} from '@/engine/core/pathUtils';
import type {
  createUrlWorkerPool,
  createWorkerPool,
  WorkerPool,
} from '@/engine/workers/WorkerPool';
import type { CommandRegistry } from './commandRegistry';

export interface WorkerRuntimeModule {
  WorkerPool: typeof WorkerPool;
  createWorkerPool: typeof createWorkerPool;
  createUrlWorkerPool: typeof createUrlWorkerPool;
}

export type FsClientApi = Pick<
  FsClient,
  | 'readFile'
  | 'readText'
  | 'writeFile'
  | 'readdir'
  | 'stat'
  | 'mkdir'
  | 'rm'
  | 'rename'
  | 'walk'
  | 'exists'
  | 'addChangeListener'
>;

export interface PathUtilsModule {
  posixPath: typeof posixPath;
  normalizePath: typeof normalizePath;
  resolvePath: typeof resolvePath;
  getParentPath: typeof getParentPath;
  basename: typeof basename;
  isPathWithin: typeof isPathWithin;
}

export interface WorkspaceModule {
  getRootPath(): string | null;
  subscribe(listener: (rootPath: string | null) => void): () => void;
}

export interface SystemModuleMap {
  fsClient: FsClientApi;
  workerRuntime: WorkerRuntimeModule;
  pathUtils: PathUtilsModule;
  workspace: WorkspaceModule;
  commandRegistry: CommandRegistry;
  systemBuiltinCommands: {
    getUnixCommands: (rootPath: string) => UnixCommands;
    getGitCommands: (rootPath: string) => GitCommands;
    getNpmCommands: (rootPath: string) => Promise<NpmCommands>;
    getShell: (
      rootPath: string,
      opts?: { unix?: UnixCommands; commandRegistry?: CommandRegistry; fsClient?: FsClientApi }
    ) => Promise<StreamShell>;
  };
}

export type SystemModuleName = keyof SystemModuleMap;
export type SystemModuleType<T extends SystemModuleName> = SystemModuleMap[T];
export type GetSystemModule = <T extends SystemModuleName>(
  moduleName: T
) => Promise<SystemModuleMap[T]>;
export type FsChangeListener = (event: FsChangeEvent) => void;
