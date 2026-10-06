import type { MergeConflictFileEntry } from '@/engine/tabs/types';
import { isPathWithin, normalizePath, posixPath, resolvePath } from '../pathUtils';
import { FSError } from './errors';
import type { FsApi } from './types';

export interface GitCredentials {
  username: string;
  password: string;
}

export type GitCredentialProvider = () => Promise<GitCredentials | null>;

export interface GitStat {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  mode: number;
  uid: number;
  gid: number;
  ino: number;
  dev: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface GitPromises {
  readFile(path: string): Promise<Uint8Array>;
  readFile(path: string, encoding: string | { encoding: string }): Promise<string>;
  readFile(path: string, options: { encoding?: undefined }): Promise<Uint8Array>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<GitStat>;
  lstat(path: string): Promise<GitStat>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rmdir(path: string): Promise<void>;
  unlink(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  readlink(path: string): Promise<string>;
  symlink(target: string, path: string): Promise<void>;
}

export interface GitMergeConflict {
  root: string;
  conflicts: MergeConflictFileEntry[];
  oursBranch: string;
  theirsBranch: string;
}

export type GitConflictReporter = (conflict: GitMergeConflict) => Promise<void>;

export interface GitFs {
  promises: GitPromises;
  reportMergeConflict(conflict: GitMergeConflict): Promise<void>;
  setConflictReporter(reporter: GitConflictReporter): void;
  credentials(): Promise<GitCredentials | null>;
  setCredentials(provider: GitCredentialProvider): void;
}

export function createGitFs(core: FsApi): GitFs {
  let reporter: GitConflictReporter = async () => {
    throw new Error('Merge conflict UI is unavailable');
  };
  let provider: GitCredentialProvider = async () => null;
  async function stat(path: string): Promise<GitStat> {
    const entry = await core.stat(path);
    let mode = 0o100644;
    if (entry.type === 'folder') mode = 0o40755;
    return {
      size: entry.size,
      mtimeMs: entry.mtime,
      ctimeMs: entry.mtime,
      mode,
      uid: 0,
      gid: 0,
      ino: 0,
      dev: 0,
      isFile: () => entry.type === 'file',
      isDirectory: () => entry.type === 'folder',
      isSymbolicLink: () => false,
    };
  }
  async function readFile(path: string): Promise<Uint8Array>;
  async function readFile(path: string, encoding: string | { encoding: string }): Promise<string>;
  async function readFile(path: string, options: { encoding?: undefined }): Promise<Uint8Array>;
  async function readFile(
    path: string,
    encoding?: string | { encoding?: string }
  ): Promise<string | Uint8Array> {
    let requestedEncoding: string | undefined;
    if (typeof encoding === 'string') requestedEncoding = encoding;
    if (typeof encoding === 'object') requestedEncoding = encoding.encoding;
    if (requestedEncoding) return core.readText(path);
    return core.readFile(path);
  }
  return {
    reportMergeConflict: conflict => reporter(conflict),
    setConflictReporter: next => {
      reporter = next;
    },
    credentials: () => provider(),
    setCredentials: next => {
      provider = next;
    },
    promises: {
      readFile,
      writeFile: (path, data) => core.writeFile(path, data),
      readdir: async path =>
        (await core.readdir(path)).map(entry => entry.path.slice(entry.path.lastIndexOf('/') + 1)),
      stat,
      lstat: stat,
      mkdir: (path, options) => core.mkdir(path, options),
      rmdir: async path => {
        const entries = await core.readdir(path);
        if (entries.length > 0) throw new FSError('ENOTEMPTY', path);
        await core.rm(path, { recursive: true });
      },
      unlink: path => core.rm(path),
      rename: (oldPath, newPath) => core.rename(oldPath, newPath),
      readlink: async path => {
        throw new Error(`Symbolic links are unavailable: ${path}`);
      },
      symlink: async (_target, path) => {
        throw new Error(`Symbolic links are unavailable: ${path}`);
      },
    },
  };
}

export function repositoryPath(root: string, path: string): string {
  const directory = normalizePath(root);
  const absolute = resolvePath(directory, path);
  if (absolute === directory) return '.';
  if (!isPathWithin(absolute, directory)) throw new Error(`Path is outside repository: ${path}`);
  return posixPath.relative(directory, absolute);
}
