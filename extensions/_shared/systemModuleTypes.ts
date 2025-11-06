/**
 * System Module Types for Extensions (Extension-Facing)
 *
 * 拡張機能が使用するシステムモジュールの詳細な型定義
 * この型定義は、src/engine/extensions/systemModuleTypes.ts の拡張機能向けミラーです
 * 拡張機能開発時に型補完を提供するために使用します
 *
 * NOTE: This file is intentionally separate from the engine implementation
 * to maintain a stable extension-facing API surface.
 */

/**
 * FileRepository - ファイル操作API
 */
export interface FileRepository {
  // プロジェクト操作
  createProject(name: string, description?: string): Promise<any>;
  getProject(projectId: string): Promise<any | null>;
  getProjects(): Promise<any[]>;
  updateProject(projectId: string, updates: Partial<any>): Promise<void>;
  deleteProject(projectId: string): Promise<void>;

  // ファイル操作
  createFile(projectId: string, path: string, content: string, language?: string): Promise<any>;
  getFile(fileId: string): Promise<any | null>;
  getProjectFiles(projectId: string): Promise<any[]>;
  updateFileContent(fileId: string, content: string): Promise<void>;
  deleteFile(fileId: string): Promise<void>;

  // 変更リスナー
  addChangeListener(listener: (event: any) => void): () => void;
}

/**
 * normalizeCjsEsm - CommonJS/ES Module変換ユーティリティ
 */
export interface NormalizeCjsEsmModule {
  normalizeCjsEsm(code: string): string;
  extractImports(
    code: string
  ): Array<{
    source: string;
    specifiers: Array<{
      type: 'default' | 'named' | 'namespace';
      imported?: string;
      local: string;
    }>;
  }>;
  extractExports(
    code: string
  ): Array<{
    type: 'named' | 'default' | 'all';
    exported?: string;
    local?: string;
    source?: string;
  }>;
}

/**
 * コマンド実行時のコンテキスト
 * (types.tsのCommandContextと重複を避けるため、ここでは最小限の定義)
 */
export interface CommandContext {
  projectName: string;
  projectId: string;
  currentDirectory: string;
  [key: string]: any;
}

/**
 * CommandRegistry - コマンド登録・実行API
 */
export interface CommandRegistry {
  // コマンド登録
  registerCommand(
    extensionId: string,
    commandName: string,
    handler: (args: string[], context: CommandContext) => Promise<string>
  ): () => void;

  // コマンド実行
  executeCommand(commandName: string, args: string[], context: CommandContext): Promise<string>;

  // コマンド一覧取得
  getRegisteredCommands(): string[];

  // コマンド登録確認
  hasCommand(commandName: string): boolean;

  // 拡張機能のコマンドを全て削除
  unregisterExtensionCommands(extensionId: string): void;
}

/**
 * システムモジュールの型マップ
 */
// Public (extension-facing) minimal shapes for terminal command classes.
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
  clone(url: string, targetDir?: string, options?: { skipDotGit?: boolean; maxGitObjects?: number }): Promise<string>;
  add(filepath: string): Promise<string>;
  commit(message: string, author?: { name: string; email: string }): Promise<string>;
  push(options?: { remote?: string; branch?: string; force?: boolean }): Promise<string>;
  pull(options?: { remote?: string; branch?: string; rebase?: boolean }): Promise<string>;
  branch(branchName?: string, options?: { delete?: boolean; remote?: boolean; all?: boolean }): Promise<string>;
  checkout(branchName: string, createNew?: boolean): Promise<string>;
  log(depth?: number): Promise<string>;
  diff(options?: { staged?: boolean; filepath?: string; commit1?: string; commit2?: string; branchName?: string }): Promise<string>;
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

/**
 * Process exit shape returned by various shell helpers.
 */
export type ProcExit = {
  code: number | null;
  /** Signal name when process was killed, e.g. 'SIGINT' */
  signal?: string | null;
};

