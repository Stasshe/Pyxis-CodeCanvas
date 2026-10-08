import { PassThrough } from 'node:stream';
import { Buffer } from 'buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessStdin } from '@/engine/cmd/terminalProcessBridge';
import { fsClient } from '@/engine/core/fs';
import { ensureRuntimeBridge, registerRuntimeHost } from '@/engine/runtime/bridge/main';
import { NodeRuntimeProvider } from '@/engine/runtime/nodejs/NodeRuntimeProvider';
import { disposeRuntimeWorkerPool } from '@/engine/runtime/nodejs/runtimeWorkerPool';
import { executeRuntimeShell } from '@/engine/runtime/nodejs/shellHost';
import type { MainMessage, WorkerMessage } from '@/engine/runtime/nodejs/workerProtocol';

vi.mock('@/engine/core/fs', () => ({
  fsClient: { createRuntimePort: vi.fn(async () => new MessageChannel().port1) },
}));
vi.mock('@/engine/runtime/bridge/main', () => ({
  ensureRuntimeBridge: vi.fn(async () => '/'),
  registerRuntimeHost: vi.fn(() => () => {}),
}));
vi.mock('@/engine/runtime/nodejs/shellHost', () => ({
  executeRuntimeShell: vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })),
}));

class FakeWorker {
  static instances: FakeWorker[] = [];
  private readonly listeners = new Map<string, Set<(event: never) => void>>();
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly posted: MainMessage[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
    queueMicrotask(() => this.emit({ type: 'ready' }));
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message: MainMessage): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: WorkerMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerMessage>);
    for (const listener of this.listeners.get('message') ?? []) {
      listener({ data: message } as never);
    }
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve = (_value: T) => {};
  const promise = new Promise<T>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function waitForWorker(index: number, startCount = 1): Promise<FakeWorker> {
  await vi.waitFor(() => {
    expect(FakeWorker.instances).toHaveLength(index);
    expect(
      FakeWorker.instances[index - 1].posted.filter(message => message.type === 'start')
    ).toHaveLength(startCount);
  });
  return FakeWorker.instances[index - 1];
}

