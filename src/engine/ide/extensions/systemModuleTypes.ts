import type { FsClient } from '@/engine/core/fs/client';
import type { FsChangeEvent } from '@/engine/core/fs/types';
import type {
  basename,
  getParentPath,
  isPathWithin,
  normalizePath,
  posixPath,
  resolvePath,
} from '@/engine/core/paths';
import type { GitCommands } from '@/engine/system/commands/git/index';
import type { NpmCommands } from '@/engine/system/commands/npm/index';
import type { UnixCommands } from '@/engine/system/commands/unix/index';
import type {
  createUrlWorkerPool,
  createWorkerPool,
  WorkerPool,
} from '@/engine/system/runtime/transpiler/WorkerPool';
import type { StreamShell } from '@/engine/system/shell/streamShell';
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
  | 'lstat'
  | 'chmod'
  | 'realpath'
  | 'readlink'
  | 'symlink'
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

export interface KeybindingsModule {
  registerAction(actionId: string, callback: () => void): () => void;
}

export interface SystemModuleMap {
  fsClient: FsClientApi;
  workerRuntime: WorkerRuntimeModule;
  pathUtils: PathUtilsModule;
  workspace: WorkspaceModule;
  keybindings: KeybindingsModule;
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
