/**
 * Shell Module - POSIX-compliant Shell Implementation
 * 
 * This module provides a comprehensive shell implementation for terminal command execution.
 * 
 * Architecture Overview:
 * =====================
 * 
 * Provider-based command execution:
 * - BuiltinProvider     - Shell builtins (cd, pwd, export, etc.)
 * - GitProvider         - Git commands
 * - NpmProvider         - NPM commands
 * - PyxisProvider       - Pyxis-specific commands
 * - ExtensionProvider   - Extension commands (via commandRegistry)
 * - ExternalProvider    - Unix file system commands
 * 
 * StreamShell (backward compatibility):
 * - Wraps ShellExecutor for existing code
 * - Maintains the original API
 * 
 * ShellExecutor (new):
 * - Provider-based command resolution
 * - POSIX-compliant execution
 * - Execution context management
 * - Stream management
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
 * - executor.ts           - New provider-based shell executor
 * - parser.ts             - Command line parsing (AST-based)
 * - expansion.ts          - Token expansion (IFS, glob, brace)
 * - builtins.ts           - Legacy builtin implementations
 * - process.ts            - Process abstraction with streams
 * - scriptRunner.ts       - Shell script execution
 * - braceExpand.ts        - Brace expansion utility
 * - types.ts              - Shared type definitions
 * - providers/            - Command provider implementations
 * - context/              - Execution context management
 * - io/                   - Stream management
 */

// Main shell classes
export { StreamShell, Process, type ProcExit } from './streamShell';
export { ShellExecutor, createShellExecutor, type ShellExecutorOptions, type OutputCallbacks } from './executor';

// Parser
export { parseCommandLine } from './parser';

// Types
export {
  isDevNull,
  isSpecialFile,
  SPECIAL_FILES,
  type Segment,
  type ShellOptions,
  type ShellRunResult,
  type TokenObj,
} from './types';

// Utilities
export { expandTokens } from './expansion';
export { default as expandBraces } from './braceExpand';
export { runScript } from './scriptRunner';

// Provider system
export * from './providers';
export * from './context';
export * from './io';

// Default export
export { StreamShell as default } from './streamShell';
