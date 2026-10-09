import { Buffer } from 'node:buffer';
import type { Readable } from 'node:stream';
import { type FsApi, getFifoApi } from '@/engine/core/fs/index';
import { basename } from '@/engine/core/paths';
import type { UnixCommands } from '../commands/unix/index';
import adaptUnixToStream, { type StreamCtx } from './builtins';
import { SilentCommandError } from './errors';
import { runLocalBinary } from './localBinary';
import { Process, signalExitCode } from './process';
import type { ShellCommandRegistry } from './types';

type ArgvResult = { stdout: string; stderr: string; code: number };
type ExecuteArgv = (argv: readonly string[]) => Promise<ArgvResult>;

export interface AppCommandHandlers {
  pyxis: (
    command: string,
    args: string[],
    rootPath: string,
    writeOutput: (output: string) => Promise<void>
  ) => Promise<void>;
  dev: (
    args: string[],
    rootPath: string,
    writeOutput: (output: string) => Promise<void>
  ) => Promise<void>;
}

let appCommandHandlers: AppCommandHandlers | undefined;

export function configureAppCommandHandlers(handlers: AppCommandHandlers | undefined): void {
  appCommandHandlers = handlers;
}

export interface DispatchOptions {
  rootPath: string;
  cwd: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  fsClient: FsApi;
  terminalColumns: number;
  terminalRows: number;
  commandRegistry?: Pick<ShellCommandRegistry, 'hasCommand' | 'executeCommand'>;
  trackDetachedProcess: (process: Process, completion: Promise<void>) => void;
  getUnix: () => Promise<UnixCommands | null>;
  setPwd: (value: string) => void;
}

