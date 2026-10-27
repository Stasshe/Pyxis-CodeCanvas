import EventEmitter from 'node:events';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import { signalConstants } from '@/engine/system/runtime/nodejs/signalConstants';
import { ProcessStdin } from '../terminal/terminalProcessBridge';
import type { OutputCallbacks } from './types';

/**
 * Process - Stream-based process abstraction
 * Provides stdin/stdout/stderr streams and signal handling
 */
export type ProcExit = { code: number | null; signal?: string | null };

export class Process extends EventEmitter {
  private static nextPid = 3;

  static allocatePid(): number {
    return Process.nextPid++;
  }

  public stdin: Writable;
  public stdout: Readable;
  public stderr: Readable;
  private _stdin: PassThrough;
  private inputSource?: Readable;
  private inputDestination?: Writable;
  private _stdout: PassThrough;
  private _stderr: PassThrough;
  // map of additional file-descriptor write streams (1 and 2 point to stdout/stderr)
  private _fdMap: Map<number, PassThrough>;
  public pid: number;
  public stdinRedirected = false;
  public stdinIsTTY = false;
  public stdoutIsTTY = false;
  public stderrIsTTY = false;
  public outputCallbacks?: OutputCallbacks;
  public stdoutConsoleFd?: 1 | 2;
  public stderrConsoleFd?: 1 | 2;
  private inputAdapter?: ProcessStdin;
  private exited = false;
  private exitSignal: string | null = null;
  private ioCompleted = false;
  private ioTerminationSignal?: string;
  private wasInterrupted = false;
  private readonly signalHandlers = new Set<{ signals?: readonly string[] }>();
  private readonly executionAbort = new AbortController();
  private readonly cleanupTasks: Promise<PromiseSettledResult<void>>[] = [];
  private readonly ioCleanupTasks: Array<() => Promise<void>> = [];
  private ioCleanupCompletion?: Promise<void>;
  private started = false;
  private exitPromise: Promise<ProcExit>;
  private resolveExit!: (r: ProcExit) => void;

  constructor(pid = Process.allocatePid()) {
    super();
    this._stdin = new PassThrough();
    this._stdout = new PassThrough();
    this._stderr = new PassThrough();
    this._fdMap = new Map();
    // fd 1 -> stdout, fd 2 -> stderr
    this._fdMap.set(1, this._stdout);
    this._fdMap.set(2, this._stderr);
    this.stdin = this._stdin;
    this.stdout = this._stdout;
    this.stderr = this._stderr;
    this.pid = pid;
    this.exitPromise = new Promise(resolve => {
      this.resolveExit = resolve;
    });
  }

  // Return a writable stream for the given fd. Creates a PassThrough for unknown fds.
  getFdWrite(fd: number): PassThrough {
    if (!this._fdMap.has(fd)) {
      const p = new PassThrough();
      this._fdMap.set(fd, p);
    }
    return this._fdMap.get(fd)!;
  }

  // expose internal streams where needed
  get stdinStream(): Readable {
    if (this.inputSource) return this.inputSource;
    return this._stdin;
  }

  setInputSource(source: Readable, destination?: Writable): void {
    this.inputSource = source;
    this.inputDestination = destination;
  }

  get stdinDestination(): Writable {
    if (this.inputDestination) return this.inputDestination;
    return this.stdin;
  }

  get processStdin(): ProcessStdin {
    if (!this.inputAdapter) {
      this.inputAdapter = new ProcessStdin(
        this.stdinStream,
        this.stdinIsTTY,
        this.stdinDestination
      );
    }
    return this.inputAdapter;
  }

  get hasExited(): boolean {
    return this.exited;
  }

  get hasStarted(): boolean {
    return this.started;
  }

  get ioSignal(): string | undefined {
    return this.ioTerminationSignal;
  }

  get terminationSignal(): string | null {
    return this.exitSignal;
  }

  markStarted(): void {
    this.started = true;
  }

