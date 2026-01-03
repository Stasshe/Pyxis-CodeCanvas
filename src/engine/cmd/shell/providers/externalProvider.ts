/**
 * External Command Provider
 * Provides external command execution (unix commands, scripts, node, etc.)
 * This is the fallback provider for commands not handled by other providers.
 */

import type {
  CommandProvider,
  CompletionResult,
  ExecutionResult,
  IExecutionContext,
  IStreamManager,
} from './types';
import { ProviderType } from './types';

/**
 * Default timeout for stdin collection in milliseconds.
 * This timeout is used when reading from piped stdin to avoid blocking forever.
 * For interactive scenarios or longer pipelines, this may need to be increased.
 */
const DEFAULT_STDIN_TIMEOUT_MS = 100;

/**
 * Read stdin content from a stream with timeout
 * @param streams - The stream manager
 * @param timeoutMs - Timeout in milliseconds (default: DEFAULT_STDIN_TIMEOUT_MS)
 * @returns The stdin content or null if empty/timeout
 */
async function collectStdin(
  streams: IStreamManager,
  timeoutMs: number = DEFAULT_STDIN_TIMEOUT_MS
): Promise<string | null> {
  try {
    const chunks: string[] = [];
    const stdin = streams.stdin as any;
    
    // First, try to read any buffered data
    if (stdin && typeof stdin.read === 'function') {
      let chunk: any;
      while ((chunk = stdin.read()) !== null) {
        chunks.push(String(chunk));
      }
    }
    
    // Then listen for more data with timeout
    if (stdin && typeof stdin.on === 'function') {
      await new Promise<void>((resolve) => {
        const onData = (chunk: any) => chunks.push(String(chunk));
        const onEnd = () => {
          stdin.off('data', onData);
          resolve();
        };
        stdin.on('data', onData);
        stdin.once('end', onEnd);
        stdin.once('close', onEnd);
        // Timeout to avoid hanging on stdin reads
        setTimeout(() => {
          stdin.off('data', onData);
          resolve();
        }, timeoutMs);
      });
    }
    
    return chunks.length > 0 ? chunks.join('') : null;
  } catch {
    return null;
  }
}

/**
 * External Command Provider Implementation
 * This is the fallback provider that handles filesystem commands and scripts.
 * It dynamically determines command availability based on:
 * 1. Standard Unix/POSIX file commands
 * 2. Script files (*.sh)
 * 3. node_modules/.bin executables
 */
export class ExternalCommandProvider implements CommandProvider {
  readonly id = 'pyxis.provider.external';
  readonly type = ProviderType.EXTERNAL;
  readonly priority = 1000; // Lowest priority - fallback provider
  readonly cacheTTL = 30000; // 30 seconds cache

  private unixCommands: any = null;
  private projectId: string = '';
  private projectName: string = '';

  /**
   * Standard Unix/POSIX filesystem commands
   * These are commands commonly available on POSIX systems for file manipulation
   */
  private static readonly FILESYSTEM_COMMANDS = [
    // Core file operations
    'ls', 'cat', 'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch', 'ln',
    // File inspection
    'head', 'tail', 'stat', 'file', 'wc',
    // Search and filter
    'grep', 'find', 'tree',
    // Archive
    'unzip', 'tar',
    // Permissions
    'chmod', 'chown',
    // Other utilities
    'date', 'whoami', 'hostname', 'uname',
    'help', 'clear', 'history',
  ] as const;

  /**
   * Runtime/interpreter commands
   * Commands for running scripts and programs
   */
  private static readonly RUNTIME_COMMANDS = [
    'node', 'sh', 'bash', 'npx',
  ] as const;

  /**
   * Editor commands
   */
  private static readonly EDITOR_COMMANDS = [
    'vim', 'vi', 'nano', 'ed',
  ] as const;