export async function dispatchCommand(
  cmd: string,
  args: string[],
  proc: Process,
  options: DispatchOptions
): Promise<number> {
  const executeArgv = createArgvExecutor(proc, options);
  const writeOutput = async (output: string | Uint8Array) => {
    proc.writeStdout(output);
    if (typeof output === 'string' && !output.endsWith('\n')) {
      proc.writeStdout('\n');
    }
  };

  const writeError = async (output: string) => {
    proc.writeStderr(output);
    if (!output.endsWith('\n')) {
      proc.writeStderr('\n');
    }
  };

  if (cmd === 'git') {
    try {
      const { handleGitCommand } = await import('../commands/git/handler');
      let cwd = options.cwd;
      const unix = await options.getUnix();
      if (unix) cwd = await unix.pwd();
      await handleGitCommand(args, cwd, options.fsClient, writeOutput);
      return 0;
    } catch (error) {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      await writeError(`git: ${message}`);
      return 1;
    }
  }

  if (cmd === 'npm') {
    try {
      const { handleNPMCommand } = await import('../commands/npm/handler');
      let cwd = options.cwd;
      const unix = await options.getUnix();
      if (unix) cwd = await unix.pwd();
      return await handleNPMCommand(
        args,
        options.rootPath,
        writeOutput,
        writeError,
        () => {},
        {
          stdout: async output => proc.writeStdout(output),
          stderr: async output => proc.writeStderr(output),
        },
        {
          cwd,
          env: options.env,
          signal: proc.executionSignal(options.signal),
          terminalColumns: options.terminalColumns,
          terminalRows: options.terminalRows,
          stdin: proc.stdinStream,
          stdinDestination: proc.stdinDestination,
          stdinIsTTY: proc.stdinIsTTY,
          stdoutIsTTY: proc.stdoutIsTTY,
          stderrIsTTY: proc.stderrIsTTY,
          onSignal: handler => {
            return proc.handleSignal(handler);
          },
        }
      );
    } catch (error) {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      await writeError(`npm: ${message}`);
      return 1;
    }
  }

  if (cmd === 'npx') {
    try {
      const { handleNPXCommand } = await import('../commands/npm/handler');
      const code = await handleNPXCommand(
        args,
        writeOutput,
        proc.processStdin,
        handler => {
          const listener = (signal: string) => {
            if (signal === 'SIGINT') handler();
          };
          return proc.handleSignal(listener, ['SIGINT']);
        },
        proc.executionSignal(options.signal),
        options.env,
        { stdoutIsTTY: proc.stdoutIsTTY, stderrIsTTY: proc.stderrIsTTY }
      );
      if (typeof code === 'number') return code;
      return 0;
    } catch (error) {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      await writeError(`npx: ${message}`);
      return 1;
    }
  }

  if (cmd === 'pyxis') {
    try {
      if (args.length === 0) {
        await writeError('pyxis: missing subcommand. Usage: pyxis <category> <action> [args]');
        return 1;
      }

      const category = args[0];
      const action = args[1];
      if (!action && !category.startsWith('-')) {
        await writeError('pyxis: missing action. Usage: pyxis <category> <action> [args]');
        return 1;
      }

      let cmdToCall: string;
      let subArgs: string[];
      if (action?.startsWith('-')) {
        cmdToCall = category;
        subArgs = args.slice(1);
      } else if (action) {
        cmdToCall = `${category}-${action}`;
        subArgs = args.slice(2);
      } else {
        cmdToCall = category;
        subArgs = args.slice(1);
      }

      if (!appCommandHandlers) throw new Error('Application command handlers are not configured');
      await appCommandHandlers.pyxis(cmdToCall, subArgs, options.rootPath, writeOutput);
      return 0;
    } catch (error) {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      await writeError(`pyxis: ${message}`);
      return 1;
    }
  }

  if (cmd === 'dev') {
    try {
      if (!appCommandHandlers) throw new Error('Application command handlers are not configured');
      await appCommandHandlers.dev(args, options.rootPath, writeOutput);
      return 0;
    } catch (error) {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      await writeError(`dev: ${message}`);
      return 1;
    }
  }

  if (options.commandRegistry?.hasCommand(cmd)) {
    try {
      const unix = await options.getUnix();
      let currentDir = options.cwd;
      if (unix) currentDir = await unix.pwd();
      const result = await options.commandRegistry.executeCommand(cmd, args, {
        projectName: basename(options.rootPath),
        rootPath: options.rootPath,
        currentDirectory: currentDir,
        fsClient: options.fsClient,
      });
      await writeOutput(result);
      return 0;
    } catch (error) {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      await writeError(`${cmd}: ${message}`);
      return 1;
    }
  }

  const unix = await options.getUnix();
  if (!unix) throw new Error(`Unix command support is unavailable for ${cmd}`);
  const ownerId = `shell-command-${crypto.randomUUID().replaceAll('-', '')}`;
  const commandFs = scopeFilesystem(options.fsClient, ownerId);
  const commandUnix = unix.withFsClient(commandFs);
  const builtin = adaptUnixToStream(commandUnix)[cmd];
  if (builtin) {
    const fifoApi = getFifoApi(commandFs);
    let ownerCleanup: Promise<void> | undefined;
    const closeOwner = () => {
      if (ownerCleanup) return ownerCleanup;
      if (!fifoApi) ownerCleanup = Promise.resolve();
      else ownerCleanup = fifoApi.closeFifos(ownerId);
      return ownerCleanup;
    };
    const cancelOwner = () => {
      void closeOwner().catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        proc.writeStderr(`shell: filesystem cleanup failed: ${message}\n`);
      });
    };
    proc.on('signal', cancelOwner);
    const ctx: StreamCtx = {
      get hasExited() {
        return proc.hasExited;
      },
      stdin: proc.stdinStream,
      stdinRedirected: proc.stdinRedirected,
      processStdin: proc.processStdin,
      stdinIsTTY: proc.stdinIsTTY,
      stdoutIsTTY: proc.stdoutIsTTY,
      stderrIsTTY: proc.stderrIsTTY,
      executeArgv,
      stdout: proc.stdoutStream,
      stderr: proc.stderrStream,
      onSignal: (fn, signals) => {
        return proc.handleSignal(fn, signals);
      },
      signal: proc.executionSignal(options.signal),
      rootPath: options.rootPath,
      env: options.env,
      unix: commandUnix,
      terminalColumns: options.terminalColumns,
      terminalRows: options.terminalRows,
    };

    try {
      await builtin(ctx, args);
      if (cmd === 'cd') {
        const cwd = await commandUnix.pwd();
        unix.setCurrentDir(cwd);
        options.setPwd(cwd);
      }
      return 0;
    } catch (error) {
      if (error instanceof SilentCommandError) return error.code;
      throw error;
    } finally {
      proc.off('signal', cancelOwner);
      await closeOwner();
    }
  }

  let cwd = options.cwd;
  if (unix) cwd = await unix.pwd();
  const localExitCode = await runLocalBinary({
    command: cmd,
    args,
    rootPath: options.rootPath,
    cwd,
    env: options.env,
    fsClient: options.fsClient,
    terminalColumns: options.terminalColumns,
    terminalRows: options.terminalRows,
    process: proc,
    signal: proc.executionSignal(options.signal),
  });
  if (localExitCode !== null) return localExitCode;

  proc.writeStderr(`${cmd}: command not found\n`);
  return 127;
}

