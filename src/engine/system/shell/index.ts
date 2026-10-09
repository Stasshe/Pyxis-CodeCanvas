/**
 * Shell Module - POSIX-compliant Shell Implementation
 *
 * This module provides a comprehensive shell implementation for terminal command execution.
 *
 * Architecture Overview:
 * =====================
 *
 * Direct handler-based command execution:
 * - ../commands/git/handler.ts     - Git commands
 * - ../commands/npm/handler.ts     - NPM commands
 * - ../commands/unix/handler.ts    - Unix commands
 * - builtins.ts                - Shell builtins via unixHandler
 *
 * StreamShell:
 * - Wraps ShellExecutor
 * - Maintains the original API
 *
 * ShellExecutor:
 * - Dispatches system commands and configured application handlers
 * - POSIX-compliant execution
 * - Alias/env management
 *
 * Shell operators supported:
 * - Pipes (|)
 * - Logical operators (&&, ||)
 * - Redirections (>, >>, <, 2>&1, /dev/null)
 * - Command substitution ($(cmd), `cmd`)
 * - Brace/glob expansion
 * - Control flow (if/for/while)
 *
 * Files:
 * ======
 * - index.ts              - Module exports and documentation
 * - streamShell.ts        - Backward compatible wrapper
 * - executor.ts           - Shell executor (uses handlers directly)
 * - parser.ts             - Command line parsing (AST-based)
 * - expansion.ts          - Token expansion (IFS, glob, brace)
 * - builtins.ts           - Builtin command implementations
 * - process.ts            - Process abstraction with streams
 * - scriptRunner.ts       - Shell script execution
 * - braceExpand.ts        - Brace expansion utility
 * - types.ts              - Shared type definitions
 */

export { default as expandBraces } from './braceExpand';
export {
  type OutputCallbacks,
  ShellExecutor,
  type ShellExecutorOptions,
} from './executor';
// Utilities
export { expandTokens } from './expansion';
export { createShellExecutor } from './factory';
// Parser
export { parseCommandLine } from './parser';
export { runScript } from './scriptRunner';
// Main shell classes
// Default export
export { type ProcExit, Process, StreamShell, StreamShell as default } from './streamShell';
// Types
export {
  isDevNull,
  isSpecialFile,
  type Segment,
  type ShellOptions,
  type ShellRunResult,
  SPECIAL_FILES,
  type TokenObj,
} from './types';
