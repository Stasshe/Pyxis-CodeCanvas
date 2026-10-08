import { Worker } from 'node:worker_threads';
import { Buffer } from 'buffer';
import { build } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionOptions } from '@/engine/runtime/nodejs/nodeRuntime';
import type { MainMessage, WorkerMessage } from '@/engine/runtime/nodejs/workerProtocol';

type WorkerEventListener = (event: Event) => void;

interface WorkerHarness {
  posted: WorkerMessage[];
  listeners: Map<string, WorkerEventListener>;
  options(): ExecutionOptions | undefined;
}

let runtimeOptions: ExecutionOptions | undefined;
let finishMockExecution: (() => void) | undefined;
let mockExecutionCount = 0;
let retiredRuntimeEvent = false;
let isolatedRuntimeBundle: Promise<string> | undefined;

class MockRuntimeBridge {
  private port: MessagePort | undefined;

  constructor(_scope: string, port: MessagePort, _runtimeId: string) {
    this.port = port;
  }

  close(): void {
    this.port?.close();
    this.port = undefined;
  }
}

class MockRuntimeFilesystem {}

class MockNodeRuntime {
  constructor(options: ExecutionOptions) {
    runtimeOptions = options;
  }

  execute(): Promise<void> {
    mockExecutionCount++;
    return new Promise<void>(resolve => {
      finishMockExecution = resolve;
    });
  }

  waitForEventLoop(): Promise<void> {
    return Promise.resolve();
  }

  waitForProcessExit(): Promise<number> {
    return new Promise<number>(() => {});
  }

  dispose(): void {}

  trackIO(): void {}

  getExitCode(): number {
    return 0;
  }

  interrupt(): boolean {
    return false;
  }
}

async function startWorker(): Promise<WorkerHarness> {
  runtimeOptions = undefined;
  finishMockExecution = undefined;
  mockExecutionCount = 0;
  retiredRuntimeEvent = false;
  vi.resetModules();

  const posted: WorkerMessage[] = [];
  const listeners = new Map<string, WorkerEventListener>();
  vi.stubGlobal('self', {
    postMessage: (message: WorkerMessage) => posted.push(message),
    addEventListener: (type: string, listener: WorkerEventListener) =>
      listeners.set(type, listener),
  });

  vi.doMock('@/engine/runtime/bridge/client', () => ({ RuntimeBridge: MockRuntimeBridge }));
  vi.doMock('@/engine/runtime/storage/RuntimeFsMount', () => ({
    RuntimeFsMount: MockRuntimeFilesystem,
  }));
  vi.doMock('@/engine/runtime/nodejs/nodeRuntime', () => ({
    NodeRuntime: MockNodeRuntime,
    isRetiredRuntimePromise: () => retiredRuntimeEvent,
  }));
  await import('@/engine/runtime/nodejs/runtimeWorker');
  await vi.waitFor(() => expect(posted).toContainEqual({ type: 'ready' }));

  const start: MainMessage = {
    type: 'start',
    runtimeId: 'runtime-1',
    scope: '/',
    fsPort: new MessageChannel().port1,
    options: { rootPath: '/workspace', filePath: '/workspace/main.js', argv: [] },
  };
  const messageListener = listeners.get('message');
  if (!messageListener) throw new Error('Runtime worker did not register its message listener.');
  messageListener(new MessageEvent<MainMessage>('message', { data: start }));

  await vi.waitFor(() => expect(runtimeOptions).toBeDefined());
  return {
    posted,
    listeners,
    options: () => runtimeOptions,
  };
}

interface IsolatedRuntimeResult {
  exitCode: number;
  unhandled?: string;
}

