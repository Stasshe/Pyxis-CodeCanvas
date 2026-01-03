/**
 * Execution Context
 * Encapsulates all state needed for command execution.
 * Follows POSIX shell conventions for environment and state management.
 */

import type {
  ForkOptions,
  GetSystemModule,
  IExecutionContext,
  ShellFunction,
  ShellOptions,
} from '../providers/types';

/**
 * Create default shell options
 */
function createDefaultShellOptions(isInteractive: boolean): ShellOptions {
  return {
    errexit: false,
    nounset: false,
    xtrace: false,
    pipefail: false,
    interactive: isInteractive,
    login: false,
  };
}

/**
 * Execution Context Implementation
 */
export class ExecutionContext implements IExecutionContext {
  // Project information
  readonly projectName: string;
  readonly projectId: string;

  // Working directory
  private _cwd: string;

  // Environment variables
  private _env: Record<string, string>;

  // Shell state
  private _aliases: Map<string, string>;
  private _functions: Map<string, ShellFunction>;

  // Special variables
  private _exitCode: number;
  private _shellPid: number;
  private _lastBgPid: number;

  // Positional parameters
  private _positionalParams: string[];

  // Shell options
  private _options: ShellOptions;

  // Context metadata
  readonly isInteractive: boolean;
  readonly parentPid?: number;

  // Terminal dimensions
  private _terminalColumns: number;
  private _terminalRows: number;

  // System module access
  private _getSystemModule: GetSystemModule;

  constructor(
    projectName: string,
    projectId: string,
    getSystemModule: GetSystemModule,
    options: {
      isInteractive?: boolean;
      parentPid?: number;
      cwd?: string;
      env?: Record<string, string>;
      terminalColumns?: number;
      terminalRows?: number;
    } = {}
  ) {
    this.projectName = projectName;
    this.projectId = projectId;
    this._getSystemModule = getSystemModule;

    this.isInteractive = options.isInteractive ?? false;
    this.parentPid = options.parentPid;

    // Initialize shell PID
    this._shellPid = Math.floor(Math.random() * 32768) + 1;

    // Initialize working directory
    this._cwd = options.cwd ?? `/projects/${projectName}`;

    // Initialize environment variables
    this._env = options.env ?? {
      PATH: '/bin:/usr/bin:/usr/local/bin',
      HOME: `/projects/${projectName}`,
      PWD: this._cwd,
      OLDPWD: this._cwd,
      SHELL: '/bin/pyxis-shell',
      USER: 'pyxis-user',
      TERM: 'xterm-256color',
      LANG: 'en_US.UTF-8',
      SHLVL: '1',
    };

    // Initialize shell state
    this._aliases = new Map();
    this._functions = new Map();

    // Initialize special variables
    this._exitCode = 0;
    this._lastBgPid = 0;

    // Initialize positional parameters
    this._positionalParams = [];

    // Initialize shell options
    this._options = createDefaultShellOptions(this.isInteractive);

    // Initialize terminal dimensions
    this._terminalColumns = options.terminalColumns ?? 80;
    this._terminalRows = options.terminalRows ?? 24;
  }

  // Getters and setters

  get cwd(): string {
    return this._cwd;
  }

  set cwd(value: string) {
    this._cwd = value;
  }

  get env(): Record<string, string> {
    return this._env;
  }

  set env(value: Record<string, string>) {
    this._env = value;
  }

  get aliases(): Map<string, string> {
    return this._aliases;
  }

  set aliases(value: Map<string, string>) {
    this._aliases = value;
  }

  get functions(): Map<string, ShellFunction> {
    return this._functions;
  }

  set functions(value: Map<string, ShellFunction>) {
    this._functions = value;
  }

  get exitCode(): number {
    return this._exitCode;
  }

  set exitCode(value: number) {
    this._exitCode = value;
  }

  get shellPid(): number {
    return this._shellPid;
  }

  set shellPid(value: number) {
    this._shellPid = value;
  }

  get lastBgPid(): number {
    return this._lastBgPid;
  }

  set lastBgPid(value: number) {
    this._lastBgPid = value;
  }

  get positionalParams(): string[] {
    return this._positionalParams;
  }

