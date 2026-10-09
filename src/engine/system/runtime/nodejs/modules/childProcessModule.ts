import EventEmitter from 'node:events';
import { PassThrough, type Readable, Writable } from 'node:stream';
import { Buffer } from 'buffer';

type Encoding = BufferEncoding | 'buffer' | null;

interface RunShellOptions {
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  killSignal?: string;
  stdin?: Readable;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

interface RunShellResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

interface RunShellSyncOptions {
  cwd?: string;
  env?: Record<string, string>;
}

interface RunShellSyncResult {
  stdout: string | Uint8Array | number[];
  stderr: string | Uint8Array | number[];
  exitCode: number;
}

export interface ChildProcessModuleOptions {
  runShell?: (command: string, options?: RunShellOptions) => Promise<RunShellResult>;
  runShellSync?: (command: string, options?: RunShellSyncOptions) => RunShellSyncResult;
  getCwd?: () => string;
  getEnv?: () => Record<string, string>;
  getTrackIO?: () => ((p: Promise<void>) => void) | undefined;
  writeStdout?: (data: string | Uint8Array) => void;
  writeStderr?: (data: string | Uint8Array) => void;
  maxParallel?: number;
}

interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  encoding?: Encoding;
  timeout?: number;
  maxBuffer?: number;
  shell?: string | boolean;
  signal?: AbortSignal;
  windowsHide?: boolean;
  killSignal?: string;
}

interface SpawnOptions extends ExecOptions {
  stdio?: unknown;
  detached?: boolean;
}

type ExecCallback = (error: Error | null, stdout: unknown, stderr: unknown) => void;

const DEFAULT_MAX_BUFFER = 1024 * 1024;
const DEFAULT_MAX_PARALLEL = 2;

function normalizeArgs(
  args?: readonly unknown[] | SpawnOptions | ExecCallback | Encoding
): string[] {
  if (!Array.isArray(args)) return [];
  return args.map(arg => String(arg));
}

function normalizeOptions<T extends ExecOptions>(
  value?: T | Encoding | ExecCallback | null,
  fallback: T = {} as T
): T {
  if (!value || typeof value === 'function') return fallback;
  if (typeof value === 'string') {
    return { ...fallback, encoding: value } as T;
  }
  return { ...fallback, ...value };
}

function getCallback(...values: unknown[]): ExecCallback | undefined {
  return values.find((value): value is ExecCallback => typeof value === 'function');
}

function createError(
  message: string,
  code?: string | number,
  extra?: Record<string, unknown>
): Error {
  const err = new Error(message) as Error & Record<string, unknown>;
  if (code !== undefined) err.code = code;
  if (extra) {
    for (const [key, value] of Object.entries(extra)) err[key] = value;
  }
  return err;
}

function createAbortError(signal?: AbortSignal): Error {
  const error = createError('The operation was aborted', 'ABORT_ERR');
  error.name = 'AbortError';
  if (signal) Object.assign(error, { cause: signal.reason });
  return error;
}

async function runShellWithAbort(
  runShell: (command: string, options?: RunShellOptions) => Promise<RunShellResult>,
  command: string,
  options: RunShellOptions
): Promise<RunShellResult> {
  const signal = options.signal;
  if (!signal) return runShell(command, options);
  if (signal.aborted) throw createAbortError(signal);

  let rejectAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(createAbortError(signal));
  });
  const onAbort = () => rejectAbort();
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    const execution = runShell(command, options);
    if (signal.aborted) onAbort();
    return await Promise.race([execution, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function shQuote(value: string): string {
  if (value === '') return "''";
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function toOutput(value: string | Uint8Array | number[], encoding: Encoding | undefined): unknown {
  if (typeof value === 'string' && encoding === undefined) return value;
  const bytes = Buffer.from(value);
  if (encoding === 'buffer' || encoding === null) return bytes;
  return bytes.toString(encoding ?? 'utf8');
}

function commandLineForExecFile(file: string, args: readonly string[]): string {
  return [file, ...args].map(shQuote).join(' ');
}

function selectOptions<T>(
  first: readonly unknown[] | T | undefined,
  second: T | undefined
): T | undefined {
  if (Array.isArray(first)) return second;
  return first as T | undefined;
}

class TaskQueue {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const start = () => {
        this.active++;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            const next = this.queue.shift();
            if (next) next();
          });
      };

      if (this.active < this.limit) start();
      else this.queue.push(start);
    });
  }
}

