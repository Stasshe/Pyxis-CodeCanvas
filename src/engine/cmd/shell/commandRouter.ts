/**
 * CommandRouter - Centralized command routing for StreamShell
 * 
 * Provides a unified, extensible architecture for command execution:
 * 
 * Command Categories:
 * 1. Shell Builtins - Core shell commands (test, [, true, type, etc.)
 * 2. Unix Commands - File system operations (ls, cd, cat, etc.)
 * 3. Tool Commands - git, npm, pyxis (delegated to specialized handlers)
 * 4. Extension Commands - Commands registered via commandRegistry
 * 5. Runtime Commands - Language runtimes (node, etc.)
 * 
 * Execution Priority:
 * 1. Shell builtins (highest)
 * 2. Extension commands (user-defined take precedence)
 * 3. Tool commands (git, npm, pyxis)
 * 4. Unix commands
 * 5. Command not found (lowest)
 */

import type { Readable, Writable } from 'stream';

export type CommandContext = {
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  projectName: string;
  projectId: string;
  terminalColumns?: number;
  terminalRows?: number;
  onSignal?: (fn: (sig: string) => void) => void;
};

export type CommandResult = {
  code: number;
  handled: boolean;
};

export type CommandHandler = (
  ctx: CommandContext,
  cmd: string,
  args: string[]
) => Promise<CommandResult>;

/**
 * Command category definitions
 */
export const CommandCategory = {
  BUILTIN: 'builtin',      // Shell built-in commands
  EXTENSION: 'extension',  // User/extension registered commands
  TOOL: 'tool',           // git, npm, pyxis
  UNIX: 'unix',           // File system operations
  RUNTIME: 'runtime',     // Language runtimes (node, etc.)
  UNKNOWN: 'unknown',     // Unrecognized commands
} as const;

export type CommandCategoryType = typeof CommandCategory[keyof typeof CommandCategory];

/**
 * Shell built-in commands that are handled internally
 */
export const SHELL_BUILTINS = new Set([
  'test', '[', 'true', 'false', 'type', 'exit', 'export', 'unset', 'set',
  'cd', 'pwd', 'echo', 'printf', 'read', 'source', '.', 'alias', 'unalias',
]);

/**
 * Unix/file system commands
 */
export const UNIX_COMMANDS = new Set([
  'ls', 'cat', 'mkdir', 'touch', 'rm', 'cp', 'mv', 'rename',
  'tree', 'find', 'grep', 'head', 'tail', 'stat', 'unzip',
  'help', 'date', 'whoami', 'chmod', 'chown', 'ln',
]);

/**
 * Tool commands that delegate to specialized handlers
 */
export const TOOL_COMMANDS = new Set([
  'git', 'npm', 'npx', 'pyxis', 'yarn', 'pnpm',
]);

/**
 * Runtime commands
 */
export const RUNTIME_COMMANDS = new Set([
  'node', 'python', 'python3', 'ruby', 'go', 'java',
]);

/**
 * Categorize a command
 */
export function categorizeCommand(
  cmd: string,
  extensionRegistry?: { hasCommand: (cmd: string) => boolean }
): CommandCategoryType {
  const lowerCmd = cmd.toLowerCase();
  
  // Check builtins first
  if (SHELL_BUILTINS.has(lowerCmd)) {
    return CommandCategory.BUILTIN;
  }
  
  // Check extension commands (user-defined take precedence)
  // Note: Extension registries may be case-sensitive, so we check both
  // the original cmd and lowercase version for maximum compatibility
  if (extensionRegistry?.hasCommand(cmd) || extensionRegistry?.hasCommand(lowerCmd)) {
    return CommandCategory.EXTENSION;
  }
  
  // Check tool commands
  if (TOOL_COMMANDS.has(lowerCmd)) {
    return CommandCategory.TOOL;
  }
  
  // Check runtime commands
  if (RUNTIME_COMMANDS.has(lowerCmd)) {
    return CommandCategory.RUNTIME;
  }
  
  // Check unix commands
  if (UNIX_COMMANDS.has(lowerCmd)) {
    return CommandCategory.UNIX;
  }
  
  return CommandCategory.UNKNOWN;
}

