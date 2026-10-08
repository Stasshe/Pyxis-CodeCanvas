import type { ProjectFile } from '@/types';

export interface FsChangeEvent {
  type: 'create' | 'update' | 'delete' | 'rename';
  path: string;
  oldPath?: string;
  file?: ProjectFile;
}

export interface MkdirOptions {
  recursive?: boolean;
}

export interface RmOptions {
  recursive?: boolean;
  force?: boolean;
}

export interface FsApi {
  readFile(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  readdir(path: string): Promise<ProjectFile[]>;
  stat(path: string): Promise<ProjectFile>;
  lstat(path: string): Promise<ProjectFile>;
  realpath(path: string): Promise<string>;
  readlink(path: string): Promise<string>;
  symlink(target: string, path: string): Promise<void>;
  mkdir(path: string, options?: MkdirOptions): Promise<void>;
  rm(path: string, options?: RmOptions): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  walk(root: string): Promise<ProjectFile[]>;
  exists(path: string): Promise<boolean>;
}
