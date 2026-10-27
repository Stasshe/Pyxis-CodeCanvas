import type { Readable } from 'node:stream';
import { Buffer } from 'buffer';
import { format } from 'node-inspect-extracted';
import { RuntimeBridge, RuntimeBridgeClosedError } from '../bridge/client';
import type { RuntimeExecutionResult } from '../core/RuntimeProvider';
import { setRuntimeLogSink } from '../core/runtimeLogger';
import { RuntimeFsMount } from '../fs/RuntimeFsMount';
import { isRetiredRuntimePromise, NodeRuntime } from './nodeRuntime';
import { isProcessExitSignal } from './processExit';
import { nativeClearTimeout, nativeSetTimeout } from './runtimeGlobals';
import type {
  MainMessage,
  OutputChannel,
  OutputEntry,
  ShellResult,
  WorkerMessage,
} from './workerProtocol';
import { WorkerStdin } from './workerStdin';

const worker = self;
interface Execution {
  runtimeId: string;
  runtime?: NodeRuntime;
  stdin?: WorkerStdin;
  bridge?: RuntimeBridge;
  benchmark?: { report(): string; dispose(): void };
  entries: OutputEntry[];
  flushTimer?: ReturnType<typeof setTimeout>;
  shellRequests: Map<number, ShellRequest>;
}

interface ShellRequest {
  resolve: (result: ShellResult) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  stdin?: Readable;
  onStdinData?: (chunk: Buffer | string) => void;
  onStdinEnd?: () => void;
}

let execution: Execution | undefined;
let shellId = 0;
let poisoned = false;

function isRuntimeBridgeClosedError(error: unknown): error is RuntimeBridgeClosedError {
  return (
    typeof RuntimeBridgeClosedError === 'function' && error instanceof RuntimeBridgeClosedError
  );
}

function post(message: WorkerMessage): void {
  worker.postMessage(message);
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.stack) return error.stack;
  return String(error);
}

function shellSignal(signal?: AbortSignal): string | undefined {
  if (typeof signal?.reason === 'string') return signal.reason;
  return undefined;
}

function removeShellRequest(run: Execution, id: number): ShellRequest | undefined {
  const request = run.shellRequests.get(id);
  if (!request) return undefined;
  request.stdin?.pause();
  request.signal?.removeEventListener('abort', request.onAbort!);
  request.stdin?.removeListener('data', request.onStdinData!);
  request.stdin?.removeListener('end', request.onStdinEnd!);
  run.shellRequests.delete(id);
  return request;
}

function handleRuntimeFailure(run: Execution, error: unknown): void {
  if (isProcessExitSignal(error)) {
    finish(run, { exitCode: error.code });
    return;
  }
  try {
    if (run.runtime?.handleUncaughtException?.(error)) return;
  } catch (listenerError) {
    error = listenerError;
  }
  if (isProcessExitSignal(error)) {
    finish(run, { exitCode: error.code });
    return;
  }
  finish(run, { exitCode: 1, stderr: formatError(error) });
}

function flush(run: Execution): void {
  nativeClearTimeout(run.flushTimer);
  run.flushTimer = undefined;
  if (run.entries.length === 0) return;
  post({ type: 'output', entries: run.entries.splice(0) });
}

function enqueue(run: Execution, entry: OutputEntry): void {
  if (execution !== run) return;
  run.entries.push(entry);
  if (run.entries.length >= 128) flush(run);
  else if (run.flushTimer === undefined) run.flushTimer = nativeSetTimeout(() => flush(run), 8);
}

function output(
  run: Execution,
  channel: Exclude<OutputChannel, 'debug' | 'stdout' | 'stderr'>,
  text: string
): void {
  enqueue(run, { channel, text });
}

