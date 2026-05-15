import { PassThrough } from 'node:stream';
import { Buffer } from './bufferModule';
import { createEventsModule } from './eventsModule';

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

export interface ChildProcessModuleOptions {
  runShell?: (command: string, options?: RunShellOptions) => Promise<RunShellResult>;
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

const { EventEmitter } = createEventsModule();
const EventEmitterBase = EventEmitter as unknown as new () => {
  emit(event: string | symbol, ...args: unknown[]): boolean;
  on(event: string | symbol, listener: (...args: unknown[]) => void): unknown;
  listenerCount(event: string | symbol): number;
};

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
  if (encoding === 'buffer' || encoding === null) {
    return Buffer.from(value);
  }
  return value;
}

function commandLineForExecFile(
  file: string,
  args: readonly string[],
  options: ExecOptions
): string {
  const command = [file, ...args].map(shQuote).join(' ');
  if (options.shell) return command;
  return command;
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

class BrowserChildProcess extends EventEmitterBase {
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

function createNotSupportedResult(command: string, encoding: Encoding | undefined) {
  const error = createError(
    `spawnSync ${command} is not supported in the browser runtime`,
    'ENOSYS',
    { errno: -38, syscall: 'spawnSync', path: command }
  );
  return {
    pid: 0,
    output: [null, toOutput('', encoding), toOutput(String(error.message), encoding)],
    stdout: toOutput('', encoding),
    stderr: toOutput(String(error.message), encoding),
    status: null,
    signal: null,
    error,
  };
}

function simulateSync(command: string, args: string[], options: ExecOptions) {
  const encoding = options.encoding;
  const joined = [command, ...args].join(' ');
  let stdout = '';
  const stderr = '';
  let status = 0;
  let error: Error | undefined;

  if (command === 'node' || command.endsWith('/node')) {
    if (args.includes('-v') || args.includes('--version')) stdout = 'v18.0.0\n';
    else return createNotSupportedResult(command, encoding);
  } else if (command === 'npm') {
    if (args.includes('-v') || args.includes('--version')) stdout = '10.0.0\n';
    else return createNotSupportedResult(command, encoding);
  } else if (command === 'true') {
    status = 0;
  } else if (command === 'false') {
    status = 1;
  } else if (command === 'pwd') {
    stdout = `${options.cwd || '/'}\n`;
  } else if (command === 'echo') {
    stdout = `${args.join(' ')}\n`;
  } else if (command === 'uname') {
    stdout = 'Browser\n';
  } else if (command === 'which' || joined.startsWith('command -v ')) {
    const target = command === 'which' ? args[0] : args[1];
    if (target) stdout = `/usr/bin/${target}\n`;
    else status = 1;
  } else {
    return createNotSupportedResult(command, encoding);
  }

  if (status !== 0) {
    error = createError(`Command failed: ${joined}`, status, { status });
  }

  return {
    pid: 0,
    output: [null, toOutput(stdout, encoding), toOutput(stderr, encoding)],
    stdout: toOutput(stdout, encoding),
    stderr: toOutput(stderr, encoding),
    status,
    signal: null,
    error,
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

    promise.catch(error => {
      finishWithError(error instanceof Error ? error : createError(String(error)));
    });
    track?.(promise.then(() => {}));
    return child;
  };

  const spawn = (
    command: string,
    argsOrOptions?: readonly unknown[] | SpawnOptions,
    maybeOptions?: SpawnOptions
  ) => {
    const args = normalizeArgs(argsOrOptions);
    const spawnOptions = normalizeOptions<SpawnOptions>(
      Array.isArray(argsOrOptions) ? maybeOptions : (argsOrOptions as SpawnOptions | undefined),
      { encoding: 'utf8' }
    );
    const child = new BrowserChildProcess(command, args);
    const commandLine = commandLineForExecFile(command, args, spawnOptions);
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
      Array.isArray(argsOrOptions)
        ? optionsOrCallback
        : (argsOrOptions as ExecOptions | Encoding | undefined),
      { encoding: 'utf8' }
    );
    const callback = getCallback(argsOrOptions, optionsOrCallback, maybeCallback);
    const child = new BrowserChildProcess(file, args);
    return start(child, commandLineForExecFile(file, args, execOptions), execOptions, callback);
  };

  const spawnSync = (
    command: string,
    argsOrOptions?: readonly unknown[] | ExecOptions,
    maybeOptions?: ExecOptions
  ) => {
    const args = normalizeArgs(argsOrOptions);
    const syncOptions = normalizeOptions<ExecOptions>(
      Array.isArray(argsOrOptions) ? maybeOptions : (argsOrOptions as ExecOptions | undefined),
      { encoding: 'buffer', cwd: getCwd(), env: getEnv() }
    );
    return simulateSync(command, args, syncOptions);
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
    const parts = command.trim().split(/\s+/);
    const result = simulateSync(parts[0] || command, parts.slice(1), execOptions);
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
