import { Buffer } from 'buffer';
import { fsClient } from '@/engine/core/fs';
import { pushLogMessage } from '@/stores/loggerStore';
import { ensureRuntimeBridge, registerRuntimeHost } from '../bridge/main';
import type { HostRequest, RpcValue } from '../bridge/protocol';
import type {
  RuntimeExecutionOptions,
  RuntimeExecutionResult,
  RuntimeProvider,
} from '../core/RuntimeProvider';
import { setRuntimeLogSink } from '../core/runtimeLogger';
import {
  acquireRuntimeWorker,
  discardRuntimeWorker,
  releaseRuntimeWorker,
  warmRuntimeWorkerPool,
} from './runtimeWorkerPool';
import { executeRuntimeShell } from './shellHost';
import type { MainMessage, OutputEntry, WorkerMessage } from './workerProtocol';

export class NodeRuntimeProvider implements RuntimeProvider {
  readonly id = 'nodejs';
  readonly name = 'Node.js';
  readonly supportedExtensions = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'];
  private generation = 0;
  private readonly executions = new Set<() => void>();

  constructor() {
    setRuntimeLogSink((message, level) => pushLogMessage(message, level, 'Runtime'));
    warmRuntimeWorkerPool();
  }

  canExecute(filePath: string): boolean {
    return this.supportedExtensions.some(ext => filePath.endsWith(ext));
  }

  async execute(options: RuntimeExecutionOptions): Promise<RuntimeExecutionResult> {
    if (options.signal?.aborted) return { exitCode: 130 };
    const generation = this.generation;
    let cancelled = false;
    let cancelPreparation: () => void = () => {};
    const cancellation = new Promise<RuntimeExecutionResult>(resolve => {
      cancelPreparation = () => {
        cancelled = true;
        resolve({ exitCode: 130 });
      };
    });
    this.executions.add(cancelPreparation);
    options.signal?.addEventListener('abort', cancelPreparation, { once: true });
    let unsubscribePreparation = options.subscribeInterrupt?.(cancelPreparation);
    const preparation = async (): Promise<RuntimeExecutionResult> => {
      let fsPort: MessagePort | undefined;
      if (cancelled) return { exitCode: 130 };
      try {
        const createPort = () => fsClient.createRuntimePort();
        const scope = await ensureRuntimeBridge(createPort);
        if (cancelled) return { exitCode: 130 };
        fsPort = await createPort();
        if (cancelled || options.signal?.aborted || generation !== this.generation) {
          fsPort.close();
          return { exitCode: 130 };
        }
        let acquisitionStartedAt: number | undefined;
        if (options.benchmark) acquisitionStartedAt = performance.now();
        const acquired = await acquireRuntimeWorker();
        let acquisitionMs: number | undefined;
        if (acquisitionStartedAt !== undefined) {
          acquisitionMs = performance.now() - acquisitionStartedAt;
        }
        if (cancelled || options.signal?.aborted || generation !== this.generation) {
          discardRuntimeWorker(acquired.worker);
          fsPort.close();
          return { exitCode: 130 };
        }
        this.executions.delete(cancelPreparation);
        options.signal?.removeEventListener('abort', cancelPreparation);
        unsubscribePreparation?.();
        unsubscribePreparation = undefined;
        return await this.runWorker(options, scope, fsPort, acquired, acquisitionMs);
      } catch (error) {
        fsPort?.close();
        return { exitCode: 1, stderr: String(error) };
      }
    };
    try {
      return await Promise.race([preparation(), cancellation]);
    } finally {
      this.executions.delete(cancelPreparation);
      options.signal?.removeEventListener('abort', cancelPreparation);
      unsubscribePreparation?.();
    }
  }