function finish(run: Execution, result: RuntimeExecutionResult): void {
  if (execution !== run) return;
  let finalResult = result;
  const benchmark = run.benchmark;
  run.benchmark = undefined;
  try {
    if (benchmark) enqueue(run, { channel: 'stdout', text: benchmark.report() });
  } catch (error) {
    finalResult = { exitCode: 1, stderr: formatError(error) };
  } finally {
    benchmark?.dispose();
  }
  run.runtime?.dispose();
  run.stdin?.dispose();
  run.bridge?.close();
  run.bridge = undefined;
  run.runtime = undefined;
  run.stdin = undefined;
  for (const [id, request] of run.shellRequests) {
    removeShellRequest(run, id);
    post({ type: 'shell-cancel', id });
    request.reject(new Error('Runtime execution has ended.'));
  }
  run.shellRequests.clear();
  nativeClearTimeout(run.flushTimer);
  run.flushTimer = undefined;
  setRuntimeLogSink(() => {});
  flush(run);
  execution = undefined;
  post({ type: 'complete', result: finalResult });
}

async function start(message: Extract<MainMessage, { type: 'start' }>): Promise<void> {
  const run: Execution = {
    runtimeId: message.runtimeId,
    entries: [],
    shellRequests: new Map(),
  };
  execution = run;
  try {
    if (import.meta.env.DEV && message.benchmarkStartedAt !== undefined) {
      const workerStartMs = performance.timeOrigin + performance.now() - message.benchmarkStartedAt;
      const { startBenchmark } = await import('./benchmark');
      if (execution !== run) return;
      run.benchmark = startBenchmark(workerStartMs, {
        acquisitionMs: message.benchmarkAcquisitionMs ?? 0,
        preparedWorker: message.benchmarkPreparedWorker ?? false,
      });
    }
    if (execution !== run) return;
    run.bridge = new RuntimeBridge(message.scope, message.fsPort, message.runtimeId, callId => {
      post({ type: 'cancel-runtime-call', runtimeId: message.runtimeId, callId });
    });
    const filesystem = new RuntimeFsMount(run.bridge);
    run.stdin = new WorkerStdin(
      promise => run.runtime?.trackIO(promise),
      () => {
        if (execution === run) post({ type: 'stdin-request' });
      },
      () => {
        if (execution === run) post({ type: 'stdin-pause' });
      },
      enabled => {
        if (execution === run) post({ type: 'stdin-raw-mode', enabled });
      },
      message.options.stdinIsTTY
    );
    setRuntimeLogSink((text, level) => enqueue(run, { channel: 'debug', text, level }));
    run.runtime = new NodeRuntime({
      ...message.options,
      filesystem,
      bridge: run.bridge,
      processStdin: run.stdin,
      onStdout: text => enqueue(run, { channel: 'stdout', text }),
      onStderr: text => enqueue(run, { channel: 'stderr', text }),
      debugConsole: {
        log: (...args) => output(run, 'log', format(...args)),
        warn: (...args) => output(run, 'warn', format(...args)),
        error: (...args) => output(run, 'error', format(...args)),
        clear: () => output(run, 'clear', ''),
      },
      runShell: (command, options) =>
        new Promise<ShellResult>((resolve, reject) => {
          if (execution !== run) {
            reject(new Error('Runtime execution has ended.'));
            return;
          }
          const id = ++shellId;
          const request: ShellRequest = {
            resolve,
            reject,
            signal: options?.signal,
            onStdout: options?.onStdout,
            onStderr: options?.onStderr,
            stdin: options?.stdin,
          };
          request.onAbort = () => {
            removeShellRequest(run, id);
            post({ type: 'shell-cancel', id, signal: shellSignal(request.signal) });
            reject(new Error('Shell command was aborted.'));
          };
          if (request.signal?.aborted) {
            reject(new Error('Shell command was aborted.'));
            return;
          }
          run.shellRequests.set(id, request);
          request.signal?.addEventListener('abort', request.onAbort, { once: true });
          post({
            type: 'shell',
            id,
            command,
            cwd: options?.cwd,
            env: options?.env,
            hasStdin: Boolean(request.stdin),
          });
          if (request.stdin) {
            request.onStdinData = chunk => {
              request.stdin?.pause();
              post({ type: 'shell-input', id, data: Buffer.from(chunk) });
            };
            request.onStdinEnd = () => post({ type: 'shell-input-end', id });
            request.stdin.on('data', request.onStdinData);
            if (request.stdin.readableEnded) request.onStdinEnd();
            else request.stdin.once('end', request.onStdinEnd);
          }
        }),
    });
    const runtime = run.runtime;
    const completionTask = (async () => {
      await runtime.execute(
        message.options.filePath,
        message.options.argv,
        message.options.source,
        message.options.execArgv
      );
      await runtime.waitForEventLoop();
      return runtime.getExitCode();
    })();
    const exitCode = await Promise.race([completionTask, runtime.waitForProcessExit()]);
    finish(run, { exitCode });
  } catch (error) {
    if (isProcessExitSignal(error)) {
      finish(run, { exitCode: error.code });
      return;
    }
    finish(run, { exitCode: 1, stderr: formatError(error) });
  }
}