/**
 * Get all available commands by category
 */
export function getAvailableCommands(): Record<CommandCategoryType, string[]> {
  return {
    [CommandCategory.BUILTIN]: Array.from(SHELL_BUILTINS),
    [CommandCategory.EXTENSION]: [], // Populated dynamically
    [CommandCategory.TOOL]: Array.from(TOOL_COMMANDS),
    [CommandCategory.RUNTIME]: Array.from(RUNTIME_COMMANDS),
    [CommandCategory.UNIX]: Array.from(UNIX_COMMANDS),
    [CommandCategory.UNKNOWN]: [],
  };
}

/**
 * CommandRouter class - Routes commands to appropriate handlers
 */
export class CommandRouter {
  private extensionRegistry: { hasCommand: (cmd: string) => boolean } | null = null;
  private customHandlers: Map<string, CommandHandler> = new Map();
  
  /**
   * Set the extension registry for extension command lookup
   */
  setExtensionRegistry(registry: { hasCommand: (cmd: string) => boolean } | null) {
    this.extensionRegistry = registry;
  }
  
  /**
   * Register a custom command handler
   */
  registerHandler(cmd: string, handler: CommandHandler) {
    this.customHandlers.set(cmd.toLowerCase(), handler);
  }
  
  /**
   * Unregister a custom command handler
   */
  unregisterHandler(cmd: string) {
    this.customHandlers.delete(cmd.toLowerCase());
  }
  
  /**
   * Check if a command exists
   */
  hasCommand(cmd: string): boolean {
    const category = this.categorize(cmd);
    return category !== CommandCategory.UNKNOWN;
  }
  
  /**
   * Categorize a command
   */
  categorize(cmd: string): CommandCategoryType {
    const lowerCmd = cmd.toLowerCase();
    
    // Custom handlers take highest priority
    if (this.customHandlers.has(lowerCmd)) {
      return CommandCategory.EXTENSION;
    }
    
    return categorizeCommand(cmd, this.extensionRegistry ?? undefined);
  }
  
  /**
   * Get command info for help/type commands
   */
  getCommandInfo(cmd: string): { category: CommandCategoryType; description: string } {
    const category = this.categorize(cmd);
    const descriptions: Record<CommandCategoryType, string> = {
      [CommandCategory.BUILTIN]: 'shell builtin',
      [CommandCategory.EXTENSION]: 'extension command',
      [CommandCategory.TOOL]: 'external tool',
      [CommandCategory.RUNTIME]: 'runtime command',
      [CommandCategory.UNIX]: 'unix command',
      [CommandCategory.UNKNOWN]: 'not found',
    };
    
    return {
      category,
      description: descriptions[category],
    };
  }
  
  /**
   * List all available commands
   */
  listCommands(): string[] {
    const commands = new Set<string>();
    
    // Add all known commands
    SHELL_BUILTINS.forEach(cmd => commands.add(cmd));
    TOOL_COMMANDS.forEach(cmd => commands.add(cmd));
    RUNTIME_COMMANDS.forEach(cmd => commands.add(cmd));
    UNIX_COMMANDS.forEach(cmd => commands.add(cmd));
    
    // Add custom handlers
    this.customHandlers.forEach((_, cmd) => commands.add(cmd));
    
    return Array.from(commands).sort();
  }
}

// Singleton instance
let routerInstance: CommandRouter | null = null;

/**
 * Get the global CommandRouter instance
 */
export function getCommandRouter(): CommandRouter {
  if (!routerInstance) {
    routerInstance = new CommandRouter();
  }
  return routerInstance;
}

/**
 * Reset the global CommandRouter instance (for testing)
 */
export function resetCommandRouter() {
  routerInstance = null;
}

export default CommandRouter;