class BrowserChildProcess extends EventEmitter {
  stdin: Writable | null;
  stdinSource: PassThrough | null;
  stdout: PassThrough | null;
  stderr: PassThrough | null;
  stdio: Array<Writable | PassThrough | null>;
  pid = BrowserChildProcess.nextPid++;
  killed = false;
  exitCode: number | null = null;
  signalCode: string | null = null;
  spawnfile: string;
  spawnargs: string[];
  connected = false;
  private finished = false;
  private abort?: (signal: string) => void;

  private static nextPid = 1000;

  constructor(file: string, args: string[], stdio?: unknown) {
    super();
    const stdinSource = new PassThrough();
    this.stdinSource = stdinSource;
    this.stdin = new Writable({
      write(chunk, encoding, callback) {
        stdinSource.write(chunk, encoding, callback);
      },
      final(callback) {
        stdinSource.end(callback);
      },
      destroy(error, callback) {
        if (!stdinSource.destroyed) stdinSource.end();
        callback(error);
      },
    });
    if (stdio === 'inherit' || this.isInherited(stdio, 0)) {
      this.stdin = null;
      this.stdinSource = null;
      stdinSource.destroy();
    }
    this.stdout = new PassThrough();
    if (stdio === 'inherit' || this.isInherited(stdio, 1)) this.stdout = null;
    this.stderr = new PassThrough();
    if (stdio === 'inherit' || this.isInherited(stdio, 2)) this.stderr = null;
    this.stdio = [this.stdin, this.stdout, this.stderr];
    this.spawnfile = file;
    this.spawnargs = [file, ...args];
  }

  setAbortHandler(abort: (signal: string) => void): void {
    this.abort = abort;
  }

  private isInherited(stdio: unknown, index: number): boolean {
    return Array.isArray(stdio) && stdio[index] === 'inherit';
  }

