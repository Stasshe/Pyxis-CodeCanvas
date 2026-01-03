/**
 * Builtin Command Provider
 * Delegates to existing builtins.ts which already handles:
 * - Unix commands via handleUnixCommand
 * - Shell builtins (test, [, type, etc.)
 * - node command via NodeRuntime
 */

import { PassThrough } from 'stream';
import type {
  CommandProvider,
  ExecutionResult,
  IExecutionContext,
  IStreamManager,
} from './types';
import {
  isShellBuiltin,
  isSpecialBuiltin,
  ProviderType,
} from './types';
import adaptUnixToStream, { type StreamCtx } from '../builtins';
import { terminalCommandRegistry } from '../../terminalRegistry';

/**
 * Builtin Command Provider Implementation
 * This is a thin wrapper that delegates to the existing builtins.ts
 */
export class BuiltinCommandProvider implements CommandProvider {
  readonly id = 'pyxis.provider.builtin';
  readonly type = ProviderType.BUILTIN;
  readonly priority = 100;
  readonly cacheTTL = -1;

  private projectId: string = '';
  private projectName: string = '';
  private builtins: Record<string, any> | null = null;

  async initialize(projectId: string, context?: IExecutionContext): Promise<void> {
    this.projectId = projectId;
    this.projectName = context?.projectName || '';
    
    // Get UnixCommands and create builtins adapter
    const unix = terminalCommandRegistry.getUnixCommands(this.projectName, this.projectId);
    this.builtins = adaptUnixToStream(unix);
  }

  async canHandle(command: string, _context: IExecutionContext): Promise<boolean> {
    // Check if it's a known shell builtin or special builtin
    if (isShellBuiltin(command) || isSpecialBuiltin(command)) {
      return true;
    }
    
    // Also check if builtins adapter has this command
    if (this.builtins && typeof this.builtins[command] === 'function') {
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
    if (!this.builtins) {
      await this.initialize(context.projectId, context);
    }

    // Create StreamCtx for builtins.ts
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = streams.stdin || new PassThrough();

    const ctx: StreamCtx = {
      stdin: stdin as any,
      stdout,
      stderr,
      onSignal: () => {},
      projectName: context.projectName,
      projectId: context.projectId,
      terminalColumns: 80,
      terminalRows: 24,
    };

    // Pipe output to streams
    stdout.on('data', (chunk) => streams.writeStdout(chunk.toString()));
    stderr.on('data', (chunk) => streams.writeStderr(chunk.toString()));

    // Handle special commands that need context modifications
    if (command === 'cd') {
      return this.handleCd(args, context, streams);
    }

    if (command === 'export') {
      return this.handleExport(args, context, streams);
    }

    if (command === 'unset') {
      return this.handleUnset(args, context, streams);
    }

    if (command === 'exit') {
      return this.handleExit(args, context, streams);
    }

    // Delegate to builtins adapter
    const handler = this.builtins?.[command];
    if (!handler) {
      await streams.writeStderr(`${command}: command not found\n`);
      return { exitCode: 127 };
    }

    try {
      await handler(ctx, args);
      return { exitCode: 0 };
    } catch (e: any) {
      if (e && e.__silent) {
        return { exitCode: typeof e.code === 'number' ? e.code : 1 };
      }
      const msg = e && e.message ? String(e.message) : String(e);
      await streams.writeStderr(`${command}: ${msg}\n`);
      return { exitCode: 1 };
    }
  }

  private async handleCd(
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    if (args.length === 0) {
      context.cwd = '/';
      return { exitCode: 0 };
    }

    const target = args[0];
    let newPath: string;

    if (target.startsWith('/')) {
      newPath = target;
    } else if (target === '..') {
      const parts = context.cwd.split('/').filter(Boolean);
      parts.pop();
      newPath = '/' + parts.join('/');
    } else if (target === '.') {
      newPath = context.cwd;
    } else {
      newPath = context.cwd.replace(/\/$/, '') + '/' + target;
    }

    newPath = newPath.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
    context.cwd = newPath;
    
    return { exitCode: 0 };
  }

  private async handleExport(
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    if (args.length === 0) {
      for (const [key, value] of Object.entries(context.env)) {
        await streams.writeStdout(`export ${key}="${value}"\n`);
      }
      return { exitCode: 0 };
    }

    for (const arg of args) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx > 0) {
        const key = arg.substring(0, eqIdx);
        const value = arg.substring(eqIdx + 1);
        context.setEnv(key, value);
      } else {
        const value = context.getEnv(arg);
        if (value !== undefined) {
          context.setEnv(arg, value);
        }
      }
    }
    return { exitCode: 0 };
  }

  private async handleUnset(
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    for (const name of args) {
      if (!name.startsWith('-')) {
        delete context.env[name];
      }
    }
    return { exitCode: 0 };
  }

  private async handleExit(
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    const code = args.length > 0 ? parseInt(args[0], 10) || 0 : 0;
    return { exitCode: code, metadata: { shouldExit: true } };
  }

  async getHelp(command: string): Promise<string> {
    const helpTexts: Record<string, string> = {
      cd: 'cd [DIR] - Change directory',
      pwd: 'pwd - Print working directory',
      echo: 'echo [ARGS...] - Display arguments',
      export: 'export [NAME=VALUE...] - Set environment variables',
      unset: 'unset NAME... - Remove environment variables',
      exit: 'exit [CODE] - Exit the shell',
      test: 'test EXPR - Evaluate conditional expression',
      '[': '[ EXPR ] - Evaluate conditional expression',
      type: 'type NAME - Display command type',
      node: 'node FILE [ARGS...] - Execute JavaScript file',
    };
    return helpTexts[command] || '';
  }
}

/**
 * Create a new builtin command provider
 */
export function createBuiltinProvider(): BuiltinCommandProvider {
  return new BuiltinCommandProvider();
}