  async canHandle(command: string, context: IExecutionContext): Promise<boolean> {
    // Check if it's a known filesystem/runtime command
    if (this.isKnownCommand(command)) {
      return true;
    }

    // Check if command looks like a script path
    if (command.includes('/') || command.endsWith('.sh')) {
      return true;
    }

    // Check if it's a node_modules/.bin command
    try {
      const fileRepository = await context.getSystemModule('fileRepository');
      if (fileRepository) {
        const binPath = `/node_modules/.bin/${command}`;
        const file = await (fileRepository as any).getFileByPath?.(context.projectId, binPath);
        if (file) {
          return true;
        }
      }
    } catch {
      // Ignore
    }

    // As fallback provider, accept any command
    // This allows for dynamic commands from injected unix handlers
    return true;
  }

  /**
   * Check if a command is in our known command lists
   */
  private isKnownCommand(command: string): boolean {
    return (
      (ExternalCommandProvider.FILESYSTEM_COMMANDS as readonly string[]).includes(command) ||
      (ExternalCommandProvider.RUNTIME_COMMANDS as readonly string[]).includes(command) ||
      (ExternalCommandProvider.EDITOR_COMMANDS as readonly string[]).includes(command)
    );
  }

  getSupportedCommands(): string[] {
    // Return all known commands this provider can handle
    return [
      ...ExternalCommandProvider.FILESYSTEM_COMMANDS,
      ...ExternalCommandProvider.RUNTIME_COMMANDS,
      ...ExternalCommandProvider.EDITOR_COMMANDS,
    ];
  }

  async initialize(projectId: string, context: IExecutionContext): Promise<void> {
    this.projectId = projectId;
    this.projectName = context.projectName;

    // Try to get unix commands from context first (for injected mock commands)
    try {
      this.unixCommands = await context.getSystemModule('unixCommands');
      if (this.unixCommands) return;
    } catch {
      // Ignore - will try to load from registry
    }

    // Fallback to terminalCommandRegistry
    try {
      const { terminalCommandRegistry } = await import('../../terminalRegistry');
      this.unixCommands = terminalCommandRegistry.getUnixCommands(this.projectName, this.projectId);
    } catch (e) {
      console.error('[ExternalProvider] Failed to initialize:', e);
    }
  }

  async execute(
    command: string,
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    // First try to get unix commands from context (injected)
    if (!this.unixCommands) {
      try {
        this.unixCommands = await context.getSystemModule('unixCommands');
      } catch {
        // Ignore
      }
    }

    // Fallback initialization
    if (!this.unixCommands) {
      await this.initialize(context.projectId, context);
    }

    // If we have direct unix commands available, use them
    if (this.unixCommands) {
      return await this.executeWithUnixCommands(command, args, context, streams);
    }

    // Otherwise fallback to handler
    return await this.executeWithHandler(command, args, context, streams);
  }

