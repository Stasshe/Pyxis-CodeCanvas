/**
 * Command Provider Types
 * Core interfaces and types for the POSIX-compliant command execution system.
 */

import type { Readable, Writable } from 'stream';

/**
 * Provider Types - Classification of command providers
 */
export enum ProviderType {
  SPECIAL_BUILTIN = 'special-builtin', // exit, return, break, continue
  BUILTIN = 'builtin', // cd, pwd, export, echo, test
  ALIAS = 'alias', // User-defined aliases
  FUNCTION = 'function', // Shell functions
  EXTENSION = 'extension', // Extension-provided commands
  DOMAIN = 'domain', // Git, NPM, Pyxis, etc.
  EXTERNAL = 'external', // File system commands
}

/**
 * Execution Result - Returned by command execution
 */
export interface ExecutionResult {
  /** POSIX exit code (0 = success) */
  exitCode: number;
  /** Optional signal name if terminated by signal */
  signal?: string;
  /** Optional provider-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Completion Result - For tab completion
 */
export interface CompletionResult {
  /** Completion text to insert */
  text: string;
  /** Optional display text (if different from insertion) */
  display?: string;
  /** Type of completion */
  type: 'command' | 'option' | 'file' | 'variable' | 'custom';
  /** Optional description */
  description?: string;
}

/**
 * Stream Manager Interface
 * Manages stdin/stdout/stderr for command execution
 */
export interface IStreamManager {
  readonly stdin: Readable;
  readonly stdout: Writable;
  readonly stderr: Writable;
  
  /** Write to stdout */
  writeStdout(data: string | Buffer): Promise<void>;
  /** Write to stderr */
  writeStderr(data: string | Buffer): Promise<void>;
  /** End stdout stream */
  endStdout(): void;
  /** End stderr stream */
  endStderr(): void;
}

/**
 * Shell Function - User-defined shell function
 */
export interface ShellFunction {
  name: string;
  body: string;
  source: string;
}

/**
 * Shell Options - Shell behavior flags
 */
export interface ShellOptions {
  /** -e: Exit on error */
  errexit: boolean;
  /** -u: Error on undefined variables */
  nounset: boolean;
  /** -x: Print commands before execution */
  xtrace: boolean;
  /** Pipe fails if any command fails */
  pipefail: boolean;
  /** Interactive shell */
  interactive: boolean;
  /** Login shell */
  login: boolean;
}

/**
 * GetSystemModule - Function to access system modules
 */
export type GetSystemModule = <T>(moduleName: string) => Promise<T> | T;

/**
 * Execution Context Interface
 * Encapsulates all state needed for command execution
 */
export interface IExecutionContext {
  // Project information
  readonly projectName: string;
  readonly projectId: string;

  // Working directory
  cwd: string;

  // Environment variables
  env: Record<string, string>;

  // Shell state
  aliases: Map<string, string>;
  functions: Map<string, ShellFunction>;

  // Special variables
  exitCode: number; // $? - Last exit code
  shellPid: number; // $$ - Shell process ID
  lastBgPid: number; // $! - Last background process ID

  // Positional parameters ($0, $1, $2, etc.)
  positionalParams: string[];

  // Shell options
  options: ShellOptions;

  // Context metadata
  readonly isInteractive: boolean;
  readonly parentPid?: number;

  // Terminal dimensions
  terminalColumns: number;
  terminalRows: number;

  // System module access
  getSystemModule: GetSystemModule;

  // Methods
  setCwd(path: string): void;
  setEnv(key: string, value: string): void;
  getEnv(key: string): string | undefined;
  setAlias(name: string, expansion: string): void;
  getAlias(name: string): string | undefined;
  removeAlias(name: string): boolean;
  setFunction(name: string, func: ShellFunction): void;
  getFunction(name: string): ShellFunction | undefined;
  removeFunction(name: string): boolean;
  setPositionalParams(params: string[]): void;
  getPositionalParam(index: number): string | undefined;

  // Create a child context (for subshells/scripts)
  fork(options?: ForkOptions): IExecutionContext;
}

/**
 * Fork Options - Options for creating child execution contexts
 */
export interface ForkOptions {
  /** Create interactive context (default: false) */
  interactive?: boolean;
  /** Copy aliases from parent (default: true) */
  copyAliases?: boolean;
  /** Copy functions from parent (default: true) */
  copyFunctions?: boolean;
  /** Copy exported variables from parent (default: true) */
  copyExports?: boolean;
  /** Assign new shell PID to child (default: true) */
  newShellPid?: boolean;
}

/**
 * Command Provider Interface
 * All command providers implement this interface.
 */
export interface CommandProvider {
  /** Unique provider ID (e.g., "pyxis.provider.git") */
  readonly id: string;
  /** Type classification */
  readonly type: ProviderType;
  /** Resolution priority (lower = higher priority) */
  readonly priority: number;
  /** Cache time-to-live in milliseconds (0 = no cache, -1 = infinite) */
  readonly cacheTTL: number;

