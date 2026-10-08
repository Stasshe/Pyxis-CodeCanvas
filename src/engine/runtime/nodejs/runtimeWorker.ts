import { RuntimeBridge } from '../bridge/client';
import type { RuntimeExecutionResult } from '../core/RuntimeProvider';
import { formatRuntimeArgs, setRuntimeLogSink } from '../core/runtimeLogger';
import { RuntimeFsMount } from '../storage/RuntimeFsMount';
import { isRetiredRuntimePromise, NodeRuntime } from './nodeRuntime';
import { isProcessExitSignal } from './processExit';
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
  runtime?: NodeRuntime;
  stdin?: WorkerStdin;
  bridge?: RuntimeBridge;
  benchmark?: { report(): string; dispose(): void };
  entries: OutputEntry[];
  flushTimer?: ReturnType<typeof setTimeout>;
  shellRequests: Map<
    number,
    { resolve: (result: ShellResult) => void; reject: (error: Error) => void }
  >;
}

let execution: Execution | undefined;
let shellId = 0;
let poisoned = false;

function post(message: WorkerMessage): void {
  worker.postMessage(message);
}

function flush(run: Execution): void {
  clearTimeout(run.flushTimer);
  run.flushTimer = undefined;
  if (run.entries.length === 0) return;
  post({ type: 'output', entries: run.entries.splice(0) });
}

function enqueue(run: Execution, entry: OutputEntry): void {
  if (execution !== run) return;
  run.entries.push(entry);
  if (run.entries.length >= 128) flush(run);
  else if (run.flushTimer === undefined) run.flushTimer = setTimeout(() => flush(run), 8);
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
  if (run.benchmark) enqueue(run, { channel: 'stdout', text: run.benchmark.report() });
  run.runtime?.dispose();
  run.stdin?.dispose();
  run.benchmark?.dispose();
  run.benchmark = undefined;
  run.bridge?.close();
  run.bridge = undefined;
  run.runtime = undefined;
  run.stdin = undefined;
  for (const request of run.shellRequests.values()) {
    request.reject(new Error('Runtime execution has ended.'));
  }
  run.shellRequests.clear();
  clearTimeout(run.flushTimer);
  run.flushTimer = undefined;
  setRuntimeLogSink(() => {});
  flush(run);
  execution = undefined;
  post({ type: 'complete', result });
}

async function start(message: Extract<MainMessage, { type: 'start' }>): Promise<void> {
  const run: Execution = {
    entries: [],
    shellRequests: new Map(),
  };
  execution = run;
  try {
    if (message.benchmarkStartedAt !== undefined) {
      const workerStartMs = performance.timeOrigin + performance.now() - message.benchmarkStartedAt;
      const { startBenchmark } = await import('./benchmark');
      if (execution !== run) return;
      run.benchmark = startBenchmark(workerStartMs, {
        acquisitionMs: message.benchmarkAcquisitionMs ?? 0,
        preparedWorker: message.benchmarkPreparedWorker ?? false,
      });
    }
    if (execution !== run) return;
    run.bridge = new RuntimeBridge(message.scope, message.fsPort, message.runtimeId);
    const filesystem = new RuntimeFsMount(run.bridge);
    run.stdin = new WorkerStdin(
      promise => run.runtime?.trackIO(promise),
      () => {
        if (execution === run) post({ type: 'stdin-request' });
      },
      () => {
        if (execution === run) post({ type: 'stdin-pause' });
      }
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
        log: (...args) => output(run, 'log', formatRuntimeArgs(args)),
        warn: (...args) => output(run, 'warn', formatRuntimeArgs(args)),
        error: (...args) => output(run, 'error', formatRuntimeArgs(args)),
        clear: () => output(run, 'clear', ''),
      },
      runShell: (command, options) =>
        new Promise<ShellResult>((resolve, reject) => {
          if (execution !== run) {
            reject(new Error('Runtime execution has ended.'));
            return;
          }
          const id = ++shellId;
          run.shellRequests.set(id, { resolve, reject });
          post({ type: 'shell', id, command, cwd: options?.cwd, env: options?.env });
        }),
    });
    const runtime = run.runtime;
    const completionTask = (async () => {
      await runtime.execute(message.options.filePath, message.options.argv);
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
    finish(run, { exitCode: 1, stderr: String(error) });
  }
}

function fail(error: unknown): void {
  if (poisoned) return;
  poisoned = true;
  const run = execution;
  if (run) {
    clearTimeout(run.flushTimer);
    run.runtime?.dispose();
    run.stdin?.dispose();
    run.benchmark?.dispose();
    run.bridge?.close();
    for (const request of run.shellRequests.values()) {
      request.reject(new Error('Runtime execution has ended.'));
    }
    run.shellRequests.clear();
    flush(run);
    execution = undefined;
  }
  setRuntimeLogSink(() => {});
  post({ type: 'fatal', error: String(error) });
}

worker.addEventListener('error', (event: ErrorEvent) => {
  event.preventDefault();
  if (isProcessExitSignal(event.error)) fail(event.error);
  else fail(event.message);
});

worker.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  event.preventDefault();
  if (isRetiredRuntimePromise(event.promise)) return;
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
      if (!isProcessExitSignal(error)) finish(run, { exitCode: 1, stderr: String(error) });
    }
  } else if (message.type === 'interrupt') {
    let handled = false;
    try {
      handled = run.runtime?.interrupt() ?? false;
    } catch (error) {
      finish(run, { exitCode: 1, stderr: String(error) });
      return;
    }
    flush(run);
    post({ type: 'interrupt-result', handled });
  } else {
    const request = run.shellRequests.get(message.id);
    run.shellRequests.delete(message.id);
    if (message.type === 'shell-result') request?.resolve(message.result);
    else request?.reject(new Error(message.error));
  }
});

post({ type: 'ready' });