describe('NodeRuntimeProvider worker lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    return disposeRuntimeWorkerPool().then(() => {
      FakeWorker.instances = [];
    });
  });

  it('reuses the prepared worker after normal completion', async () => {
    const provider = new NodeRuntimeProvider();
    const firstRun = provider.execute({
      rootPath: '/workspace/app',
      filePath: '/workspace/app/a.js',
    });
    const firstWorker = await waitForWorker(1);
    expect(firstWorker.posted[0]?.type).toBe('start');
    firstWorker.emit({ type: 'complete', result: { exitCode: 0 } });
    await expect(firstRun).resolves.toEqual({ exitCode: 0 });
    expect(firstWorker.terminated).toBe(false);

    const secondRun = provider.execute({
      rootPath: '/workspace/app',
      filePath: '/workspace/app/b.js',
    });
    const secondWorker = await waitForWorker(1, 2);
    expect(secondWorker).toBe(firstWorker);
    secondWorker.emit({ type: 'complete', result: { exitCode: 0 } });
    await expect(secondRun).resolves.toEqual({ exitCode: 0 });
    expect(secondWorker.terminated).toBe(false);
  });

  it('keeps terminal input queued until a synchronous stdin read requests it', async () => {
    const provider = new NodeRuntimeProvider();
    const stdin = new ProcessStdin();
    stdin._active = true;
    const run = provider.execute({
      rootPath: '/workspace/app',
      filePath: '/workspace/app/a.js',
      processStdin: stdin,
    });
    const worker = await waitForWorker(1);
    stdin.submitLine('entered early');

    const hostHandler = vi.mocked(registerRuntimeHost).mock.calls[0]?.[1];
    expect(hostHandler).toBeDefined();
    await expect(hostHandler?.({ kind: 'stdin' })).resolves.toEqual([
      ...new TextEncoder().encode('entered early\n'),
    ]);

    worker.emit({ type: 'complete', result: { exitCode: 0 } });
    await expect(run).resolves.toEqual({ exitCode: 0 });
  });

  it('preserves binary subviews across worker input, synchronous input, and worker output', async () => {
    const source = new PassThrough();
    const stdin = new ProcessStdin(source);
    const bytes = Buffer.from([9, 0, 255, 128, 9]).subarray(1, 4);
    const output: Buffer[] = [];
    const run = new NodeRuntimeProvider().execute({
      rootPath: '/workspace/app',
      filePath: '/workspace/app/a.js',
      processStdin: stdin,
      onStdout: data => output.push(Buffer.from(data)),
    });
    const worker = await waitForWorker(1);
    worker.emit({ type: 'stdin-request' });
    source.write(bytes);
    await vi.waitFor(() => {
      expect(worker.posted.find(message => message.type === 'stdin')).toEqual({
        type: 'stdin',
        data: bytes,
      });
    });
    source.write(bytes);
    const hostHandler = vi.mocked(registerRuntimeHost).mock.calls[0]?.[1];
    await expect(hostHandler?.({ kind: 'stdin' })).resolves.toEqual([...bytes]);
    worker.emit({ type: 'output', entries: [{ channel: 'stdout', text: bytes }] });
    expect(Buffer.concat(output)).toEqual(bytes);
    source.end();
    worker.emit({ type: 'complete', result: { exitCode: 0 } });
    await expect(run).resolves.toEqual({ exitCode: 0 });
  });

  it('serves concurrent synchronous stdin reads in FIFO order', async () => {
    const provider = new NodeRuntimeProvider();
    const stdin = new ProcessStdin();
    stdin._active = true;
    const run = provider.execute({
      rootPath: '/workspace/app',
      filePath: '/workspace/app/a.js',
      processStdin: stdin,
    });
    const worker = await waitForWorker(1);
    const hostHandler = vi.mocked(registerRuntimeHost).mock.calls[0]?.[1];
    expect(hostHandler).toBeDefined();

    const firstRead = hostHandler?.({ kind: 'stdin' });
    const secondRead = hostHandler?.({ kind: 'stdin' });
    stdin.submitLine('first');
    stdin.submitLine('second');

    await expect(firstRead).resolves.toEqual([...new TextEncoder().encode('first\n')]);
    await expect(secondRead).resolves.toEqual([...new TextEncoder().encode('second\n')]);
    worker.emit({ type: 'complete', result: { exitCode: 0 } });
    await expect(run).resolves.toEqual({ exitCode: 0 });
  });

  it('resolves a pending synchronous stdin read with EOF on worker completion', async () => {
    const provider = new NodeRuntimeProvider();
    const stdin = new ProcessStdin();
    stdin._active = true;
    const run = provider.execute({
      rootPath: '/workspace/app',
      filePath: '/workspace/app/a.js',
      processStdin: stdin,
    });
    const worker = await waitForWorker(1);
    const hostHandler = vi.mocked(registerRuntimeHost).mock.calls[0]?.[1];
    expect(hostHandler).toBeDefined();
    const read = hostHandler?.({ kind: 'stdin' });

    worker.emit({ type: 'complete', result: { exitCode: 0 } });

    await expect(read).resolves.toEqual([]);
    await expect(run).resolves.toEqual({ exitCode: 0 });
  });

  it('returns worker failures and terminates the failed worker', async () => {
    const provider = new NodeRuntimeProvider();
    const run = provider.execute({ rootPath: '/workspace/app', filePath: '/workspace/app/a.js' });
    const worker = await waitForWorker(1);

    worker.onerror?.({ message: 'worker failed', preventDefault: () => {} } as ErrorEvent);

    await expect(run).resolves.toEqual({ exitCode: 1, stderr: 'worker failed' });
    expect(worker.terminated).toBe(true);
  });

  it('disposes while service worker bridge initialization is pending', async () => {
    const readiness = deferred<string>();
    vi.mocked(ensureRuntimeBridge).mockReturnValueOnce(readiness.promise);
    const provider = new NodeRuntimeProvider();
    const run = provider.execute({ rootPath: '/workspace/app', filePath: '/workspace/app/a.js' });

    await provider.dispose();

    await expect(run).resolves.toEqual({ exitCode: 130 });
    expect(FakeWorker.instances).toHaveLength(1);
    expect(fsClient.createRuntimePort).not.toHaveBeenCalled();
    readiness.resolve('/');
    await Promise.resolve();
  });

  it('aborts while service worker bridge initialization is pending', async () => {
    const readiness = deferred<string>();
    vi.mocked(ensureRuntimeBridge).mockReturnValueOnce(readiness.promise);
    const provider = new NodeRuntimeProvider();
    const controller = new AbortController();
    const run = provider.execute({
      rootPath: '/workspace/app',
      filePath: '/workspace/app/a.js',
      signal: controller.signal,
    });

    controller.abort();

    await expect(run).resolves.toEqual({ exitCode: 130 });
    expect(FakeWorker.instances).toHaveLength(1);
    readiness.resolve('/');
    await Promise.resolve();
  });

  it('disposes while the runtime filesystem port is pending', async () => {
    const portRequest = deferred<MessagePort>();
    vi.mocked(fsClient.createRuntimePort).mockReturnValueOnce(portRequest.promise);
    const provider = new NodeRuntimeProvider();
    const run = provider.execute({ rootPath: '/workspace/app', filePath: '/workspace/app/a.js' });

    await vi.waitFor(() => expect(fsClient.createRuntimePort).toHaveBeenCalledOnce());
    await provider.dispose();

    await expect(run).resolves.toEqual({ exitCode: 130 });
    expect(FakeWorker.instances).toHaveLength(1);
    const port = new MessageChannel().port1;
    portRequest.resolve(port);
    await Promise.resolve();
    port.close();
  });

  it('terminates with exit 130 when an active run is disposed', async () => {
    const provider = new NodeRuntimeProvider();
    const run = provider.execute({ rootPath: '/workspace/app', filePath: '/workspace/app/a.js' });
    const worker = await waitForWorker(1);

    await provider.dispose();

    await expect(run).resolves.toEqual({ exitCode: 130 });
    expect(worker.terminated).toBe(true);
  });

  it('waits for a handled SIGINT until the worker completes', async () => {
    vi.useFakeTimers();
    const provider = new NodeRuntimeProvider();
    let interrupt: (() => void) | undefined;
    const run = provider.execute({
      rootPath: '/workspace/app',
      filePath: '/workspace/app/a.js',
      subscribeInterrupt: handler => {
        interrupt = handler;
        return () => {};
      },
    });
    const worker = await waitForWorker(1);

    interrupt?.();
    expect(worker.posted.some(message => message.type === 'interrupt')).toBe(true);
    worker.emit({ type: 'interrupt-result', handled: true });
    await vi.advanceTimersByTimeAsync(250);
    expect(worker.terminated).toBe(false);

    worker.emit({ type: 'complete', result: { exitCode: 130 } });
    await expect(run).resolves.toEqual({ exitCode: 130 });
    expect(worker.terminated).toBe(false);
  });

  it('continues to send SIGINT after a handled interrupt acknowledgement', async () => {
    vi.useFakeTimers();
    const provider = new NodeRuntimeProvider();
    let interrupt: (() => void) | undefined;
    const run = provider.execute({
      rootPath: '/workspace/app',
      filePath: '/workspace/app/a.js',
      subscribeInterrupt: handler => {
        interrupt = handler;
        return () => {};
      },
    });
    const worker = await waitForWorker(1);

    interrupt?.();
    worker.emit({ type: 'interrupt-result', handled: true });
    interrupt?.();
    expect(worker.posted.filter(message => message.type === 'interrupt')).toHaveLength(2);
    worker.emit({ type: 'interrupt-result', handled: true });
    worker.emit({ type: 'complete', result: { exitCode: 130 } });

    await expect(run).resolves.toEqual({ exitCode: 130 });
  });

  it('force-aborts after a handled SIGINT acknowledgement', async () => {
    const provider = new NodeRuntimeProvider();
    const controller = new AbortController();
    let interrupt: (() => void) | undefined;
    const run = provider.execute({
      rootPath: '/workspace/app',
      filePath: '/workspace/app/a.js',
      signal: controller.signal,
      subscribeInterrupt: handler => {
        interrupt = handler;
        return () => {};
      },
    });
    const worker = await waitForWorker(1);

    interrupt?.();
    worker.emit({ type: 'interrupt-result', handled: true });
    controller.abort();

    await expect(run).resolves.toEqual({ exitCode: 130 });
    expect(worker.terminated).toBe(true);
  });

  it('ignores shell and output messages after worker completion', async () => {
    const provider = new NodeRuntimeProvider();
    const onStdout = vi.fn();
    const run = provider.execute({
      rootPath: '/workspace/app',
      filePath: '/workspace/app/a.js',
      onStdout,
    });
    const worker = await waitForWorker(1);
    worker.emit({ type: 'complete', result: { exitCode: 0 } });
    worker.emit({ type: 'shell', id: 1, command: 'late-command' });
    worker.emit({
      type: 'output',
      entries: [{ channel: 'stdout', text: 'late output' }],
    });

    await expect(run).resolves.toEqual({ exitCode: 0 });
    expect(executeRuntimeShell).not.toHaveBeenCalled();
    expect(onStdout).not.toHaveBeenCalled();
    expect(worker.posted.some(message => message.type === 'shell-result')).toBe(false);
  });

  it('completes with failure when an output callback throws', async () => {
    const provider = new NodeRuntimeProvider();
    const run = provider.execute({
      rootPath: '/workspace/app',
      filePath: '/workspace/app/a.js',
      onStdout: () => {
        throw new Error('output sink failed');
      },
    });
    const worker = await waitForWorker(1);

    worker.emit({
      type: 'output',
      entries: [{ channel: 'stdout', text: 'output' }],
    });

    await expect(run).resolves.toEqual({ exitCode: 1, stderr: 'Error: output sink failed' });
    expect(worker.terminated).toBe(true);
  });

  it('aborts an active shell request and ignores its late result', async () => {
    const shellResult = deferred<{ stdout: string; stderr: string; code: number | null }>();
    let shellSignal: AbortSignal | undefined;
    vi.mocked(executeRuntimeShell).mockImplementationOnce((_rootPath, _command, options) => {
      shellSignal = options.signal;
      return shellResult.promise;
    });
    const provider = new NodeRuntimeProvider();
    const controller = new AbortController();
    const run = provider.execute({
      rootPath: '/workspace/app',
      filePath: '/workspace/app/a.js',
      signal: controller.signal,
    });
    const worker = await waitForWorker(1);

    worker.emit({ type: 'shell', id: 1, command: 'long-running-command' });
    await vi.waitFor(() => expect(executeRuntimeShell).toHaveBeenCalledOnce());
    expect(shellSignal).toBeDefined();
    controller.abort();

    await expect(run).resolves.toEqual({ exitCode: 130 });
    expect(worker.terminated).toBe(true);
    expect(shellSignal?.aborted).toBe(true);

    shellResult.resolve({ stdout: 'late', stderr: '', code: 0 });
    await Promise.resolve();
    expect(worker.posted.some(message => message.type === 'shell-result')).toBe(false);
  });

  it('sends SIGINT and terminates with 130 when the worker does not handle it', async () => {
    vi.useFakeTimers();
    const provider = new NodeRuntimeProvider();
    let interrupt: (() => void) | undefined;
    const run = provider.execute({
      rootPath: '/workspace/app',
      filePath: '/workspace/app/a.js',
      subscribeInterrupt: handler => {
        interrupt = handler;
        return () => {};
      },
    });
    const worker = await waitForWorker(1);

    interrupt?.();
    expect(worker.posted.some(message => message.type === 'interrupt')).toBe(true);
    await vi.advanceTimersByTimeAsync(250);

    await expect(run).resolves.toEqual({ exitCode: 130 });
    expect(worker.terminated).toBe(true);
  });
});