function createArgvExecutor(parent: Process, options: DispatchOptions): ExecuteArgv {
  return async argv => {
    const command = argv[0];
    if (!command) return { stdout: '', stderr: 'xargs: empty command\n', code: 2 };

    const child = new Process();
    child.stdoutIsTTY = parent.stdoutIsTTY;
    child.stderrIsTTY = parent.stderrIsTTY;
    child.stdin.end();
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const stdoutDecoder = new TextDecoder();
    const stderrDecoder = new TextDecoder();
    const stdoutCallback = callbackForConsole(parent, parent.stdoutConsoleFd);
    const stderrCallback = callbackForConsole(parent, parent.stderrConsoleFd);
    child.stdout.on('data', (chunk: Buffer | string) => {
      collectOrForward(chunk, parent, stdout, stdoutDecoder, stdoutCallback);
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      collectOrForward(chunk, parent, stderr, stderrDecoder, stderrCallback);
    });
    child.stdout.once('end', () => flushDecoder(parent, stdoutDecoder, stdoutCallback));
    child.stderr.once('end', () => flushDecoder(parent, stderrDecoder, stderrCallback));
    const forwardSignal = (signal: string) => child.kill(signal);
    parent.on('signal', forwardSignal);

    const execution = dispatchCommand(command, [...argv.slice(1)], child, options).catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      child.writeStderr(`${message}\n`);
      return 1;
    });
    const completion = (async (): Promise<ArgvResult> => {
      const commandCode = await execution;
      if (!child.hasExited) child.exit(commandCode);
      const exit = await child.wait();
      await Promise.all([waitForEnd(child.stdout), waitForEnd(child.stderr)]);
      let code = commandCode;
      if (exit.signal) code = signalExitCode(exit.signal);
      else if (exit.code !== null) code = exit.code;
      return {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        code,
      };
    })();
    options.trackDetachedProcess(
      child,
      completion.then(() => undefined)
    );

    let removeParentExitListener = () => {};
    const parentExit = new Promise<{ kind: 'parent-exit'; code: number }>(resolve => {
      const onExit = (code: number | null, signal: string | null) => {
        flushCaptured(stdout, stdoutDecoder, stdoutCallback);
        flushCaptured(stderr, stderrDecoder, stderrCallback);
        let exitCode = code ?? 0;
        if (signal) exitCode = signalExitCode(signal);
        resolve({ kind: 'parent-exit', code: exitCode });
      };
      removeParentExitListener = () => parent.off('exit', onExit);
      parent.once('exit', onExit);
      if (parent.hasExited) {
        const signal = parent.terminationSignal;
        let exitCode = 0;
        if (signal) exitCode = signalExitCode(signal);
        resolve({ kind: 'parent-exit', code: exitCode });
      }
    });
    try {
      const outcome = await Promise.race([
        completion.then(result => ({ kind: 'completed' as const, result })),
        parentExit,
      ]);
      if (outcome.kind === 'completed') return outcome.result;
      return { stdout: '', stderr: '', code: outcome.code };
    } finally {
      parent.off('signal', forwardSignal);
      removeParentExitListener();
    }
  };
}

function waitForEnd(stream: Readable): Promise<void> {
  if (stream.readableEnded) return Promise.resolve();
  return new Promise(resolve => {
    stream.once('end', resolve);
  });
}

function callbackForConsole(
  process: Process,
  descriptor: 1 | 2 | undefined
): ((text: string) => void) | undefined {
  if (descriptor === 1) return process.outputCallbacks?.stdout;
  if (descriptor === 2) return process.outputCallbacks?.stderr;
  return undefined;
}

function collectOrForward(
  chunk: Buffer | string,
  parent: Process,
  output: Buffer[],
  decoder: TextDecoder,
  callback?: (text: string) => void
): void {
  if (!parent.hasExited) {
    output.push(Buffer.from(chunk));
    return;
  }
  if (!callback) return;
  const text = decoder.decode(Buffer.from(chunk), { stream: true });
  if (text) callback(text);
}

function flushCaptured(
  output: Buffer[],
  decoder: TextDecoder,
  callback?: (text: string) => void
): void {
  if (!callback) {
    output.length = 0;
    return;
  }
  const text = decoder.decode(Buffer.concat(output), { stream: true });
  output.length = 0;
  if (text) callback(text);
}

function flushDecoder(
  parent: Process,
  decoder: TextDecoder,
  callback?: (text: string) => void
): void {
  if (!parent.hasExited || !callback) return;
  const text = decoder.decode();
  if (text) callback(text);
}

function scopeFilesystem(fsClient: FsApi, ownerId: string): FsApi {
  if ('scoped' in fsClient && typeof fsClient.scoped === 'function') {
    return fsClient.scoped(ownerId);
  }
  return fsClient;
}
