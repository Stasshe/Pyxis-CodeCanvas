/** Stable APIs available to extensions through getSystemModule. */

export interface ProjectFile {
  path: string;
  type: 'file' | 'folder';
  size: number;
  mtime: number;
}

export interface FsChangeEvent {
  type: 'create' | 'update' | 'delete' | 'rename';
  path: string;
  oldPath?: string;
  file?: ProjectFile;
}

export interface FsClient {
  readFile(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  readdir(path: string): Promise<ProjectFile[]>;
  stat(path: string): Promise<ProjectFile>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  walk(root: string): Promise<ProjectFile[]>;
  exists(path: string): Promise<boolean>;
  addChangeListener(listener: (event: FsChangeEvent) => void): () => void;
}

export interface PosixPathApi {
  normalize(path: string): string;
  resolve(...paths: string[]): string;
  join(...paths: string[]): string;
  dirname(path: string): string;
  basename(path: string, suffix?: string): string;
  extname(path: string): string;
  relative(from: string, to: string): string;
  isAbsolute(path: string): boolean;
  sep: '/';
}

export interface PathUtils {
  posixPath: PosixPathApi;
  normalizePath(path: string): string;
  resolvePath(cwd: string, ...paths: string[]): string;
  getParentPath(path: string): string;
  basename(path: string): string;
  isPathWithin(path: string, root: string): boolean;
}

export interface Workspace {
  getRootPath(): string | null;
  subscribe(listener: (rootPath: string | null) => void): () => void;
}

export interface Keybindings {
  registerAction(actionId: string, callback: () => void): () => void;
}

export type WorkerPoolCall<T extends object> = <R>(fn: (api: T) => Promise<R>) => Promise<R>;

export interface WorkerPool<T extends object> {
  call: WorkerPoolCall<T>;
  terminate(): void;
}

export interface WorkerRuntimeModule {
  createUrlWorkerPool<T extends object>(options: {
    url: string | URL;
    maxWorkers?: number;
    timeoutMs?: number;
    workerOptions?: WorkerOptions;
  }): WorkerPool<T>;
}

export interface CommandContext {
  projectName: string;
  rootPath: string;
  currentDirectory: string;
  fsClient: FsClient;
  getSystemModule: GetSystemModule;
}

export interface UnixCommandsPublic {
  pwd(): Promise<string>;
  getRelativePath(): string;
  getRelativePathFromProject(fullPath: string): string;
  normalizePath(path: string): string;
  ls(path?: string, options?: string[]): Promise<string>;
  cd(path: string, options?: string[]): Promise<string>;
  mkdir(dirName: string, recursive?: boolean): Promise<string>;
  touch(fileName: string): Promise<string>;
  rm(fileName: string, recursive?: boolean): Promise<string>;
  cat(fileName: string): Promise<string>;
  head(fileName: string, n?: number): Promise<string>;
  tail(fileName: string, n?: number): Promise<string>;
  stat(path: string): Promise<string>;
  echo(text: string): Promise<string>;
  mv(source: string, destination: string): Promise<string>;
  cp(source: string, destination: string, options?: string[]): Promise<string>;
  tree(path?: string, options?: string[]): Promise<string>;
  find(path?: string, options?: string[]): Promise<string>;
  grep(pattern: string, files: string[], options?: string[]): Promise<string>;
  help(command?: string): Promise<string>;
  unzip(zipFileName: string, destDir: string, bufferContent?: ArrayBuffer): Promise<string>;
}

export interface GitCommandsPublic {
  getCurrentBranch(): Promise<string>;
  status(): Promise<string>;
  init(): Promise<string>;
  clone(
    url: string,
    targetDir?: string,
    options?: { skipDotGit?: boolean; maxGitObjects?: number }
  ): Promise<string>;
  add(filepath: string): Promise<string>;
  commit(message: string, author?: { name: string; email: string }): Promise<string>;
  push(options?: { remote?: string; branch?: string; force?: boolean }): Promise<string>;
  pull(options?: { remote?: string; branch?: string; rebase?: boolean }): Promise<string>;
  branch(
    branchName?: string,
    options?: { delete?: boolean; remote?: boolean; all?: boolean }
  ): Promise<string>;
  checkout(branchName: string, createNew?: boolean): Promise<string>;
  log(depth?: number): Promise<string>;
  diff(options?: {
    staged?: boolean;
    filepath?: string;
    commit1?: string;
    commit2?: string;
    branchName?: string;
  }): Promise<string>;
}

export interface NpmCommandsPublic {
  downloadAndInstallPackage(packageName: string, version?: string): Promise<void>;
  removeDirectory(dirPath: string): Promise<void>;
  install(packageName?: string, flags?: string[]): Promise<string>;
  uninstall(packageName: string): Promise<string>;
  list(): Promise<string>;
  init(force?: boolean): Promise<string>;
  run(scriptName: string): Promise<string>;
}

export interface StreamShell {
  run(line: string): Promise<{ stdout: string; stderr: string; code: number | null }>;
  killForeground?(signal?: string): void;
}

export interface SystemModuleMap {
  fsClient: FsClient;
  workerRuntime: WorkerRuntimeModule;
  pathUtils: PathUtils;
  workspace: Workspace;
  keybindings: Keybindings;
  commandRegistry: CommandRegistry;
  systemBuiltinCommands: {
    getUnixCommands(rootPath: string): UnixCommandsPublic;
    getGitCommands(rootPath: string): GitCommandsPublic;
    getNpmCommands(rootPath: string): Promise<NpmCommandsPublic>;
    getShell(
      rootPath: string,
      opts?: {
        unix?: UnixCommandsPublic;
        commandRegistry?: CommandRegistry;
        fsClient?: FsClient;
      }
    ): Promise<StreamShell>;
  };
}

export type SystemModuleName = keyof SystemModuleMap;
export type GetSystemModule = <T extends SystemModuleName>(
  moduleName: T
) => Promise<SystemModuleMap[T]>;

export interface CommandRegistry {
  registerCommand(
    extensionId: string,
    commandName: string,
    handler: (args: string[], context: CommandContext) => Promise<string>
  ): () => void;
  executeCommand(commandName: string, args: string[], context: CommandContext): Promise<string>;
  getRegisteredCommands(): string[];
  hasCommand(commandName: string): boolean;
  unregisterExtensionCommands(extensionId: string): void;
}
