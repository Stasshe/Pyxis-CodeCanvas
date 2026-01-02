/**
 * Shell Module - Unified Shell Implementation
 * 
 * This module provides a comprehensive shell implementation for terminal command execution.
 * 
 * Architecture Overview:
 * =====================
 * 
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                        Terminal.tsx                             │
 * │  (Only handles: clear, history, vim)                           │
 * │  All other commands → StreamShell                               │
 * └──────────────────────────┬──────────────────────────────────────┘
 *                            │
 *                            ▼
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                      StreamShell                                │
 * │  - Command parsing (parser.ts)                                  │
 * │  - Token expansion (expansion.ts)                               │
 * │  - Command routing (commandRouter.ts)                           │
 * │  - Process management (process.ts)                              │
 * │  - Script execution (scriptRunner.ts)                           │
 * └──────────────────────────┬──────────────────────────────────────┘
 *                            │
 *           ┌────────────────┼────────────────┐
 *           │                │                │
 *           ▼                ▼                ▼
 * ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
 * │    Builtins     │ │   Extensions    │ │   UnixHandler   │
 * │ (builtins.ts)   │ │ (commandReg.)   │ │ (unixHandler)   │
 * │                 │ │                 │ │                 │
 * │ - test, [       │ │ - User cmds     │ │ - git, npm      │
 * │ - true, false   │ │ - Plugin cmds   │ │ - pyxis         │
 * │ - type          │ │                 │ │ - ls, cat, etc  │
 * │ - node          │ │                 │ │                 │
 * └─────────────────┘ └─────────────────┘ └─────────────────┘
 * 
 * Command Categories (Priority Order):
 * ===================================
 * 1. Shell Builtins    - test, [, true, type, echo, pwd, cd
 * 2. Extension Cmds    - User-registered commands (highest precedence)
 * 3. Tool Commands     - git, npm, npx, pyxis, yarn, pnpm
 * 4. Runtime Commands  - node, python, ruby, go
 * 5. Unix Commands     - ls, cat, mkdir, grep, find, etc.
 * 
 * Features:
 * =========
 * - Pipeline support: cmd1 | cmd2 | cmd3
 * - Logical operators: cmd1 && cmd2, cmd1 || cmd2
 * - Redirections: >, >>, <, 2>, 2>&1, &>
 * - Special files: /dev/null, /dev/stdin, /dev/stdout
 * - Command substitution: $(cmd), `cmd`
 * - Brace expansion: {a,b,c}, {1..10}
 * - Glob expansion: *.txt, **\/*.js
 * - Control flow: if/then/else/fi, for/do/done, while/do/done
 * 
 * Files:
 * ======
 * - index.ts          - Module exports and documentation
 * - streamShell.ts    - Main shell class
 * - commandRouter.ts  - Command categorization and routing
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

// Command routing
export {
  CommandRouter,
  CommandCategory,
  categorizeCommand,
  getCommandRouter,
  resetCommandRouter,
  getAvailableCommands,
  SHELL_BUILTINS,
  UNIX_COMMANDS,
  TOOL_COMMANDS,
  RUNTIME_COMMANDS,
  type CommandContext,
  type CommandResult,
  type CommandHandler,
  type CommandCategoryType,
} from './commandRouter';

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
