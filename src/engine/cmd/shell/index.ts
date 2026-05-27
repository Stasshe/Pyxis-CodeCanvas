/**
 * Shell Module - POSIX-compliant Shell Implementation
 *
 * This module provides a comprehensive shell implementation for terminal command execution.
 *
 * Architecture Overview:
 * =====================
 *
 * Direct handler-based command execution:
 * - handlers/gitHandler.ts     - Git commands
 * - handlers/npmHandler.ts     - NPM commands
 * - handlers/pyxisHandler.ts   - Pyxis-specific commands
 * - handlers/unixHandler.ts    - Unix commands
 * - builtins.ts                - Shell builtins via unixHandler
 *
 * StreamShell:
 * - Wraps ShellExecutor
 * - Maintains the original API
 *
 * ShellExecutor:
 * - Direct handler invocation (no provider abstraction)
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
  createShellExecutor,
  type OutputCallbacks,
  ShellExecutor,
  type ShellExecutorOptions,
} from './executor';
// Utilities
export { expandTokens } from './expansion';
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
