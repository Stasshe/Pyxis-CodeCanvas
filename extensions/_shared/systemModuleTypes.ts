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
 * StreamShell - extension-facing minimal stream-shell interface
 * This is intentionally a lightweight, self-contained description so
 * extension code can interact with a shell instance without importing
 * engine internals from `src/`.
 */
export interface StreamShell {
  /**
   * Execute a single command line (pipeline allowed) and return collected
   * stdout/stderr and exit code. Mirrors StreamShell.run(...) behavior.
   */
  run(line: string): Promise<{ stdout: string; stderr: string; code: number | null }>;

  /** Kill the current foreground process (if any) with an optional signal. */
  killForeground?(signal?: string): void;

  /** Optional helpers to inspect the shell's project context. */
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
