/**
 * TerminalSuggestProvider - Terminal autocomplete suggestions provider
 *
 * Provides command, file path, and history suggestions for terminal input.
 * Inspired by VS Code terminal suggest widget.
 */

import { UNIX_COMMANDS } from './global/unix';

// Git commands and subcommands
const GIT_COMMANDS = [
  'init', 'clone', 'status', 'add', 'commit', 'push', 'pull', 'fetch',
  'branch', 'checkout', 'switch', 'merge', 'rebase', 'reset', 'revert',
  'log', 'diff', 'show', 'stash', 'remote', 'tag',
] as const;

// npm commands
const NPM_COMMANDS = [
  'install', 'uninstall', 'run', 'init', 'list', 'update', 'audit',
  'publish', 'pack', 'link', 'test', 'start', 'build',
] as const;

// Pyxis commands
const PYXIS_COMMANDS = [
  'help', 'version', 'clear', 'history', 'vim',
] as const;

/**
 * Suggestion item type
 */
export interface SuggestItem {
  label: string;
  kind: 'command' | 'file' | 'directory' | 'history' | 'git-branch' | 'npm-script';
  detail?: string;
  insertText: string;
}

/**
 * Context for generating suggestions
 */
export interface SuggestContext {
  currentDir: string;
  commandHistory: string[];
  projectId: string;
  getFilesInDir?: (dir: string) => Promise<Array<{ name: string; isDirectory: boolean }>>;
  getGitBranches?: () => Promise<string[]>;
  getNpmScripts?: () => Promise<string[]>;
}

// Cache for file suggestions
interface FileCache {
  dir: string;
  files: Array<{ name: string; isDirectory: boolean }>;
  timestamp: number;
}

const CACHE_TTL = 5000; // 5 seconds
let fileCache: FileCache | null = null;

/**
 * Terminal Suggest Provider class
 */
export class TerminalSuggestProvider {
  /**
   * Get suggestions based on current input
   */
  async getSuggestions(
    input: string,
    cursorPos: number,
    context: SuggestContext
  ): Promise<SuggestItem[]> {
    const beforeCursor = input.slice(0, cursorPos);
    const parts = beforeCursor.trim().split(/\s+/);
    const currentWord = parts[parts.length - 1] || '';
    const commandPart = parts[0]?.toLowerCase() || '';

    // Empty input or just typing first command
    if (parts.length <= 1) {
      return this.getCommandSuggestions(currentWord, context.commandHistory);
    }

    // After command - check for subcommands or file paths
    if (commandPart === 'git' && parts.length === 2) {
      return this.getGitSubcommandSuggestions(currentWord);
    }

    if (commandPart === 'npm' && parts.length === 2) {
      return this.getNpmSubcommandSuggestions(currentWord, context);
    }

    // Git checkout/switch branch completion
    if (commandPart === 'git' && (parts[1] === 'checkout' || parts[1] === 'switch') && parts.length === 3) {
      return this.getGitBranchSuggestions(currentWord, context);
    }

    // npm run script completion
    if (commandPart === 'npm' && parts[1] === 'run' && parts.length === 3) {
      return this.getNpmScriptSuggestions(currentWord, context);
    }

    // File path completion for file-related commands
    const fileCommands = ['cd', 'ls', 'cat', 'head', 'tail', 'rm', 'cp', 'mv', 'mkdir', 'touch', 'vim'];
    if (fileCommands.includes(commandPart) || currentWord.includes('/') || currentWord.startsWith('.')) {
      return this.getFilePathSuggestions(currentWord, context);
    }

    return [];
  }

  /**
   * Get command suggestions (unix, git, npm, pyxis, history)
   */
  getCommandSuggestions(prefix: string, history: string[]): SuggestItem[] {
    const suggestions: SuggestItem[] = [];
    const lowerPrefix = prefix.toLowerCase();

    // Add Unix commands
    for (const cmd of UNIX_COMMANDS) {
      if (cmd.startsWith(lowerPrefix)) {
        suggestions.push({
          label: cmd,
          kind: 'command',
          detail: 'Unix command',
          insertText: cmd,
        });
      }
    }

    // Add git as main command
    if ('git'.startsWith(lowerPrefix)) {
      suggestions.push({
        label: 'git',
        kind: 'command',
        detail: 'Git version control',
        insertText: 'git',
      });
    }

    // Add npm as main command
    if ('npm'.startsWith(lowerPrefix)) {
      suggestions.push({
        label: 'npm',
        kind: 'command',
        detail: 'Node package manager',
        insertText: 'npm',
      });
    }

    // Add pyxis/built-in commands
    for (const cmd of PYXIS_COMMANDS) {
      if (cmd.startsWith(lowerPrefix)) {
        suggestions.push({
          label: cmd,
          kind: 'command',
          detail: 'Built-in command',
          insertText: cmd,
        });
      }
    }

    // Add history suggestions (unique, limited)
    const historySet = new Set<string>();
    for (const historyItem of history.slice(-20).reverse()) {
      const firstWord = historyItem.split(/\s+/)[0];
      if (firstWord.toLowerCase().startsWith(lowerPrefix) && !historySet.has(historyItem)) {
        historySet.add(historyItem);
        suggestions.push({
          label: historyItem,
          kind: 'history',
          detail: 'History',
          insertText: historyItem,
        });
        if (historySet.size >= 5) break;
      }
    }

    return suggestions.slice(0, 15);
  }