  private async runWorker(
    options: RuntimeExecutionOptions,
    scope: string,
    fsPort: MessagePort,
    acquired: Awaited<ReturnType<typeof acquireRuntimeWorker>>,
    acquisitionMs: number | undefined
  ): Promise<RuntimeExecutionResult> {
    const { worker, prepared } = acquired;
    return new Promise(resolve => {
      let benchmarkStartedAt: number | undefined;
      if (options.benchmark) benchmarkStartedAt = performance.timeOrigin + performance.now();
      const runtimeId = crypto.randomUUID();
      let completed = false;
      let interruptTimer: ReturnType<typeof setTimeout> | undefined;
      let unsubscribeInterrupt: (() => void) | undefined;
      const shells = new Set<AbortController>();
      const stdinQueue: Uint8Array[] = [];
      let stdinRequested = false;
      let stdinEnded = !options.processStdin?._active;
      const stdinReaders: Array<(data: number[]) => void> = [];
      const post = (message: MainMessage) => worker.postMessage(message);
      const runShell = async (
        command: string,
        shellOptions: { cwd?: string; env?: Record<string, string> }
      ) => {
        const controller = new AbortController();
        shells.add(controller);
        try {
          return await executeRuntimeShell(options.rootPath, command, {
            ...shellOptions,
            signal: controller.signal,
          });
        } finally {
          shells.delete(controller);
        }
      };
      const cleanup = registerRuntimeHost(
        runtimeId,
        async (request: HostRequest): Promise<RpcValue> => {
          if (request.kind === 'stdin') {
            return new Promise<number[]>(read => {
              if (!options.processStdin) {
                read([]);
                return;
              }
              stdinReaders.push(read);
              drainStdin();
            });
          }
          const result = await runShell(request.command, request);
          return { stdout: result.stdout, stderr: result.stderr, exitCode: result.code ?? 0 };
        }
      );
      const drainStdin = () => {
        while (stdinReaders.length > 0 && (stdinQueue.length > 0 || stdinEnded)) {
          const read = stdinReaders.shift()!;
          read([...(stdinQueue.shift() ?? new Uint8Array())]);
        }
        if (stdinReaders.length > 0) return;
        if (stdinRequested && stdinQueue.length > 0) {
          stdinRequested = false;
          post({ type: 'stdin', data: stdinQueue.shift()! });
        } else if (stdinRequested && stdinEnded) {
          stdinRequested = false;
          post({ type: 'stdin-end' });
        }
      };
      const onData = (data: Buffer) => {
        stdinQueue.push(Buffer.from(data));
        drainStdin();
      };
      const onEnd = () => {
        stdinEnded = true;
        drainStdin();
      };
      const finish = (result: RuntimeExecutionResult, reusable = false) => {
        if (completed) return;
        completed = true;
        for (const controller of shells) controller.abort();
        shells.clear();
        clearTimeout(interruptTimer);
        options.signal?.removeEventListener('abort', terminate);
        unsubscribeInterrupt?.();
        options.processStdin?.removeListener('data', onData);
        options.processStdin?.removeListener('end', onEnd);
        for (const read of stdinReaders.splice(0)) read([]);
        stdinQueue.length = 0;
        stdinRequested = false;
        cleanup();
        fsPort.close();
        this.executions.delete(terminate);
        if (reusable) releaseRuntimeWorker(worker);
        else discardRuntimeWorker(worker);
        resolve(result);
      };
      const terminate = () => finish({ exitCode: 130 });
      const interrupt = () => {
        if (completed) return;
        if (interruptTimer !== undefined) {
          terminate();
          return;
        }
        for (const controller of shells) controller.abort();
        post({ type: 'interrupt' });
        // A blocked synchronous XHR or CPU loop cannot acknowledge SIGINT.
        interruptTimer = setTimeout(terminate, 250);
      };
      this.executions.add(terminate);
      options.signal?.addEventListener('abort', terminate, { once: true });
      options.processStdin?.on('data', onData);
      options.processStdin?.on('end', onEnd);
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        if (completed) return;
        const message = event.data;
        if (message.type === 'stdin-request') {
          stdinRequested = true;
          drainStdin();
        } else if (message.type === 'stdin-pause') {
          stdinRequested = false;
        } else if (message.type === 'output') {
          try {
            for (const entry of message.entries) this.dispatchOutput(entry, options);
          } catch (error) {
            finish({ exitCode: 1, stderr: String(error) });
          }
        } else if (message.type === 'complete') {
          finish(message.result, true);
        } else if (message.type === 'fatal') {
          finish({ exitCode: 1, stderr: message.error });
        } else if (message.type === 'ready') {
          finish({ exitCode: 1, stderr: 'Runtime worker became ready during execution.' });
        } else if (message.type === 'interrupt-result') {
          if (!message.handled) terminate();
          else {
            clearTimeout(interruptTimer);
            interruptTimer = undefined;
          }
        } else if (message.type === 'shell') {
          void runShell(message.command, message).then(
            result => {
              if (!completed) post({ type: 'shell-result', id: message.id, result });
            },
            error => {
              if (!completed) post({ type: 'shell-error', id: message.id, error: String(error) });
            }
          );
        }
      };
      worker.onerror = event => {
        event.preventDefault();
        finish({ exitCode: 1, stderr: event.message });
      };
      worker.onmessageerror = () =>
        finish({ exitCode: 1, stderr: 'Runtime worker message could not be decoded.' });
      const start: MainMessage = {
        type: 'start',
        benchmarkStartedAt,
        runtimeId,
        scope,
        fsPort,
        options: {
          rootPath: options.rootPath,
          filePath: options.filePath,
          cwd: options.cwd,
          argv: options.argv ?? [],
          terminalColumns: options.terminalColumns,
          terminalRows: options.terminalRows,
        },
      };
      if (options.benchmark) {
        start.benchmarkPreparedWorker = prepared;
        start.benchmarkAcquisitionMs = acquisitionMs;
      }
      try {
        worker.postMessage(start, [fsPort]);
      } catch (error) {
        finish({ exitCode: 1, stderr: String(error) });
        return;
      }
      unsubscribeInterrupt = options.subscribeInterrupt?.(interrupt);
      if (completed) {
        unsubscribeInterrupt?.();
        return;
      }
      if (options.signal?.aborted) terminate();
    });
  }

  private dispatchOutput(entry: OutputEntry, options: RuntimeExecutionOptions): void {
    if (entry.channel === 'stdout') {
      if (options.onStdout) options.onStdout(entry.text);
      else if (options.debugConsole)
        options.debugConsole.log(Buffer.from(entry.text).toString('utf8'));
      else pushLogMessage(Buffer.from(entry.text).toString('utf8'), 'info', 'Runtime');
      return;
    }
    if (entry.channel === 'stderr') {
      if (options.onStderr) options.onStderr(entry.text);
      else if (options.debugConsole)
        options.debugConsole.error(Buffer.from(entry.text).toString('utf8'));
      else pushLogMessage(Buffer.from(entry.text).toString('utf8'), 'error', 'Runtime');
      return;
    }
    if (entry.channel === 'clear') {
      options.debugConsole?.clear();
      return;
    }
    if (entry.channel === 'debug') {
      pushLogMessage(entry.text, entry.level, 'Runtime');
      return;
    }
    if (options.debugConsole) options.debugConsole[entry.channel](entry.text);
    else {
      let level: 'info' | 'warn' | 'error' = 'info';
      if (entry.channel === 'warn' || entry.channel === 'error') level = entry.channel;
      pushLogMessage(entry.text, level, 'Runtime');
    }
  }

  async dispose(): Promise<void> {
    this.generation++;
    for (const terminate of this.executions) terminate();
  }

  isReady(): boolean {
    return Boolean(navigator.serviceWorker?.controller);
  }
}