  /**
   * Check if this provider can handle the given command.
   * This method should be fast (< 1ms) as it's called during resolution.
   */
  canHandle(command: string, context: IExecutionContext): Promise<boolean>;

  /**
   * Execute the command.
   */
  execute(
    command: string,
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult>;

  /**
   * Get the list of commands this provider supports
   * This is used for command discovery and completion
   * Returns an array of command names that this provider can handle
   */
  getSupportedCommands(): string[];

  /**
   * Optional: Provide command completion suggestions
   */
  complete?(partial: string, context: IExecutionContext): Promise<CompletionResult[]>;

  /**
   * Optional: Get help text for a command
   */
  getHelp?(command: string): Promise<string>;

  /**
   * Optional: Initialize provider (called once when first used)
   */
  initialize?(projectId: string, context: IExecutionContext): Promise<void>;

  /**
   * Optional: Cleanup provider resources
   */
  dispose?(): Promise<void>;
}

/**
 * Resolved Command - Result of command resolution
 */
export interface ResolvedCommand {
  /** Resolution type */
  type: ProviderType | 'alias' | 'function';
  /** The provider that will handle the command */
  provider?: CommandProvider;
  /** Priority of the resolution */
  priority: number;
  /** For aliases: the expansion string */
  expansion?: string;
  /** For functions: the function body */
  body?: ShellFunction;
}

/**
 * Command Resolution Options
 */
export interface CommandResolutionOptions {
  /** Skip alias resolution (for \command syntax) */
  skipAliases?: boolean;
  /** Skip function resolution (for command builtin) */
  skipFunctions?: boolean;
  /** Only check builtins (for builtin command) */
  onlyBuiltins?: boolean;
  /** Execution context */
  context: IExecutionContext;
}

/**
 * Resolution Cache Entry
 */
export interface ResolutionCacheEntry {
  provider: ResolvedCommand;
  timestamp: number;
  ttl: number;
}

/**
 * Command Not Found Error
 */
export class CommandNotFoundError extends Error {
  readonly command: string;
  readonly suggestions: string[];

  constructor(command: string, suggestions: string[] = []) {
    super(`${command}: command not found`);
    this.name = 'CommandNotFoundError';
    this.command = command;
    this.suggestions = suggestions;
  }
}

/**
 * Special Builtins - Commands that always take precedence (POSIX.1-2017)
 */
export const SPECIAL_BUILTINS = new Set([
  'break',
  'continue',
  'exit',
  'return',
  'eval',
  ':',
  'export',
  'readonly',
  'unset',
  'set',
  'shift',
  'trap',
  'times',
]);

/**
 * Shell Builtins - Commands that affect shell state
 * Note: shift, trap, times are now in SPECIAL_BUILTINS per POSIX.1-2017
 */
export const SHELL_BUILTINS = new Set([
  'cd',
  'pwd',
  'pushd',
  'popd',
  'dirs',
  'echo',
  'printf',
  'read',
  'test',
  '[',
  '[[',
  'source',
  '.',
  'alias',
  'unalias',
  'type',
  'command',
  'builtin',
  'hash',
  'wait',
  'jobs',
  'fg',
  'bg',
  'kill',
  'true',
  'false',
  'getopts',
  'exec',
  'umask',
  'ulimit',
]);

/**
 * Commands that modify parent shell state when executed directly in terminal
 */
export const SHELL_MODIFYING_BUILTINS = new Set([
  'cd',
  'export',
  'unset',
  'alias',
  'unalias',
  'set',
  'readonly',
  'pushd',
  'popd',
]);

/**
 * Check if a command is a special builtin
 */
export function isSpecialBuiltin(command: string): boolean {
  return SPECIAL_BUILTINS.has(command);
}

/**
 * Check if a command is a shell builtin
 */
export function isShellBuiltin(command: string): boolean {
  return SHELL_BUILTINS.has(command) || SPECIAL_BUILTINS.has(command);
}

/**
 * Check if a command modifies parent shell state
 */
export function isShellModifyingBuiltin(command: string): boolean {
  return SHELL_MODIFYING_BUILTINS.has(command);
}