  kill(signal = 'SIGTERM'): boolean {
    if (this.finished || this.killed) return false;
    this.killed = true;
    this.signalCode = signal;
    this.abort?.(signal);
    return true;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  disconnect(): void {
    this.connected = false;
    this.emit('disconnect');
  }

  send(_message: unknown, callback?: (error: Error | null) => void): boolean {
    callback?.(createError('IPC is not supported in browser child_process', 'ENOSYS'));
    return false;
  }

  finish(code: number | null, signal: string | null = null): void {
    if (this.finished) return;
    this.finished = true;
    this.exitCode = code;
    if (signal !== null) this.signalCode = signal;
    this.stdout?.end();
    this.stderr?.end();
    this.stdin?.destroy();
    this.emit('exit', code, signal);
    this.emit('close', code, signal);
  }
}

function createSyncResult(result: RunShellSyncResult, encoding: Encoding | undefined) {
  const stdout = toOutput(result.stdout, encoding);
  const stderr = toOutput(result.stderr, encoding);
  return {
    pid: 0,
    output: [null, stdout, stderr],
    stdout,
    stderr,
    status: result.exitCode,
    signal: null,
    error: undefined,
  };
}

function commandLineForSync(file: string, args: readonly string[]): string {
  return [file, ...args].map(shQuote).join(' ');
}

function syncResult(
  command: string,
  options: ExecOptions,
  runShellSync: ChildProcessModuleOptions['runShellSync']
) {
  if (!runShellSync) {
    throw createError('Synchronous shell bridge is unavailable.', 'ENOSYS');
  }
  const result = runShellSync(command, {
    cwd: options.cwd,
    env: options.env,
  });
  return createSyncResult(result, options.encoding);
}

function syncShellOptions(
  options: ExecOptions,
  cwd: () => string,
  env: () => Record<string, string>
): ExecOptions {
  return {
    ...options,
    cwd: options.cwd ?? cwd(),
    env: { ...env(), ...(options.env ?? {}) },
  };
}

export function createChildProcessModule(options: ChildProcessModuleOptions = {}) {
  const queue = new TaskQueue(Math.max(1, options.maxParallel ?? DEFAULT_MAX_PARALLEL));
  const getCwd = options.getCwd ?? (() => '/');
  const getEnv = options.getEnv ?? (() => ({}));
  const track = options.getTrackIO?.();

  const runShell =
    options.runShell ??
    (async (command: string, shellOptions?: RunShellOptions) => {
      const stderr = `child_process: no shell runner available for ${command}\n`;
      shellOptions?.onStderr?.(stderr);
      return { stdout: '', stderr, code: 127 };
    });
  const runShellSync = options.runShellSync;

  const start = (
    child: BrowserChildProcess,
    commandLine: string,
    execOptions: ExecOptions,
    callback?: ExecCallback,
    enforceMaxBuffer = false
  ) => {
    let settled = false;
    let externallyAborted = execOptions.signal?.aborted === true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abortController = new AbortController();
    child.setAbortHandler(signal => abortController.abort(signal));
    let outputLength = 0;
    let maxBufferExceeded = false;
    const maxBuffer = execOptions.maxBuffer ?? DEFAULT_MAX_BUFFER;
    const streamedStdout: string[] = [];
    const streamedStderr: string[] = [];

    const onOutput = (data: string, channel: 'stdout' | 'stderr') => {
      outputLength += Buffer.byteLength(data);
      if (enforceMaxBuffer && outputLength > maxBuffer && !maxBufferExceeded) {
        maxBufferExceeded = true;
        abortController.abort('SIGTERM');
      }
      if (channel === 'stdout') {
        streamedStdout.push(data);
        if (child.stdout) child.stdout.write(data);
        else options.writeStdout?.(data);
        return;
      }
      streamedStderr.push(data);
      if (child.stderr) child.stderr.write(data);
      else options.writeStderr?.(data);
    };

    const onAbort = () => {
      externallyAborted = true;
      child.kill(execOptions.killSignal ?? 'SIGTERM');
      finishWithError(createAbortError(execOptions.signal));
    };

    const clearRunState = () => {
      if (timer) clearTimeout(timer);
      execOptions.signal?.removeEventListener('abort', onAbort);
    };

    const finishWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearRunState();
      let callbackError = error;
      if (maxBufferExceeded) {
        callbackError = createError(
          'stdout maxBuffer length exceeded',
          'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
        );
      }
      if (child.listenerCount('error') > 0) child.emit('error', callbackError);
      callback?.(
        callbackError,
        toOutput(streamedStdout.join(''), execOptions.encoding),
        toOutput(streamedStderr.join(''), execOptions.encoding)
      );
      let exitCode: number | null = 1;
      if (!maxBufferExceeded && child.signalCode !== null) exitCode = null;
      child.finish(exitCode, child.signalCode);
    };

    const finishAborted = () => {
      if (settled) return;
      settled = true;
      clearRunState();
      const error = createAbortError(execOptions.signal);
      if (externallyAborted && child.listenerCount('error') > 0) child.emit('error', error);
      callback?.(
        error,
        toOutput(streamedStdout.join(''), execOptions.encoding),
        toOutput(streamedStderr.join(''), execOptions.encoding)
      );
      const signal = child.signalCode ?? String(abortController.signal.reason ?? 'SIGTERM');
      child.finish(null, signal);
    };

    if (execOptions.signal?.aborted) {
      abortController.abort(execOptions.killSignal ?? 'SIGTERM');
      queueMicrotask(() => {
        child.emit('spawn');
        finishAborted();
      });
      return child;
    }

    execOptions.signal?.addEventListener('abort', onAbort, { once: true });

    if (execOptions.timeout && execOptions.timeout > 0) {
      timer = setTimeout(() => {
        child.kill(execOptions.killSignal ?? 'SIGTERM');
        finishWithError(createError(`Command timed out: ${commandLine}`, 'ETIMEDOUT'));
      }, execOptions.timeout);
    }

    const promise = queue.run(async () => {
      await new Promise<void>(resolve => queueMicrotask(resolve));
      child.emit('spawn');
      if (abortController.signal.aborted) {
        finishAborted();
        return;
      }
      const result = await runShellWithAbort(runShell, commandLine, {
        cwd: execOptions.cwd ?? getCwd(),
        env: { ...getEnv(), ...(execOptions.env ?? {}) },
        signal: abortController.signal,
        killSignal: execOptions.killSignal ?? 'SIGTERM',
        stdin: child.stdinSource ?? undefined,
        onStdout: data => onOutput(data, 'stdout'),
        onStderr: data => onOutput(data, 'stderr'),
      });

      if (settled) return;
      clearRunState();

      const stdout = result.stdout ?? '';
      const stderr = result.stderr ?? '';
      if (maxBufferExceeded) {
        settled = true;
        const error = createError(
          'stdout maxBuffer length exceeded',
          'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
        );
        callback?.(
          error,
          toOutput(stdout, execOptions.encoding),
          toOutput(stderr, execOptions.encoding)
        );
        child.finish(1, null);
        return;
      }

      if (abortController.signal.aborted && !maxBufferExceeded) {
        finishAborted();
        return;
      }

      settled = true;
      const code = result.code ?? 0;
      const error =
        code === 0
          ? null
          : createError(`Command failed: ${commandLine}`, code, {
              code,
              stdout,
              stderr,
            });
      callback?.(
        error,
        toOutput(stdout, execOptions.encoding),
        toOutput(stderr, execOptions.encoding)
      );
      child.finish(code, null);
    });

    const handledTask = promise.catch(error => {
      if (abortController.signal.aborted && !maxBufferExceeded) finishAborted();
      else if (error instanceof Error) finishWithError(error);
      else finishWithError(createError(String(error)));
    });
    track?.(handledTask);
    return child;
  };

