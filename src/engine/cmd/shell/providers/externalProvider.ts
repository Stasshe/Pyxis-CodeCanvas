/**
 * External Command Provider
 * Delegates to existing handlers/unixHandler.ts for Unix command execution.
 * Handles filesystem commands, scripts, and node_modules/.bin executables.
 */

import type {
  CommandProvider,
  ExecutionResult,
  IExecutionContext,
  IStreamManager,
} from './types';
import { ProviderType } from './types';
import { handleUnixCommand } from '../../handlers/unixHandler';

/**
 * External Command Provider Implementation
 * This is a thin wrapper that delegates to the existing unixHandler.
 */
export class ExternalCommandProvider implements CommandProvider {
  readonly id = 'pyxis.provider.external';
  readonly type = ProviderType.EXTERNAL;
  readonly priority = 10; // Lowest priority - fallback provider
  readonly cacheTTL = 0;

  private projectId: string = '';
  private projectName: string = '';

  // Known Unix/shell commands that unixHandler can process
  private readonly knownCommands = new Set([
    // Unix commands
    'ls', 'cd', 'pwd', 'mkdir', 'touch', 'rm', 'cp', 'mv', 'cat', 'echo',
    'head', 'tail', 'grep', 'find', 'tree', 'stat', 'unzip', 'rename',
    'chmod', 'chown', 'ln', 'date', 'whoami', 'help',
    // Runtime commands
    'sh', 'bash',
    // Other
    'npx', 'clear', 'history', 'vim',
  ]);

  async initialize(projectId: string, context?: IExecutionContext): Promise<void> {
    this.projectId = projectId;
    this.projectName = context?.projectName || '';
  }

  async canHandle(command: string, context: IExecutionContext): Promise<boolean> {
    if (this.knownCommands.has(command)) {
      return true;
    }

    // Check for script files (.sh)
    if (command.endsWith('.sh')) {
      return true;
    }

    return false;
  }

  async execute(
    command: string,
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    // Ensure initialized
    if (!this.projectId) {
      this.projectId = context.projectId;
      this.projectName = context.projectName;
    }

    // Create output writers for unixHandler
    const writeOutput = async (output: string) => {
      await streams.writeStdout(output);
    };

    const writeError = async (err: string) => {
      await streams.writeStderr(err);
    };

    // Collect stdin if available
    let stdinContent: string | null = null;
    try {
      const stdin = streams.stdin as any;
      if (stdin && typeof stdin.read === 'function') {
        const chunks: string[] = [];
        let chunk: any;
        while ((chunk = stdin.read()) !== null) {
          chunks.push(String(chunk));
        }
        if (chunks.length > 0) {
          stdinContent = chunks.join('');
        }
      }
    } catch {
      // Ignore stdin errors
    }

    try {
      // Delegate to existing unixHandler
      const result = await handleUnixCommand(
        command,
        args,
        this.projectName,
        this.projectId,
        writeOutput,
        writeError,
        stdinContent
      );

      return { exitCode: result.code };
    } catch (e: any) {
      if (e && e.__silent) {
        return { exitCode: typeof e.code === 'number' ? e.code : 1 };
      }
      const msg = e && e.message ? String(e.message) : String(e);
      await streams.writeStderr(`${command}: ${msg}\n`);
      return { exitCode: 1 };
    }
  }

  async getHelp(command: string): Promise<string> {
    const helpTexts: Record<string, string> = {
      ls: 'ls [OPTIONS] [PATH] - List directory contents',
      cat: 'cat FILE... - Concatenate and display files',
      grep: 'grep PATTERN [FILE...] - Search for patterns',
      find: 'find [PATH] [OPTIONS] - Find files',
      tree: 'tree [PATH] - Display directory tree',
      mkdir: 'mkdir DIR... - Create directories',
      touch: 'touch FILE... - Create empty files',
      rm: 'rm [OPTIONS] FILE... - Remove files',
      cp: 'cp SOURCE DEST - Copy files',
      mv: 'mv SOURCE DEST - Move files',
      head: 'head [OPTIONS] FILE - Output first part of files',
      tail: 'tail [OPTIONS] FILE - Output last part of files',
      stat: 'stat FILE - Display file status',
      chmod: 'chmod MODE FILE - Change file permissions',
    };
    return helpTexts[command] || '';
  }
}

/**
 * Create a new external command provider
 */
export function createExternalProvider(): ExternalCommandProvider {
  return new ExternalCommandProvider();
}