  set positionalParams(value: string[]) {
    this._positionalParams = value;
  }

  get options(): ShellOptions {
    return this._options;
  }

  set options(value: ShellOptions) {
    this._options = value;
  }

  get terminalColumns(): number {
    return this._terminalColumns;
  }

  set terminalColumns(value: number) {
    this._terminalColumns = value;
  }

  get terminalRows(): number {
    return this._terminalRows;
  }

  set terminalRows(value: number) {
    this._terminalRows = value;
  }

  get getSystemModule(): GetSystemModule {
    return this._getSystemModule;
  }

  // Methods

  setCwd(path: string): void {
    this._env.OLDPWD = this._env.PWD || this._cwd;
    this._env.PWD = path;
    this._cwd = path;
  }

  setEnv(key: string, value: string): void {
    this._env[key] = value;
  }

  getEnv(key: string): string | undefined {
    return this._env[key];
  }

  setAlias(name: string, expansion: string): void {
    this._aliases.set(name, expansion);
  }

  getAlias(name: string): string | undefined {
    return this._aliases.get(name);
  }

  removeAlias(name: string): boolean {
    return this._aliases.delete(name);
  }

  setFunction(name: string, func: ShellFunction): void {
    this._functions.set(name, func);
  }

  getFunction(name: string): ShellFunction | undefined {
    return this._functions.get(name);
  }

  removeFunction(name: string): boolean {
    return this._functions.delete(name);
  }

  setPositionalParams(params: string[]): void {
    this._positionalParams = params;
  }

  getPositionalParam(index: number): string | undefined {
    return this._positionalParams[index];
  }

  /**
   * Create a child context (for subshells/scripts)
   */
  fork(forkOptions?: ForkOptions): IExecutionContext {
    const opts: Required<ForkOptions> = {
      interactive: false,
      copyAliases: true,
      copyFunctions: true,
      copyExports: true,
      newShellPid: true,
      ...forkOptions,
    };

    // Create new context
    const child = new ExecutionContext(
      this.projectName,
      this.projectId,
      this._getSystemModule,
      {
        isInteractive: opts.interactive,
        parentPid: this._shellPid,
        cwd: this._cwd,
        terminalColumns: this._terminalColumns,
        terminalRows: this._terminalRows,
      }
    );

    // Copy environment variables (shallow copy for isolation)
    child._env = { ...this._env };
    child._env.PWD = this._cwd;

    // Optionally copy aliases
    if (opts.copyAliases) {
      child._aliases = new Map(this._aliases);
    }

    // Optionally copy functions
    if (opts.copyFunctions) {
      child._functions = new Map(this._functions);
    }

    // Handle shell PID
    if (!opts.newShellPid) {
      child._shellPid = this._shellPid;
    }

    // Increment SHLVL
    const shlvl = Number.parseInt(this._env.SHLVL || '1', 10);
    child._env.SHLVL = String(shlvl + 1);

    // Copy shell options
    child._options = { ...this._options, interactive: opts.interactive };

    return child;
  }

  /**
   * Update terminal dimensions
   */
  setTerminalSize(columns: number, rows: number): void {
    this._terminalColumns = columns;
    this._terminalRows = rows;
    // Update COLUMNS and LINES environment variables
    this._env.COLUMNS = String(columns);
    this._env.LINES = String(rows);
  }

  /**
   * Get all exported environment variable names
   */
  getExportedVars(): string[] {
    return Object.keys(this._env);
  }

  /**
   * Set shell option
   */
  setOption(option: keyof ShellOptions, value: boolean): void {
    this._options[option] = value;
  }

  /**
   * Get shell option
   */
  getOption(option: keyof ShellOptions): boolean {
    return this._options[option];
  }
}

/**
 * Create a new execution context
 */
export function createExecutionContext(
  projectName: string,
  projectId: string,
  getSystemModule: GetSystemModule,
  options?: {
    isInteractive?: boolean;
    parentPid?: number;
    cwd?: string;
    env?: Record<string, string>;
    terminalColumns?: number;
    terminalRows?: number;
  }
): IExecutionContext {
  return new ExecutionContext(projectName, projectId, getSystemModule, options);
}