  /**
   * Execute using direct unix commands (mock or real)
   */
  private async executeWithUnixCommands(
    command: string,
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    const unix = this.unixCommands;

    try {
      let result: string | undefined | null;
      let exitCode = 0;

      switch (command) {
        case 'echo':
          result = await unix.echo?.(args.join(' '));
          if (result !== undefined && result !== null) {
            await streams.writeStdout(result);
            if (!result.endsWith('\n')) {
              await streams.writeStdout('\n');
            }
          }
          return { exitCode: 0 };

        case 'pwd':
          result = await unix.pwd?.();
          if (result !== undefined && result !== null) {
            await streams.writeStdout(result);
            if (!result.endsWith('\n')) {
              await streams.writeStdout('\n');
            }
          }
          return { exitCode: 0 };

        case 'ls':
          const lsOptions = args.filter(a => a.startsWith('-'));
          const lsPath = args.find(a => !a.startsWith('-'));
          result = await unix.ls?.(lsPath, lsOptions);
          if (result !== undefined && result !== null) {
            await streams.writeStdout(result);
            if (!result.endsWith('\n')) {
              await streams.writeStdout('\n');
            }
          }
          return { exitCode: 0 };

        case 'cd':
          if (args.length === 0) {
            await streams.writeStderr('cd: missing operand\n');
            return { exitCode: 1 };
          }
          result = await unix.cd?.(args[0]);
          if (result !== undefined && result !== null && result !== '') {
            await streams.writeStdout(result);
          }
          return { exitCode: 0 };

        case 'cat':
          if (args.length === 0) {
            await streams.writeStderr('cat: missing file operand\n');
            return { exitCode: 1 };
          }
          result = await unix.cat?.(args[0]);
          if (result !== undefined && result !== null) {
            await streams.writeStdout(result);
            if (!result.endsWith('\n')) {
              await streams.writeStdout('\n');
            }
          }
          return { exitCode: 0 };

        case 'mkdir':
          if (args.length === 0) {
            await streams.writeStderr('mkdir: missing operand\n');
            return { exitCode: 1 };
          }
          const mkdirRecursive = args.includes('-p');
          const mkdirDir = args.find(a => !a.startsWith('-'));
          if (mkdirDir) {
            result = await unix.mkdir?.(mkdirDir, mkdirRecursive);
            if (result) await streams.writeStdout(result + '\n');
          }
          return { exitCode: 0 };

        case 'touch':
          if (args.length === 0) {
            await streams.writeStderr('touch: missing file operand\n');
            return { exitCode: 1 };
          }
          result = await unix.touch?.(args[0]);
          if (result) await streams.writeStdout(result + '\n');
          return { exitCode: 0 };

        case 'rm':
          if (args.length === 0) {
            await streams.writeStderr('rm: missing operand\n');
            return { exitCode: 1 };
          }
          result = await unix.rm?.(args);
          if (result) await streams.writeStdout(result + '\n');
          return { exitCode: 0 };

        case 'cp':
          if (args.length < 2) {
            await streams.writeStderr('cp: missing file operand\n');
            return { exitCode: 1 };
          }
          const cpOptions = args.filter(a => a.startsWith('-'));
          const cpPaths = args.filter(a => !a.startsWith('-'));
          result = await unix.cp?.(cpPaths.slice(0, -1), cpPaths[cpPaths.length - 1], cpOptions);
          if (result) await streams.writeStdout(result + '\n');
          return { exitCode: 0 };

        case 'mv':
          if (args.length < 2) {
            await streams.writeStderr('mv: missing file operand\n');
            return { exitCode: 1 };
          }
          const mvPaths = args.filter(a => !a.startsWith('-'));
          result = await unix.mv?.(mvPaths.slice(0, -1), mvPaths[mvPaths.length - 1]);
          if (result) await streams.writeStdout(result + '\n');
          return { exitCode: 0 };

        case 'grep':
          if (args.length === 0) {
            await streams.writeStderr('grep: missing pattern\n');
            return { exitCode: 1 };
          }
          const grepOptions = args.filter(a => a.startsWith('-'));
          const grepArgs = args.filter(a => !a.startsWith('-'));
          const pattern = grepArgs[0];
          const files = grepArgs.slice(1);
          
          // Collect stdin for grep if no files specified
          const grepStdin = files.length === 0 ? await collectStdin(streams) : null;
          
          result = await unix.grep?.(pattern, files, grepOptions, grepStdin);
          if (result) {
            await streams.writeStdout(result);
            if (!result.endsWith('\n')) {
              await streams.writeStdout('\n');
            }
          }
          return { exitCode: result ? 0 : 1 };

        case 'head': {
          const headFile = args.find(a => !a.startsWith('-'));
          const headN = args.find(a => a.startsWith('-n'));
          const headLines = headN ? parseInt(headN.replace('-n', '').replace('=', '')) : 10;
          const headOptions = args.filter(a => a.startsWith('-'));
          
          // Collect stdin for head if no file specified
          const headStdin = !headFile ? await collectStdin(streams) : null;
          
          result = await unix.head?.(headFile || '', headLines, headOptions, headStdin);
          if (result) {
            await streams.writeStdout(result);
            if (!result.endsWith('\n')) {
              await streams.writeStdout('\n');
            }
          }
          return { exitCode: 0 };
        }

        case 'tail': {
          const tailFile = args.find(a => !a.startsWith('-'));
          const tailN = args.find(a => a.startsWith('-n'));
          const tailLines = tailN ? parseInt(tailN.replace('-n', '').replace('=', '')) : 10;
          const tailOptions = args.filter(a => a.startsWith('-'));
          
          // Collect stdin for tail if no file specified
          const tailStdin = !tailFile ? await collectStdin(streams) : null;
          
          result = await unix.tail?.(tailFile || '', tailLines, tailOptions, tailStdin);
          if (result) {
            await streams.writeStdout(result);
            if (!result.endsWith('\n')) {
              await streams.writeStdout('\n');
            }
          }
          return { exitCode: 0 };
        }

        case 'find':
          result = await unix.find?.(args);
          if (result) {
            await streams.writeStdout(result);
            if (!result.endsWith('\n')) {
              await streams.writeStdout('\n');
            }
          }
          return { exitCode: 0 };

        case 'tree':
          const treePath = args.find(a => !a.startsWith('-'));
          const treeOptions = args.filter(a => a.startsWith('-'));
          result = await unix.tree?.(treePath, treeOptions);
          if (result) {
            await streams.writeStdout(result);
            if (!result.endsWith('\n')) {
              await streams.writeStdout('\n');
            }
          }
          return { exitCode: 0 };

        case 'stat':
          if (args.length === 0) {
            await streams.writeStderr('stat: missing file operand\n');
            return { exitCode: 1 };
          }
          result = await unix.stat?.(args[0]);
          if (result) {
            await streams.writeStdout(result);
            if (!result.endsWith('\n')) {
              await streams.writeStdout('\n');
            }
          }
          return { exitCode: 0 };

        case 'help':
          result = await unix.help?.(args[0]);
          if (result) {
            await streams.writeStdout(result);
            if (!result.endsWith('\n')) {
              await streams.writeStdout('\n');
            }
          }
          return { exitCode: 0 };

        default:
          // Try to find command as a function on unix object
          if (typeof (unix as any)[command] === 'function') {
            try {
              result = await (unix as any)[command](...args);
              if (result !== undefined && result !== null) {
                await streams.writeStdout(String(result));
                if (!String(result).endsWith('\n')) {
                  await streams.writeStdout('\n');
                }
              }
              return { exitCode: 0 };
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              await streams.writeStderr(`${command}: ${msg}\n`);
              return { exitCode: 1 };
            }
          }

          // Command not found in unix commands
          await streams.writeStderr(`${command}: command not found\n`);
          return { exitCode: 127 };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await streams.writeStderr(`${command}: ${message}\n`);
      return { exitCode: 1 };
    }
  }

  /**
   * Execute using unix handler (fallback)
   */
  private async executeWithHandler(
    command: string,
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    try {
      // Import the unified unix handler
      const { handleUnixCommand } = await import('../../handlers/unixHandler');

      // Collect stdin if available
      let stdinContent: string | null = null;
      try {
        const chunks: string[] = [];
        const stdin = streams.stdin as any;
        if (stdin && typeof stdin.on === 'function') {
          await new Promise<void>((resolve) => {
            const onData = (chunk: any) => chunks.push(String(chunk));
            const onEnd = () => {
              stdin.off('data', onData);
              resolve();
            };
            stdin.on('data', onData);
            stdin.once('end', onEnd);
            stdin.once('close', onEnd);
            // Timeout to avoid hanging
            setTimeout(() => {
              stdin.off('data', onData);
              resolve();
            }, 50);
          });
          if (chunks.length > 0) {
            stdinContent = chunks.join('');
          }
        }
      } catch {
        // Ignore stdin errors
      }

      // Execute through unix handler
      const result = await handleUnixCommand(
        command,
        args,
        context.projectName,
        context.projectId,
        async (output: string) => {
          await streams.writeStdout(output);
        },
        async (errOutput: string) => {
          await streams.writeStderr(errOutput);
        },
        stdinContent
      );

      // Write any remaining output
      if (result.output) {
        const outStr = String(result.output).trimEnd();
        if (outStr) {
          if (result.code !== 0) {
            await streams.writeStderr(outStr);
          } else {
            await streams.writeStdout(outStr);
          }
        }
      }

      return { exitCode: result.code };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await streams.writeStderr(`${command}: ${message}\n`);
      return { exitCode: 127 };
    }
  }

  async complete(partial: string, _context: IExecutionContext): Promise<CompletionResult[]> {
    const commands = this.getSupportedCommands();

    return commands
      .filter(cmd => cmd.startsWith(partial))
      .map(cmd => ({
        text: cmd,
        type: 'command' as const,
        description: this.getCommandDescription(cmd),
      }));
  }

  private getCommandDescription(cmd: string): string {
    const descriptions: Record<string, string> = {
      // Core file operations
      ls: 'List directory contents',
      cat: 'Display file contents',
      cp: 'Copy files/directories',
      mv: 'Move files/directories',
      rm: 'Remove files/directories',
      mkdir: 'Create directory',
      rmdir: 'Remove directory',
      touch: 'Create empty file or update timestamp',
      ln: 'Create links',
      // File inspection
      head: 'Display first lines',
      tail: 'Display last lines',
      stat: 'Display file status',
      file: 'Determine file type',
      wc: 'Count lines, words, bytes',
      // Search and filter
      grep: 'Search for patterns',
      find: 'Find files',
      tree: 'Display directory tree',
      // Archive
      unzip: 'Extract ZIP archive',
      tar: 'Archive utility',
      // Permissions
      chmod: 'Change file permissions',
      chown: 'Change file owner',
      // Utilities
      date: 'Display date and time',
      whoami: 'Display current user',
      hostname: 'Display hostname',
      uname: 'Display system information',
      help: 'Show help',
      clear: 'Clear terminal',
      history: 'Show command history',
      // Runtime
      node: 'Run JavaScript',
      sh: 'Run shell script',
      bash: 'Run bash script',
      npx: 'Run npm package',
      // Editors
      vim: 'Edit file with vim',
      vi: 'Edit file with vi',
      nano: 'Edit file with nano',
      ed: 'Line editor',
    };
    return descriptions[cmd] || 'External command';
  }

  async getHelp(command: string): Promise<string> {
    const helpTexts: Record<string, string> = {
      ls: 'ls [OPTIONS] [PATH] - List directory contents\n  -l  Long format\n  -a  Show hidden files\n  -h  Human readable sizes',
      cd: 'cd [DIR] - Change the current directory',
      pwd: 'pwd - Print the current working directory',
      mkdir: 'mkdir [OPTIONS] DIR - Create directory\n  -p  Create parent directories',
      touch: 'touch FILE - Create empty file or update timestamp',
      rm: 'rm [OPTIONS] FILE... - Remove files/directories\n  -r  Recursive\n  -f  Force',
      cp: 'cp [OPTIONS] SOURCE DEST - Copy files/directories\n  -r  Recursive',
      mv: 'mv SOURCE DEST - Move or rename files/directories',
      cat: 'cat FILE - Display file contents',
      echo: 'echo [TEXT] - Display text',
      head: 'head [OPTIONS] FILE - Display first lines\n  -n N  Show first N lines',
      tail: 'tail [OPTIONS] FILE - Display last lines\n  -n N  Show last N lines',
      grep: 'grep [OPTIONS] PATTERN [FILE...] - Search for patterns\n  -i  Case insensitive\n  -n  Show line numbers',
      find: 'find [PATH] [OPTIONS] - Find files\n  -name PATTERN  Match filename\n  -type f|d  File type',
      tree: 'tree [PATH] - Display directory tree',
      stat: 'stat FILE - Display file status',
      unzip: 'unzip ARCHIVE [DEST] - Extract ZIP archive',
      node: 'node [FILE] [ARGS...] - Run JavaScript file',
      sh: 'sh FILE [ARGS...] - Run shell script',
      bash: 'bash FILE [ARGS...] - Run bash script',
      npx: 'npx COMMAND [ARGS...] - Run npm package binary',
      clear: 'clear - Clear terminal screen',
      history: 'history [clear] - Show or clear command history',
      vim: 'vim FILE - Edit file with vim',
      help: 'help [COMMAND] - Show help for command',
    };

    return helpTexts[command] || `${command}: external command`;
  }

  async dispose(): Promise<void> {
    this.unixCommands = null;
  }
}

/**
 * Create a new external command provider
 */
export function createExternalProvider(): ExternalCommandProvider {
  return new ExternalCommandProvider();
}
