import { Worker } from 'node:worker_threads';
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
    return new Promise<void>(() => {});
  }

  waitForEventLoop(): Promise<void> {
    return new Promise<void>(() => {});
  }

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
  vi.doMock('@/engine/runtime/nodejs/nodeRuntime', () => ({ NodeRuntime: MockNodeRuntime }));
  await import('@/engine/runtime/nodejs/runtimeWorker');

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
    harness.options()?.onExit?.(5);

    await vi.waitFor(() => expect(harness.posted).toHaveLength(2));
    expect(harness.posted[0]).toEqual({
      type: 'output',
      entries: [{ channel: 'stdout', text: 'buffered output' }],
    });
    expect(harness.posted[1]).toEqual({ type: 'complete', result: { exitCode: 5 } });
  });

  it('completes with failure for an uncaught worker error', async () => {
    const harness = await startWorker();
    const errorEventListener = harness.listeners.get('error');
    if (!errorEventListener) throw new Error('Runtime worker did not register its error listener.');
    const errorEvent = new Event('error');
    Object.defineProperty(errorEvent, 'message', { value: 'worker error' });
    Object.defineProperty(errorEvent, 'error', { value: new Error('worker error') });
    errorEventListener(errorEvent);

    await vi.waitFor(() => expect(harness.posted).toHaveLength(1));
    expect(harness.posted[0]).toMatchObject({ type: 'complete', result: { exitCode: 1 } });
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

    await vi.waitFor(() => expect(harness.posted).toHaveLength(1));
    expect(harness.posted[0]).toMatchObject({ type: 'complete', result: { exitCode: 1 } });
  });
});
