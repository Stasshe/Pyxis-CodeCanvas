import type { ProxyMarked } from 'comlink';
import type { ProjectFile } from '@/types';
import type { GitConflictReporter, GitCredentialProvider } from './git';
import type { SearchRequest, SearchResult } from './search';
import type {
  FsChangeEvent,
  FsFifoApi,
  MkdirOptions,
  RenameOptions,
  RmOptions,
  TranspilerDescriptor,
} from './types';

export interface FsBenchmark {
  queueMs: number;
  coreMs: number;
}

export interface GitServiceApi {
  configureCredentials(provider: GitCredentialProvider): Promise<void>;
  configureConflictReporter(reporter: GitConflictReporter): Promise<void>;
  getCurrentBranch(): Promise<string>;
  tree(): Promise<string>;
  init(): Promise<string>;
  clone(url: string, targetDir?: string, options?: { maxGitObjects?: number }): Promise<string>;
  status(): Promise<string>;
  add(filepath: string): Promise<string>;
  commit(message: string, author?: { name: string; email: string }): Promise<string>;
  reset(options?: { filepath?: string; hard?: boolean; commit?: string }): Promise<string>;
  log(depth?: number): Promise<string>;
  getFormattedLog(
    depth?: number,
    branchFilter?: { mode: 'auto' | 'all'; branches?: string[] }
  ): Promise<string>;
  getAvailableBranches(): Promise<{ local: string[]; remote: string[] }>;
  checkout(branchName: string, createNew?: boolean): Promise<string>;
  checkoutRemote(remoteBranch: string): Promise<string>;
  revert(commitHash: string): Promise<string>;
  switch(targetRef: string, options?: { createNew?: boolean; detach?: boolean }): Promise<string>;
  branch(
    branchName?: string,
    options?: { delete?: boolean; remote?: boolean; all?: boolean }
  ): Promise<string>;
  diff(options?: {
    staged?: boolean;
    filepath?: string;
    commit1?: string;
    commit2?: string;
    branchName?: string;
  }): Promise<string>;
  diffCommits(commit1: string, commit2: string, filepath?: string): Promise<string>;
  merge(
    branchName: string,
    options?: { noFf?: boolean; message?: string; abort?: boolean }
  ): Promise<string>;
  discardChanges(filepath: string): Promise<string>;
  getFileContentAtCommit(commitId: string, filePath: string): Promise<Uint8Array>;
  getParentCommitIds(commitId: string): Promise<string[]>;
  getStagedFileContent(filePath: string): Promise<Uint8Array | null>;
  getHeadFileContent(filePath: string): Promise<Uint8Array | null>;
  push(
    options?: { remote?: string; branch?: string; force?: boolean },
    progress?: (message: string) => void
  ): Promise<string>;
  addRemote(remote: string, url: string): Promise<string>;
  listRemotes(): Promise<string>;
  deleteRemote(remote: string): Promise<string>;
  fetch(
    options?:
      | { remote?: string; branch?: string; depth?: number; prune?: boolean; tags?: boolean }
      | string[]
  ): Promise<string>;
  fetchAll(options?: { depth?: number; prune?: boolean; tags?: boolean }): Promise<string>;
  listRemoteBranches(remote?: string): Promise<string[]>;
  listRemoteTags(): Promise<string[]>;
  pull(options?: { remote?: string; branch?: string; rebase?: boolean }): Promise<string>;
  show(args: string[]): Promise<string | Uint8Array>;
}

export type InstallProgressCallback = (
  packageName: string,
  version: string,
  isDirect: boolean
) => Promise<void> | void;

export interface NpmServiceApi {
  install(
    packageName?: string,
    flags?: string[],
    onProgress?: InstallProgressCallback
  ): Promise<string>;
  installPackages(
    packages: { name: string; version?: string }[],
    flags?: string[],
    onProgress?: InstallProgressCallback
  ): Promise<string>;
  uninstall(packageName: string): Promise<string>;
  list(projectName: string): Promise<string>;
  init(force: boolean | undefined, projectName: string): Promise<string>;
}

/** Transport contract implemented by the filesystem worker composition root. */
export interface FsWorkerApi extends FsFifoApi {
  init(onChange: (event: FsChangeEvent) => void): Promise<void>;
  readFile(path: string, benchmark?: FsBenchmark, ownerId?: string): Promise<Uint8Array>;
  readText(path: string, ownerId?: string): Promise<string>;
  writeFile(
    path: string,
    data: string | Uint8Array,
    benchmark?: FsBenchmark,
    ownerId?: string,
    mode?: number
  ): Promise<void>;
  writeRange(
    path: string,
    data: Uint8Array,
    position: number | null,
    create?: boolean,
    exclusive?: boolean,
    benchmark?: FsBenchmark,
    mode?: number
  ): Promise<number>;
  readdir(path: string, benchmark?: FsBenchmark): Promise<ProjectFile[]>;
  stat(path: string, benchmark?: FsBenchmark): Promise<ProjectFile>;
  lstat(path: string, benchmark?: FsBenchmark): Promise<ProjectFile>;
  realpath(path: string, benchmark?: FsBenchmark): Promise<string>;
  readlink(path: string, benchmark?: FsBenchmark): Promise<string>;
  symlink(target: string, path: string, benchmark?: FsBenchmark): Promise<void>;
  mkdir(path: string, options?: MkdirOptions, benchmark?: FsBenchmark): Promise<void>;
  chmod(path: string, mode: number, benchmark?: FsBenchmark): Promise<void>;
  rm(path: string, options?: RmOptions, benchmark?: FsBenchmark): Promise<void>;
  rename(
    oldPath: string,
    newPath: string,
    benchmark?: FsBenchmark,
    options?: RenameOptions
  ): Promise<void>;
  walk(root: string): Promise<ProjectFile[]>;
  exists(path: string): Promise<boolean>;
  createWorkspace(name: string): Promise<string>;
  ensureDemoWorkspace(): Promise<string>;
  configureTranspilers(descriptors: TranspilerDescriptor[]): void;
  search(root: string, request: SearchRequest): Promise<SearchResult[]>;
  createRuntimePort(): MessagePort;
  getGit(root: string): GitServiceApi & ProxyMarked;
  getNpm(rootPath: string): NpmServiceApi & ProxyMarked;
}
