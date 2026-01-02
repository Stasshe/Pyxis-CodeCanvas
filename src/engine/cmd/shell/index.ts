/**
 * Shell Module - Unified Shell Implementation
 * 
 * This module provides a comprehensive shell implementation for terminal command execution.
 * 
 * Architecture Overview:
 * =====================
 * 
 * Terminal.tsx handles:
 * - Terminal-specific commands (clear, history, vim)
 * - Extension commands (via commandRegistry directly)
 * - git, npm, pyxis commands (via dedicated handlers)
 * - Delegating other commands to StreamShell
 * 
 * StreamShell handles:
 * - Shell operators (&&, ||, |)
 * - Redirections (>, >>, <, /dev/null)
 * - Command substitution ($(cmd), `cmd`)
 * - Brace/glob expansion
 * - Control flow (if/for/while)
 * - Builtins (test, [, true, echo, etc.)
 * - Fallback to unixHandler for file system commands
 * 
 * Files:
 * ======
 * - index.ts          - Module exports and documentation
 * - streamShell.ts    - Main shell class
 * - parser.ts         - Command line parsing (AST-based)
 * - expansion.ts      - Token expansion (IFS, glob, brace)
 * - builtins.ts       - Built-in command implementations
 * - process.ts        - Process abstraction with streams
 * - scriptRunner.ts   - Shell script execution
 * - braceExpand.ts    - Brace expansion utility
 * - types.ts          - Shared type definitions
 */

// Main shell class
export { StreamShell, Process, type ProcExit } from './streamShell';

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

// Default export
export { StreamShell as default } from './streamShell';