  const spawn = (
    command: string,
    argsOrOptions?: readonly unknown[] | SpawnOptions,
    maybeOptions?: SpawnOptions
  ) => {
    const args = normalizeArgs(argsOrOptions);
    const spawnOptions = normalizeOptions<SpawnOptions>(
      selectOptions(argsOrOptions, maybeOptions),
      { encoding: 'utf8' }
    );
    const child = new BrowserChildProcess(command, args, spawnOptions.stdio);
    const commandLine = commandLineForExecFile(command, args);
    return start(child, commandLine, spawnOptions);
  };

  const exec = (
    command: string,
    optionsOrCallback?: ExecOptions | Encoding | ExecCallback,
    maybeCallback?: ExecCallback
  ) => {
    const execOptions = normalizeOptions<ExecOptions>(optionsOrCallback, { encoding: 'utf8' });
    const callback = getCallback(optionsOrCallback, maybeCallback);
    const child = new BrowserChildProcess(command, []);
    return start(child, command, execOptions, callback, true);
  };

  const execFile = (
    file: string,
    argsOrOptions?: readonly unknown[] | ExecOptions | Encoding | ExecCallback,
    optionsOrCallback?: ExecOptions | Encoding | ExecCallback,
    maybeCallback?: ExecCallback
  ) => {
    const args = normalizeArgs(argsOrOptions);
    const execOptions = normalizeOptions<ExecOptions>(
      selectOptions(argsOrOptions, optionsOrCallback),
      { encoding: 'utf8' }
    );
    const callback = getCallback(argsOrOptions, optionsOrCallback, maybeCallback);
    const child = new BrowserChildProcess(file, args);
    return start(child, commandLineForExecFile(file, args), execOptions, callback, true);
  };

  const spawnSync = (
    command: string,
    argsOrOptions?: readonly unknown[] | ExecOptions,
    maybeOptions?: ExecOptions
  ) => {
    const args = normalizeArgs(argsOrOptions);
    const syncOptions = normalizeOptions<ExecOptions>(selectOptions(argsOrOptions, maybeOptions), {
      encoding: 'buffer',
      cwd: getCwd(),
      env: getEnv(),
    });
    const commandLine = commandLineForSync(command, args);
    return syncResult(commandLine, syncShellOptions(syncOptions, getCwd, getEnv), runShellSync);
  };

  const execFileSync = (
    file: string,
    argsOrOptions?: readonly unknown[] | ExecOptions,
    maybeOptions?: ExecOptions
  ) => {
    const result = spawnSync(file, argsOrOptions, maybeOptions);
    if (result.error) throw result.error;
    if (result.status && result.status !== 0) {
      throw createError(`Command failed: ${file}`, result.status, result);
    }
    return result.stdout;
  };

  const execSync = (command: string, options?: ExecOptions | Encoding) => {
    const execOptions = normalizeOptions<ExecOptions>(options, {
      encoding: 'buffer',
      cwd: getCwd(),
      env: getEnv(),
    });
    const result = syncResult(command, syncShellOptions(execOptions, getCwd, getEnv), runShellSync);
    if (result.error) throw result.error;
    if (result.status && result.status !== 0) {
      throw createError(`Command failed: ${command}`, result.status, result);
    }
    return result.stdout;
  };

  const fork = (
    modulePath: string,
    argsOrOptions?: readonly unknown[] | SpawnOptions,
    maybeOptions?: SpawnOptions
  ) => {
    const args = normalizeArgs(argsOrOptions);
    return spawn('node', [modulePath, ...args], maybeOptions ?? {});
  };

  return {
    ChildProcess: BrowserChildProcess,
    spawn,
    exec,
    execFile,
    fork,
    spawnSync,
    execFileSync,
    execSync,
  };
}
