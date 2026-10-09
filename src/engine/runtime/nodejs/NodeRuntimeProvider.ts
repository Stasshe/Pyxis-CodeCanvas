import { PassThrough, type Readable } from 'node:stream';
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
      const shellRequests = new Map<number, AbortController>();
      const shellInputs = new Map<number, PassThrough>();
      const stdinQueue: Uint8Array[] = [];
      let stdinRequested = false;
      let stdinEnded = !options.processStdin?._active;
      const stdinReaders: Array<{
        resolve: (data: number[]) => void;
        signal: AbortSignal;
        onAbort: () => void;
      }> = [];
      const post = (message: MainMessage) => worker.postMessage(message);
      const runShell = async (
        command: string,
        shellOptions: { cwd?: string; env?: Record<string, string> },
        signal?: AbortSignal,
        output?: {
          stdout(data: string): void;
          stderr(data: string): void;
        },
        stdin?: Readable
      ) => {
        const controller = new AbortController();
        const abort = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) controller.abort(signal.reason);
        shells.add(controller);
        try {
          return await executeRuntimeShell(options.rootPath, command, {
            ...shellOptions,
            signal: controller.signal,
            stdin,
            onStdout: output?.stdout,
            onStderr: output?.stderr,
          });
        } finally {
          signal?.removeEventListener('abort', abort);
          shells.delete(controller);
        }
      };
      const cleanup = registerRuntimeHost(
        runtimeId,
        async (request: HostRequest, signal: AbortSignal): Promise<RpcValue> => {
          if (request.kind === 'stdin') {
            return new Promise<number[]>(resolve => {
              if (!options.processStdin || signal.aborted) {
                resolve([]);
                return;
              }
              const reader = {
                resolve,
                signal,
                onAbort: () => {
                  const index = stdinReaders.indexOf(reader);
                  if (index >= 0) stdinReaders.splice(index, 1);
                  resolveStdin(reader, []);
                },
              };
              stdinReaders.push(reader);
              signal.addEventListener('abort', reader.onAbort, { once: true });
              drainStdin();
            });
          }
          const result = await runShell(request.command, request, signal);
          return { stdout: result.stdout, stderr: result.stderr, exitCode: result.code ?? 0 };
        }
      );
      const resolveStdin = (reader: (typeof stdinReaders)[number], data: number[]) => {
        reader.signal.removeEventListener('abort', reader.onAbort);
        reader.resolve(data);
      };
      const drainStdin = () => {
        while (stdinReaders.length > 0 && (stdinQueue.length > 0 || stdinEnded)) {
          const reader = stdinReaders.shift()!;
          resolveStdin(reader, [...(stdinQueue.shift() ?? new Uint8Array())]);
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
        if (!reusable) discardRuntimeWorker(worker);
        for (const controller of shells) controller.abort();
        shells.clear();
        shellRequests.clear();
        for (const input of shellInputs.values()) input.destroy();
        shellInputs.clear();
        clearTimeout(interruptTimer);
        options.signal?.removeEventListener('abort', terminate);
        unsubscribeInterrupt?.();
        options.processStdin?.removeListener('data', onData);
        options.processStdin?.removeListener('end', onEnd);
        if (options.processStdin?.isTTY) options.processStdin.setRawMode(false);
        for (const reader of stdinReaders.splice(0)) resolveStdin(reader, []);
        stdinQueue.length = 0;
        stdinRequested = false;
        cleanup();
        const release = (cleanupError?: string) => {
          fsPort.close();
          this.executions.delete(terminate);
          if (reusable) releaseRuntimeWorker(worker);
          if (cleanupError) {
            const message = `Failed to close runtime FIFO endpoints: ${cleanupError}`;
            pushLogMessage(message, 'error', 'Runtime');
            if (result.exitCode !== 130) {
              resolve({ exitCode: 1, stderr: message });
              return;
            }
          }
          resolve(result);
        };
        void fsClient.closeFifos(runtimeId).then(
          () => release(),
          error => release(String(error))
        );
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
        } else if (message.type === 'stdin-raw-mode') {
          try {
            options.processStdin?.setRawMode(message.enabled);
          } catch (error) {
            finish({ exitCode: 1, stderr: String(error) });
          }
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
          const controller = new AbortController();
          let input: PassThrough | undefined;
          if (message.hasStdin) {
            input = new PassThrough();
            shellInputs.set(message.id, input);
          }
          shellRequests.set(message.id, controller);
          void runShell(
            message.command,
            message,
            controller.signal,
            {
              stdout: data =>
                post({ type: 'shell-output', id: message.id, channel: 'stdout', data }),
              stderr: data =>
                post({ type: 'shell-output', id: message.id, channel: 'stderr', data }),
            },
            input
          )
            .then(
              result => {
                if (!completed && !controller.signal.aborted)
                  post({ type: 'shell-result', id: message.id, result });
              },
              error => {
                if (!completed && !controller.signal.aborted)
                  post({ type: 'shell-error', id: message.id, error: String(error) });
              }
            )
            .finally(() => {
              shellRequests.delete(message.id);
              shellInputs.delete(message.id);
              input?.end();
            });
        } else if (message.type === 'shell-input') {
          const input = shellInputs.get(message.id);
          if (input && !input.destroyed && !input.writableEnded) {
            input.write(Buffer.from(message.data), () =>
              post({ type: 'shell-input-ack', id: message.id })
            );
          } else {
            post({ type: 'shell-input-ack', id: message.id });
          }
        } else if (message.type === 'shell-input-end') {
          shellInputs.get(message.id)?.end();
        } else if (message.type === 'shell-cancel') {
          shellRequests.get(message.id)?.abort(message.signal);
          shellInputs.get(message.id)?.end();
        } else if (message.type === 'cancel-runtime-call') {
          navigator.serviceWorker.controller?.postMessage({
            type: 'runtime-cancel',
            runtimeId: message.runtimeId,
            callId: message.callId,
          });
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
          source: options.source,
          cwd: options.cwd,
          env: options.env,
          stdinIsTTY: options.processStdin?.isTTY === true,
          stdoutIsTTY: options.stdoutIsTTY === true,
          stderrIsTTY: options.stderrIsTTY === true,
          argv: options.argv ?? [],
          execArgv: options.execArgv ?? [],
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