function fail(error: unknown): void {
  if (poisoned) return;
  poisoned = true;
  const run = execution;
  if (run) {
    nativeClearTimeout(run.flushTimer);
    run.benchmark?.dispose();
    run.benchmark = undefined;
    run.runtime?.dispose();
    run.stdin?.dispose();
    run.bridge?.close();
    for (const [id, request] of run.shellRequests) {
      removeShellRequest(run, id);
      post({ type: 'shell-cancel', id });
      request.reject(new Error('Runtime execution has ended.'));
    }
    run.shellRequests.clear();
    flush(run);
    execution = undefined;
  }
  setRuntimeLogSink(() => {});
  post({ type: 'fatal', error: formatError(error) });
}

worker.addEventListener('error', (event: ErrorEvent) => {
  event.preventDefault();
  const error = event.error ?? event.message;
  if (isRuntimeBridgeClosedError(error) && error.runtimeId !== execution?.runtimeId) return;
  try {
    if (execution?.runtime?.handleUncaughtException?.(error)) return;
  } catch (listenerError) {
    if (execution && isProcessExitSignal(listenerError)) {
      finish(execution, { exitCode: listenerError.code });
      return;
    }
    fail(listenerError);
    return;
  }
  fail(error);
});

worker.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  event.preventDefault();
  if (isRetiredRuntimePromise(event.promise)) return;
  if (isRuntimeBridgeClosedError(event.reason) && event.reason.runtimeId !== execution?.runtimeId)
    return;
  try {
    if (execution?.runtime?.handleUnhandledRejection?.(event.reason, event.promise)) return;
  } catch (listenerError) {
    if (execution && isProcessExitSignal(listenerError)) {
      finish(execution, { exitCode: listenerError.code });
      return;
    }
    fail(listenerError);
    return;
  }
  fail(event.reason);
});

worker.addEventListener('message', (event: MessageEvent<MainMessage>) => {
  const message = event.data;
  if (message.type === 'start') {
    if (!poisoned && !execution) void start(message);
    return;
  }
  const run = execution;
  if (!run || poisoned) return;
  if (message.type === 'stdin' || message.type === 'stdin-end') {
    try {
      if (message.type === 'stdin') run.stdin?.submit(message.data);
      else run.stdin?.eof();
    } catch (error) {
      handleRuntimeFailure(run, error);
    }
  } else if (message.type === 'interrupt') {
    let handled = false;
    try {
      handled = run.runtime?.interrupt() ?? false;
    } catch (error) {
      handleRuntimeFailure(run, error);
      return;
    }
    flush(run);
    post({ type: 'interrupt-result', handled });
  } else if (message.type === 'shell-output') {
    const request = run.shellRequests.get(message.id);
    if (message.channel === 'stdout') request?.onStdout?.(message.data);
    else request?.onStderr?.(message.data);
  } else if (message.type === 'shell-input-ack') {
    run.shellRequests.get(message.id)?.stdin?.resume();
  } else if (message.type === 'shell-result' || message.type === 'shell-error') {
    const request = removeShellRequest(run, message.id);
    if (message.type === 'shell-result') request?.resolve(message.result);
    else request?.reject(new Error(message.error));
  }
});

post({ type: 'ready' });
