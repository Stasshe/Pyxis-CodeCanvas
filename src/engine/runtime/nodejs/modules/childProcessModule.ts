import EventEmitter from 'node:events';
import { PassThrough } from 'node:stream';
import { Buffer } from 'buffer';

type Encoding = BufferEncoding | 'buffer' | null;

interface RunShellOptions {
  cwd?: string;
  env?: Record<string, string>;
}

interface RunShellResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

interface RunShellSyncResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ChildProcessModuleOptions {
  runShell?: (command: string, options?: RunShellOptions) => Promise<RunShellResult>;
  runShellSync?: (command: string, options?: RunShellOptions) => RunShellSyncResult;
  getCwd?: () => string;
  getEnv?: () => Record<string, string>;
  getTrackIO?: () => ((p: Promise<void>) => void) | undefined;
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

function shQuote(value: string): string {
  if (value === '') return "''";
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function toOutput(value: string, encoding: Encoding | undefined): unknown {
  if (encoding === 'buffer' || encoding === null) return Buffer.from(value);
  return value;
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
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdio = [this.stdin, this.stdout, this.stderr];
  pid = BrowserChildProcess.nextPid++;
  killed = false;
  exitCode: number | null = null;
  signalCode: string | null = null;
  spawnfile: string;
  spawnargs: string[];
  connected = false;

  private static nextPid = 1000;

  constructor(file: string, args: string[]) {
    super();
    this.spawnfile = file;
    this.spawnargs = [file, ...args];
  }

  kill(signal = 'SIGTERM'): boolean {
    if (this.exitCode !== null || this.killed) return false;
    this.killed = true;
    this.signalCode = signal;
    this.finish(null, signal);
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
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.stdout.end();
    this.stderr.end();
    this.stdin.end();
    this.emit('exit', code, signal);
    this.emit('close', code, signal);
  }
}

function createSyncResult(
  command: string,
  result: RunShellSyncResult,
  encoding: Encoding | undefined
) {
  const stdout = toOutput(result.stdout, encoding);
  const stderr = toOutput(result.stderr, encoding);
  let error: Error | undefined;
  if (result.exitCode !== 0) {
    error = createError(`Command failed: ${command}`, result.exitCode, {
      status: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
  return {
    pid: 0,
    output: [null, stdout, stderr],
    stdout,
    stderr,
    status: result.exitCode,
    signal: null,
    error,
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
  return createSyncResult(command, result, options.encoding);
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
    (async (command: string) => ({
      stdout: '',
      stderr: `child_process: no shell runner available for ${command}\n`,
      code: 127,
    }));
  const runShellSync = options.runShellSync;

  const start = (
    child: BrowserChildProcess,
    commandLine: string,
    execOptions: ExecOptions,
    callback?: ExecCallback
  ) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finishWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (child.listenerCount('error') > 0) child.emit('error', error);
      callback?.(
        error,
        toOutput('', execOptions.encoding),
        toOutput(String(error.message), execOptions.encoding)
      );
      child.finish(1, null);
    };

    if (execOptions.signal?.aborted) {
      finishWithError(createError('The operation was aborted', 'ABORT_ERR'));
      return child;
    }

    const onAbort = () => {
      child.kill(execOptions.killSignal ?? 'SIGTERM');
      finishWithError(createError('The operation was aborted', 'ABORT_ERR'));
    };
    execOptions.signal?.addEventListener('abort', onAbort, { once: true });

    if (execOptions.timeout && execOptions.timeout > 0) {
      timer = setTimeout(() => {
        child.kill(execOptions.killSignal ?? 'SIGTERM');
        finishWithError(createError(`Command timed out: ${commandLine}`, 'ETIMEDOUT'));
      }, execOptions.timeout);
    }

    const promise = queue.run(async () => {
      child.emit('spawn');
      const result = await runShell(commandLine, {
        cwd: execOptions.cwd ?? getCwd(),
        env: { ...getEnv(), ...(execOptions.env ?? {}) },
      });

      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      execOptions.signal?.removeEventListener('abort', onAbort);

      const stdout = result.stdout ?? '';
      const stderr = result.stderr ?? '';
      const maxBuffer = execOptions.maxBuffer ?? DEFAULT_MAX_BUFFER;
      if (stdout.length + stderr.length > maxBuffer) {
        const error = createError(
          'stdout maxBuffer length exceeded',
          'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
        );
        child.stderr.write(String(error.message));
        callback?.(
          error,
          toOutput(stdout, execOptions.encoding),
          toOutput(stderr, execOptions.encoding)
        );
        child.finish(1, null);
        return;
      }

      if (stdout) child.stdout.write(stdout);
      if (stderr) child.stderr.write(stderr);

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
      if (error instanceof Error) finishWithError(error);
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
    const child = new BrowserChildProcess(command, args);
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
    return start(child, command, execOptions, callback);
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
    return start(child, commandLineForExecFile(file, args), execOptions, callback);
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