/**
 * Minimal readable stream-like interface used by builtins/handlers.
 * Designed to be compatible with Node.js streams but intentionally
 * small so the extension-facing API doesn't require Node types.
 */
export interface ReadableLike {
  on(event: 'data', cb: (chunk: Buffer | string) => void): this;
  on(event: 'end' | 'close', cb: () => void): this;
  on(event: 'error', cb: (err: Error) => void): this;
}

/**
 * Minimal writable stream-like interface used by builtins/handlers.
 */
export interface WritableLike {
  write(chunk: Buffer | string): boolean;
  end(): void;
  on(event: 'error', cb: (err: Error) => void): this;
}

/**
 * A handle representing a running subprocess inside the StreamShell.
 * This mirrors the engine-side Process class (stdin/stdout/stderr, pid,
 * wait(), kill()). It is exposed here so extensions that call lower-level
 * APIs (if available) can type-check against it.
 */
export interface ShellProcessHandle {
  pid: number;
  stdin: WritableLike;
  stdout: ReadableLike;
  stderr: ReadableLike;
  /**
   * Wait for the process to exit and receive final exit info.
   */
  wait(): Promise<ProcExit>;
  /** Kill the process with a signal (default: SIGINT)
   * Note: implementations may queue a 'signal' event before actually
   * resolving the wait() promise.
   */
  kill(signal?: string): void;
}

/**
 * Result returned by StreamShell.run(). Kept strict and explicit so
 * callers can rely on the exact fields produced by the engine.
 */
export interface ShellRunResult {
  stdout: string;
  stderr: string;
  /** Numeric exit code or null when process was terminated by signal */
  code: number | null;
}

/**
 * StreamShell - extension-facing, strongly-typed description.
 * This mirrors the runtime behavior implemented in the engine but
 * remains self-contained (no imports from `src/`). Keep signatures
 * conservative (don't add required runtime-only features).
 */
export interface StreamShell {
  /**
   * Execute a single command-line (can include pipelines, redirections,
   * logical operators, and script invocations). Returns collected
   * stdout/stderr and the exit code. The call resolves when the
   * pipeline completes (or times out inside the engine).
   */
  run(line: string): Promise<ShellRunResult>;

  /**
   * Kill the current foreground process (if any) with an optional signal.
   * This is a convenience that forwards to the shell's foreground process
   * handler. It MUST be safe to call even if no foreground process exists.
   */
  killForeground?(signal?: string): void;

  /**
   * If the implementation exposes low-level process handles, this method
   * will create one for the provided (already-parsed) command segment.
   * This is optional and may be undefined on some runtimes. The engine's
   * default StreamShell does not expose a public createProcess API, but
   * the type is provided for completeness.
   */
  createProcessHandle?(cmdLine: string): Promise<ShellProcessHandle>;

  /** Helpers to inspect the shell context (optional). */
  getProjectId?(): string | undefined;
  getProjectName?(): string | undefined;
}

export interface SystemModuleMap {
  fileRepository: FileRepository;
  normalizeCjsEsm: NormalizeCjsEsmModule;
  commandRegistry: CommandRegistry;
  /** Terminal/CLI commands provider exposed to extensions */
  systemBuiltinCommands: {
    getUnixCommands: (projectName: string, projectId?: string) => UnixCommandsPublic;
    getGitCommands: (projectName: string, projectId?: string) => GitCommandsPublic;
    getNpmCommands: (projectName: string, projectId?: string, projectPath?: string) => NpmCommandsPublic;
    getShell: (
      projectName: string,
      projectId?: string,
      opts?: { unix?: any; commandRegistry?: any; fileRepository?: any }
    ) => Promise<StreamShell | null>;
  };
}

/**
 * システムモジュール名
 */
export type SystemModuleName = keyof SystemModuleMap;

/**
 * 型安全なgetSystemModuleのヘルパー型
 */
export type GetSystemModule = <T extends SystemModuleName>(
  moduleName: T
) => Promise<SystemModuleMap[T]>;
