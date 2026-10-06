import { RuntimeBridge } from '../bridge/client';
import type { RuntimeExecutionResult } from '../core/RuntimeProvider';
import { formatRuntimeArgs, setRuntimeLogSink } from '../core/runtimeLogger';
import { RuntimeFsMount } from '../storage/RuntimeFsMount';
import { NodeRuntime } from './nodeRuntime';
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
let completed = false;
let runtime: NodeRuntime | undefined;
let stdin: WorkerStdin | undefined;
let bridge: RuntimeBridge | undefined;
const entries: OutputEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let shellId = 0;
const shellRequests = new Map<
  number,
  { resolve: (result: ShellResult) => void; reject: (error: Error) => void }
>();

function post(message: WorkerMessage): void {
  worker.postMessage(message);
}

function flush(): void {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  if (entries.length === 0) return;
  post({ type: 'output', entries: entries.splice(0) });
}

function complete(result: RuntimeExecutionResult): void {
  if (completed) return;
  completed = true;
  flush();
  post({ type: 'complete', result });
  bridge?.close();
}

function enqueue(entry: OutputEntry): void {
  if (completed) return;
  entries.push(entry);
  if (entries.length >= 128) flush();
  else if (flushTimer === undefined) flushTimer = setTimeout(flush, 8);
}

function output(channel: Exclude<OutputChannel, 'debug'>, text: string): void {
  enqueue({ channel, text });
}

async function start(message: Extract<MainMessage, { type: 'start' }>): Promise<void> {
  try {
    bridge = new RuntimeBridge(message.scope, message.fsPort, message.runtimeId);
    const filesystem = new RuntimeFsMount(bridge);
    stdin = new WorkerStdin(
      promise => runtime?.trackIO(promise),
      () => post({ type: 'stdin-request' }),
      () => post({ type: 'stdin-pause' })
    );
    setRuntimeLogSink((text, level) => {
      enqueue({ channel: 'debug', text, level });
    });
    runtime = new NodeRuntime({
      ...message.options,
      filesystem,
      bridge,
      onExit: code => complete({ exitCode: code }),
      processStdin: stdin,
      onStdout: text => output('stdout', text),
      onStderr: text => output('stderr', text),
      debugConsole: {
        log: (...args) => output('log', formatRuntimeArgs(args)),
        warn: (...args) => output('warn', formatRuntimeArgs(args)),
        error: (...args) => output('error', formatRuntimeArgs(args)),
        clear: () => output('clear', ''),
      },
      runShell: (command, options) =>
        new Promise<ShellResult>((resolve, reject) => {
          const id = ++shellId;
          shellRequests.set(id, { resolve, reject });
          post({ type: 'shell', id, command, cwd: options?.cwd, env: options?.env });
        }),
    });
    await runtime.execute(message.options.filePath, message.options.argv);
    await runtime.waitForEventLoop();
    complete({ exitCode: runtime.getExitCode() });
  } catch (error) {
    complete({ exitCode: 1, stderr: String(error) });
  } finally {
    bridge?.close();
  }
}

worker.addEventListener('error', (event: ErrorEvent) => {
  event.preventDefault();
  if (isProcessExitSignal(event.error)) complete({ exitCode: event.error.code });
  else complete({ exitCode: 1, stderr: event.message });
});

worker.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  event.preventDefault();
  if (isProcessExitSignal(event.reason)) complete({ exitCode: event.reason.code });
  else complete({ exitCode: 1, stderr: String(event.reason) });
});

worker.addEventListener('message', (event: MessageEvent<MainMessage>) => {
  if (completed) return;
  const message = event.data;
  if (message.type === 'start') void start(message);
  else if (message.type === 'stdin' || message.type === 'stdin-end') {
    try {
      if (message.type === 'stdin') stdin?.submit(message.data);
      else stdin?.eof();
    } catch (error) {
      if (isProcessExitSignal(error)) return;
      complete({ exitCode: 1, stderr: String(error) });
    }
  } else if (message.type === 'interrupt') {
    let handled = false;
    try {
      handled = runtime?.interrupt() ?? false;
    } catch (error) {
      complete({ exitCode: 1, stderr: String(error) });
      return;
    }
    flush();
    post({ type: 'interrupt-result', handled });
  } else {
    const request = shellRequests.get(message.id);
    shellRequests.delete(message.id);
    if (message.type === 'shell-result') request?.resolve(message.result);
    else request?.reject(new Error(message.error));
  }
});