  /**
   * Get git subcommand suggestions
   */
  getGitSubcommandSuggestions(prefix: string): SuggestItem[] {
    const lowerPrefix = prefix.toLowerCase();
    return GIT_COMMANDS
      .filter(cmd => cmd.startsWith(lowerPrefix))
      .map(cmd => ({
        label: cmd,
        kind: 'command' as const,
        detail: 'Git subcommand',
        insertText: cmd,
      }));
  }

  /**
   * Get npm subcommand suggestions
   */
  async getNpmSubcommandSuggestions(prefix: string, context: SuggestContext): Promise<SuggestItem[]> {
    const lowerPrefix = prefix.toLowerCase();
    return NPM_COMMANDS
      .filter(cmd => cmd.startsWith(lowerPrefix))
      .map(cmd => ({
        label: cmd,
        kind: 'command' as const,
        detail: 'npm subcommand',
        insertText: cmd,
      }));
  }

  /**
   * Get file path suggestions
   */
  async getFilePathSuggestions(prefix: string, context: SuggestContext): Promise<SuggestItem[]> {
    if (!context.getFilesInDir) return [];

    // Determine directory to list
    let searchDir = context.currentDir;
    let filePrefix = prefix;

    if (prefix.includes('/')) {
      const lastSlash = prefix.lastIndexOf('/');
      const dirPart = prefix.slice(0, lastSlash) || '/';
      filePrefix = prefix.slice(lastSlash + 1);

      // Resolve relative to current dir
      if (dirPart.startsWith('/')) {
        searchDir = dirPart;
      } else if (dirPart === '.') {
        searchDir = context.currentDir;
      } else if (dirPart === '..') {
        const parts = context.currentDir.split('/');
        parts.pop();
        searchDir = parts.join('/') || '/';
      } else {
        searchDir = `${context.currentDir}/${dirPart}`.replace(/\/+/g, '/');
      }
    }

    // Check cache
    const now = Date.now();
    let files: Array<{ name: string; isDirectory: boolean }>;

    if (fileCache && fileCache.dir === searchDir && (now - fileCache.timestamp) < CACHE_TTL) {
      files = fileCache.files;
    } else {
      try {
        files = await context.getFilesInDir(searchDir);
        // Limit to 100 files for performance
        files = files.slice(0, 100);
        // Exclude node_modules
        files = files.filter(f => f.name !== 'node_modules');
        fileCache = { dir: searchDir, files, timestamp: now };
      } catch {
        return [];
      }
    }

    const lowerPrefix = filePrefix.toLowerCase();
    return files
      .filter(f => f.name.toLowerCase().startsWith(lowerPrefix))
      .map(f => {
        const dirPath = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/') + 1) : '';
        return {
          label: f.name,
          kind: f.isDirectory ? 'directory' as const : 'file' as const,
          detail: f.isDirectory ? 'Directory' : 'File',
          insertText: `${dirPath}${f.name}${f.isDirectory ? '/' : ''}`,
        };
      })
      .slice(0, 20);
  }

  /**
   * Get git branch suggestions
   */
  async getGitBranchSuggestions(prefix: string, context: SuggestContext): Promise<SuggestItem[]> {
    if (!context.getGitBranches) return [];

    try {
      const branches = await context.getGitBranches();
      const lowerPrefix = prefix.toLowerCase();
      return branches
        .filter(b => b.toLowerCase().startsWith(lowerPrefix))
        .map(b => ({
          label: b,
          kind: 'git-branch' as const,
          detail: 'Git branch',
          insertText: b,
        }))
        .slice(0, 10);
    } catch {
      return [];
    }
  }

  /**
   * Get npm script suggestions
   */
  async getNpmScriptSuggestions(prefix: string, context: SuggestContext): Promise<SuggestItem[]> {
    if (!context.getNpmScripts) return [];

    try {
      const scripts = await context.getNpmScripts();
      const lowerPrefix = prefix.toLowerCase();
      return scripts
        .filter(s => s.toLowerCase().startsWith(lowerPrefix))
        .map(s => ({
          label: s,
          kind: 'npm-script' as const,
          detail: 'npm script',
          insertText: s,
        }))
        .slice(0, 10);
    } catch {
      return [];
    }
  }

  /**
   * Clear file cache
   */
  clearCache(): void {
    fileCache = null;
  }
}

// Singleton instance
export const terminalSuggestProvider = new TerminalSuggestProvider();
