import type { UnixCommands } from '../global/unix';
import type { fileRepository } from '@/engine/core/fileRepository';

/**
 * Common types for the shell system
 */

// Token object from parser
export type TokenObj = { text: string; quote: 'single' | 'double' | null; cmdSub?: string };

// Segment representing a single command in a pipeline
export type Segment = {
  raw: string;
  // tokens may be TokenObj (from parser) or plain strings (after splitting/globbing)
  tokens: Array<string | TokenObj>;
  stdinFile?: string | null;
  stdoutFile?: string | null;
  stderrFile?: string | null;
  stderrToStdout?: boolean;
  stdoutToStderr?: boolean;
  fdDup?: Array<{ from: number; to: number }>;
  fdFiles?: Record<number, { path: string; append: boolean }>;
  append?: boolean;
  background?: boolean;
  logicalOp?: string | null;
};

// Shell options for StreamShell constructor
export type ShellOptions = {
  projectName: string;
  projectId: string;
  unix: UnixCommands; // injection for tests
  fileRepository?: typeof fileRepository; // injection for tests
  commandRegistry?: any;
  /** Terminal columns (width). Updated dynamically on resize. */
  terminalColumns?: number;
  /** Terminal rows (height). Updated dynamically on resize. */
  terminalRows?: number;
};

// Shell run result
export type ShellRunResult = {
  stdout: string;
  stderr: string;
  code: number | null;
};

// Special files that should be handled differently
export const SPECIAL_FILES = {
  DEV_NULL: '/dev/null',
  DEV_ZERO: '/dev/zero',
  DEV_STDIN: '/dev/stdin',
  DEV_STDOUT: '/dev/stdout',
  DEV_STDERR: '/dev/stderr',
} as const;

// Type for special file paths
type SpecialFilePath = (typeof SPECIAL_FILES)[keyof typeof SPECIAL_FILES];

// Check if a path is a special device file
export function isSpecialFile(path: string | null | undefined): boolean {
  if (!path) return false;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const specialFilePaths: readonly string[] = Object.values(SPECIAL_FILES);
  return specialFilePaths.includes(normalizedPath);
}

// Check if a path is /dev/null
export function isDevNull(path: string | null | undefined): boolean {
  if (!path) return false;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return normalizedPath === SPECIAL_FILES.DEV_NULL;
}