  deferIOCleanup(cleanup: () => Promise<void>): void {
    if (this.ioCleanupCompletion) {
      throw new Error('Cannot defer process IO cleanup after IO completion started.');
    }
    this.ioCleanupTasks.push(cleanup);
  }

  completeIO(): Promise<void> {
    if (!this.ioCleanupCompletion) {
      const tasks = this.ioCleanupTasks.splice(0);
      this.ioCleanupCompletion = Promise.allSettled(tasks.map(task => Promise.resolve().then(task)))
        .then(results => {
          const failure = results.find(result => result.status === 'rejected');
          if (failure?.status === 'rejected') throw failure.reason;
        })
        .finally(() => {
          this.ioCompleted = true;
          this.emit('io-complete');
        });
    }
    return this.ioCleanupCompletion;
  }

  get interrupted(): boolean {
    return this.wasInterrupted;
  }

  get stdoutStream() {
    return this._stdout;
  }

  get stderrStream() {
    return this._stderr;
  }

  writeStdout(chunk: string | Uint8Array) {
    if (this.exited) return;
    this._stdout.write(chunk);
  }

  writeStderr(chunk: string | Uint8Array) {
    if (this.exited) return;
    this._stderr.write(chunk);
  }

  endStdout() {
    this._stdout.end();
  }

  endStderr() {
    this._stderr.end();
  }

  async wait(): Promise<ProcExit> {
    const result = await this.exitPromise;
    const cleanupResults = await Promise.all(this.cleanupTasks);
    const failure = cleanupResults.find(cleanup => cleanup.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return result;
  }

  trackCleanup(cleanup: Promise<void>): void {
    this.cleanupTasks.push(
      cleanup.then<PromiseSettledResult<void>, PromiseSettledResult<void>>(
        () => ({ status: 'fulfilled', value: undefined }),
        reason => ({ status: 'rejected', reason })
      )
    );
  }

  executionSignal(parent?: AbortSignal): AbortSignal {
    if (parent) return AbortSignal.any([this.executionAbort.signal, parent]);
    return this.executionAbort.signal;
  }

  handleSignal(handler: (signal: string) => void, signals?: readonly string[]): () => void {
    const registration = { signals };
    const listener = (signal: string) => {
      if (signals && !signals.includes(signal)) return;
      handler(signal);
    };
    this.signalHandlers.add(registration);
    this.on('signal', listener);
    return () => {
      this.signalHandlers.delete(registration);
      this.off('signal', listener);
    };
  }

  exit(code: number | null = 0, signal: string | null = null) {
    if (this.exited) return;
    this.exited = true;
    this.exitSignal = signal;
    this.executionAbort.abort(signal);
    this.inputAdapter?.endSession();
    // end streams
    try {
      this._stdin.end();
    } catch {}
    for (const stream of new Set(this._fdMap.values())) stream.end();
    this.resolveExit({ code, signal });
    this.emit('exit', code, signal);
  }

  kill(signal = 'SIGINT') {
    if (this.exited) {
      if (
        !this.started ||
        this.ioCompleted ||
        this.exitSignal !== null ||
        this.ioTerminationSignal
      ) {
        return;
      }
      this.ioTerminationSignal = signal;
      if (signal === 'SIGINT') this.wasInterrupted = true;
      this.emit('io-signal', signal);
      return;
    }
    if (signal === 'SIGINT') this.wasInterrupted = true;
    const handled = [...this.signalHandlers].some(
      registration => !registration.signals || registration.signals.includes(signal)
    );
    this.emit('signal', signal);
    if (!handled) this.exit(null, signal);
  }
}

export function signalExitCode(signal: string): number {
  if (!isSignalName(signal)) return 1;
  const number = signalConstants[signal];
  if (number === undefined) return 1;
  return 128 + number;
}

function isSignalName(signal: string): signal is keyof typeof signalConstants {
  return Object.hasOwn(signalConstants, signal);
}
