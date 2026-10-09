import type { Readable, Writable } from 'node:stream';
import type TerminalUI from '@/engine/cmd/terminalUI';
import type { FsApi } from '@/engine/core/fs';
import type { CommandRegistry } from '@/engine/extensions/commandRegistry';
import type { UnixCommands } from '../global/unix';
import type { StreamCtx } from './builtins';
import type { Process } from './process';

export type StreamBuiltin = (context: StreamCtx, arguments_: string[]) => Promise<void>;

/**
 * Common types for the shell system
 */

// Token object from parser
export type TokenObj = {
  text: string;
  raw?: string;
  quote: 'single' | 'double' | null;
  cmdSubs?: Array<{ placeholder: string; command: string }>;
  processSubs?: Array<{ placeholder: string; command: string; direction: 'input' | 'output' }>;
};

export interface WordPart {
  text: string;
  quoted: boolean;
  split: boolean;
  boundary?: boolean;
}

export type Redirection =
  | { kind: 'input'; fd: 0; path: string; raw?: string }
  | { kind: 'output'; fd: number; path: string; raw?: string; append: boolean }
  | { kind: 'duplicate'; fd: number; target: number }
  | { kind: 'close'; fd: number };

export type CompoundCommand =
  | { kind: 'subshell'; source: string }
  | { kind: 'group'; source: string }
  | {
      kind: 'if';
      source: string;
      branches: Array<{ condition: string; body: string }>;
      otherwise?: string;
    }
  | { kind: 'for'; source: string; variable: string; items?: string; body: string }
  | { kind: 'while'; source: string; condition: string; body: string };

// Segment representing a single command in a pipeline
export type Segment = {
  raw: string;
  compound?: CompoundCommand;
  inverted?: boolean;
  assignmentOnly?: boolean;
  functionDefinition?: { name: string; source: string };
  separator?: '|' | '&&' | '||' | ';' | '&';
  redirections?: Redirection[];
  // tokens may be TokenObj (from parser) or plain strings (after splitting/globbing)
  tokens: Array<string | TokenObj>;
  stdinText?: string;
  stdinExpand?: boolean;
  commandSubStatus?: number;
};

// Shell options for StreamShell constructor
export type ShellOptions = {
  rootPath: string;
  unix: UnixCommands;
  fsClient?: FsApi;
  commandRegistry?: Pick<
    CommandRegistry,
    'hasCommand' | 'executeCommand' | 'getRegisteredCommands'
  >;
  /** Terminal columns (width). Updated dynamically on resize. */
  terminalColumns?: number;
  /** Terminal rows (height). Updated dynamically on resize. */
  terminalRows?: number;
  env?: Record<string, string>;
  terminalUI?: TerminalUI;
};

export interface ShellExecutorOptions {
  rootPath: string;
  cwd?: string;
  signal?: AbortSignal;
  fsClient?: FsApi;
  unix?: UnixCommands;
  commandRegistry?: Pick<
    CommandRegistry,
    'hasCommand' | 'executeCommand' | 'getRegisteredCommands'
  >;
  terminalColumns?: number;
  terminalRows?: number;
  terminalUI?: TerminalUI;
  env?: Record<string, string>;
  isInteractive?: boolean;
  trackDetachedProcess?: (process: Process, completion: Promise<void>) => void;
}

export interface OutputCallbacks {
  stdout?: (data: string) => void;
  stderr?: (data: string) => void;
}

export interface ShellExecutionOptions {
  stdin?: Readable;
  stdinDestination?: Writable;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  stderrIsTTY?: boolean;
  processPid?: number;
  errexitIgnored?: boolean;
  inFunction?: boolean;
}

// Shell run result
export type ShellRunResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  errexitEligible?: boolean;
  fatalError?: boolean;
  exitShell?: boolean;
  interrupted?: boolean;
};

// Special files that should be handled differently
export const SPECIAL_FILES = {
  DEV_NULL: '/dev/null',
  DEV_STDIN: '/dev/stdin',
  DEV_STDOUT: '/dev/stdout',
  DEV_STDERR: '/dev/stderr',
} as const;

// Check if a path is a special device file
export function isSpecialFile(path: string | null | undefined): boolean {
  if (!path) return false;
  const specialFilePaths: readonly string[] = Object.values(SPECIAL_FILES);
  return specialFilePaths.includes(path);
}

// Check if a path is /dev/null
export function isDevNull(path: string | null | undefined): boolean {
  if (!path) return false;
  return path === SPECIAL_FILES.DEV_NULL;
}