async function buildIsolatedRuntimeBundle(): Promise<string> {
  if (isolatedRuntimeBundle) return isolatedRuntimeBundle;
  const wrapper = `
    import { NodeRuntime } from './src/engine/runtime/nodejs/nodeRuntime.ts';
    import { RuntimeFsMount } from './src/engine/runtime/storage/RuntimeFsMount.ts';
    import { WorkerStdin } from './src/engine/runtime/nodejs/workerStdin.ts';
    import { MemoryFs } from './tests/_helpers/memoryFs.ts';
    (async () => {
      const { parentPort, workerData } = require('node:worker_threads');
      const filesystemCore = new MemoryFs();
      await filesystemCore.mkdir('/workspace', { recursive: true });
      await filesystemCore.writeFile('/workspace/main.js', new TextEncoder().encode(workerData.source));
      const bridge = {
        sync(request) { return filesystemCore.sync(request); },
        async(request) { return Promise.resolve(filesystemCore.sync(request)); },
        close() {},
      };
      const filesystem = new RuntimeFsMount(bridge);
      let unhandled;
      process.on('unhandledRejection', reason => { unhandled = String(reason); });
      const runtime = new NodeRuntime({
        rootPath: '/workspace',
        filePath: '/workspace/main.js',
        bridge,
        filesystem,
        processStdin: new WorkerStdin(() => {}, () => {}, () => {}),
        runShell: async () => ({ stdout: '', stderr: '', code: 0 }),
      });
      await runtime.execute('/workspace/main.js');
      await runtime.waitForEventLoop();
      await new Promise(resolve => setTimeout(resolve, 5));
      parentPort.postMessage({ exitCode: runtime.getExitCode(), unhandled });
    })();
  `;
  isolatedRuntimeBundle = build({
    stdin: {
      contents: wrapper,
      resolveDir: process.cwd(),
      sourcefile: 'node-runtime-isolated-test.js',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    tsconfig: 'tsconfig.json',
    external: ['esbuild'],
    define: {
      'import.meta.env': JSON.stringify({
        BASE_URL: '/',
        VITE_IS_DEV_SERVER: 'false',
        VITE_ENABLE_REACT_SCAN: 'false',
        PROD: false,
      }),
      __PYXIS_VERSION__: JSON.stringify('test'),
    },
  }).then(result => {
    const output = result.outputFiles[0];
    if (!output) throw new Error('Esbuild did not produce the isolated runtime bundle.');
    return output.text;
  });
  return isolatedRuntimeBundle;
}

async function runIsolatedRuntime(source: string): Promise<IsolatedRuntimeResult> {
  const worker = new Worker(await buildIsolatedRuntimeBundle(), {
    eval: true,
    workerData: { source },
  });
  return new Promise<IsolatedRuntimeResult>((resolve, reject) => {
    worker.once('message', (result: IsolatedRuntimeResult) => {
      resolve(result);
      void worker.terminate();
    });
    worker.once('error', reject);
  });
}

afterEach(() => {
  vi.doUnmock('@/engine/runtime/bridge/client');
  vi.doUnmock('@/engine/runtime/storage/RuntimeFsMount');
  vi.doUnmock('@/engine/runtime/nodejs/nodeRuntime');
  vi.unstubAllGlobals();
});

describe('runtime worker boundaries', () => {
  it('reports missing-file rejection only when caller leaves it unhandled', async () => {
    const unhandled = await runIsolatedRuntime(
      "require('fs').promises.readFile('/workspace/missing.txt');"
    );
    const caught = await runIsolatedRuntime(
      "require('fs').promises.readFile('/workspace/missing.txt').catch(() => {});"
    );

    expect(unhandled.exitCode).toBe(0);
    expect(unhandled.unhandled).toContain('ENOENT');
    expect(caught.exitCode).toBe(0);
    expect(caught.unhandled).toBeUndefined();
  });

  it('flushes buffered output and completes on exit while execute remains pending', async () => {
    const harness = await startWorker();
    harness.options()?.onStdout?.('buffered output');
    finishMockExecution?.();

    await vi.waitFor(() =>
      expect(harness.posted.some(item => item.type === 'complete')).toBe(true)
    );
    expect(harness.posted.find(item => item.type === 'output')).toEqual({
      type: 'output',
      entries: [{ channel: 'stdout', text: 'buffered output' }],
    });
    expect(harness.posted.find(item => item.type === 'complete')).toEqual({
      type: 'complete',
      result: { exitCode: 0 },
    });
  });

  it('keeps worker stdin and output payloads as bytes', async () => {
    const harness = await startWorker();
    const bytes = Buffer.from([9, 0, 255, 128, 9]).subarray(1, 4);
    const received: Buffer[] = [];
    harness.options()?.processStdin.on('data', chunk => received.push(chunk));
    const messageListener = harness.listeners.get('message');
    if (!messageListener) throw new Error('Worker message listener missing');
    const message: MainMessage = { type: 'stdin', data: bytes };
    messageListener(new MessageEvent<MainMessage>('message', { data: message }));
    harness.options()?.onStdout?.(bytes);
    await Promise.resolve();
    finishMockExecution?.();
    await vi.waitFor(() =>
      expect(harness.posted.some(message => message.type === 'complete')).toBe(true)
    );
    expect(Buffer.concat(received)).toEqual(bytes);
    const output = harness.posted.find(message => message.type === 'output');
    expect(output).toEqual({ type: 'output', entries: [{ channel: 'stdout', text: bytes }] });
  });

  it('completes with failure for an uncaught worker error', async () => {
    const harness = await startWorker();
    harness.options()?.onStdout?.('output before fatal');
    const errorEventListener = harness.listeners.get('error');
    if (!errorEventListener) throw new Error('Runtime worker did not register its error listener.');
    const errorEvent = new Event('error');
    Object.defineProperty(errorEvent, 'message', { value: 'worker error' });
    Object.defineProperty(errorEvent, 'error', { value: new Error('worker error') });
    errorEventListener(errorEvent);

    await vi.waitFor(() => expect(harness.posted.some(item => item.type === 'fatal')).toBe(true));
    expect(harness.posted.find(item => item.type === 'fatal')).toMatchObject({
      type: 'fatal',
      error: 'worker error',
    });
    expect(harness.posted.find(item => item.type === 'output')).toEqual({
      type: 'output',
      entries: [{ channel: 'stdout', text: 'output before fatal' }],
    });
    expect(harness.posted.findIndex(item => item.type === 'output')).toBeLessThan(
      harness.posted.findIndex(item => item.type === 'fatal')
    );
  });

  it('completes with failure for an unhandled worker rejection', async () => {
    const harness = await startWorker();
    const rejectionListener = harness.listeners.get('unhandledrejection');
    if (!rejectionListener) {
      throw new Error('Runtime worker did not register its rejection listener.');
    }
    const rejectionEvent = new Event('unhandledrejection');
    Object.defineProperty(rejectionEvent, 'reason', { value: new Error('worker rejection') });
    rejectionListener(rejectionEvent);

    await vi.waitFor(() => expect(harness.posted.some(item => item.type === 'fatal')).toBe(true));
    expect(harness.posted.find(item => item.type === 'fatal')).toMatchObject({
      type: 'fatal',
      error: 'Error: worker rejection',
    });
  });

  it('accepts a new execution only after the prior execution cleanup completes', async () => {
    const harness = await startWorker();
    finishMockExecution?.();
    await vi.waitFor(() =>
      expect(harness.posted.filter(item => item.type === 'complete')).toHaveLength(1)
    );

    const start: MainMessage = {
      type: 'start',
      runtimeId: 'runtime-2',
      scope: '/',
      fsPort: new MessageChannel().port1,
      options: { rootPath: '/workspace', filePath: '/workspace/next.js', argv: [] },
    };
    const messageListener = harness.listeners.get('message');
    if (!messageListener) throw new Error('Runtime worker did not register its message listener.');
    messageListener(new MessageEvent<MainMessage>('message', { data: start }));
    await vi.waitFor(() => expect(mockExecutionCount).toBe(2));
    finishMockExecution?.();
    await vi.waitFor(() =>
      expect(harness.posted.filter(item => item.type === 'complete')).toHaveLength(2)
    );
  });

  it('rejects outstanding shell work when an execution completes', async () => {
    const harness = await startWorker();
    const shellResult = harness.options()?.runShell('long running command');
    const rejection = expect(shellResult).rejects.toThrow('Runtime execution has ended.');
    finishMockExecution?.();
    await vi.waitFor(() =>
      expect(harness.posted.some(item => item.type === 'complete')).toBe(true)
    );
    await rejection;
  });

  it('ignores only the retired promise when its rejection arrives after reuse', async () => {
    const harness = await startWorker();
    finishMockExecution?.();
    await vi.waitFor(() =>
      expect(harness.posted.filter(item => item.type === 'complete')).toHaveLength(1)
    );

    const rejectionListener = harness.listeners.get('unhandledrejection');
    if (!rejectionListener) throw new Error('Runtime worker rejection listener missing.');
    const rejectionEvent = new Event('unhandledrejection');
    Object.defineProperty(rejectionEvent, 'promise', { value: Promise.resolve() });
    Object.defineProperty(rejectionEvent, 'reason', { value: new Error('Runtime closed.') });
    retiredRuntimeEvent = true;
    rejectionListener(rejectionEvent);

    expect(harness.posted.some(item => item.type === 'fatal')).toBe(false);

    retiredRuntimeEvent = false;
    rejectionListener(rejectionEvent);
    expect(harness.posted.some(item => item.type === 'fatal')).toBe(true);
  });
});
