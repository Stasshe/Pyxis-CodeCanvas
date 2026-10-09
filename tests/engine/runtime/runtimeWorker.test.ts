import { PassThrough } from 'node:stream';
import { format as nativeFormat } from 'node:util';
import { Worker } from 'node:worker_threads';
import { Buffer } from 'buffer';
import { build } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionOptions } from '@/engine/runtime/nodejs/nodeRuntime';
import { createProcessExitSignal } from '@/engine/runtime/nodejs/processExit';
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

class MockRuntimeBridgeClosedError extends Error {
  constructor(readonly runtimeId: string) {
    super('Runtime bridge closed.');
    this.name = 'RuntimeBridgeClosedError';
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

  handleUncaughtException(): boolean {
    return false;
  }

  handleUnhandledRejection(): boolean {
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

  vi.doMock('@/engine/runtime/bridge/client', () => ({
    RuntimeBridge: MockRuntimeBridge,
    RuntimeBridgeClosedError: MockRuntimeBridgeClosedError,
  }));
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
    options: { rootPath: '/workspace', filePath: '/workspace/main.js', argv: [], execArgv: [] },
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
  output: string[];
}

async function buildIsolatedRuntimeBundle(): Promise<string> {
  if (isolatedRuntimeBundle) return isolatedRuntimeBundle;
  const wrapper = `
    import { NodeRuntime } from './src/engine/runtime/nodejs/nodeRuntime.ts';
    import { RuntimeFsMount } from './src/engine/runtime/storage/RuntimeFsMount.ts';
    import { WorkerStdin } from './src/engine/runtime/nodejs/workerStdin.ts';
    import { isProcessExitSignal } from './src/engine/runtime/nodejs/processExit.ts';
    import { MemoryFs } from './tests/_helpers/memoryFs.ts';
    (async () => {
      const { parentPort, workerData } = require('node:worker_threads');
      const hostProcess = process;
      const hostSetTimeout = setTimeout;
      const filesystemCore = new MemoryFs();
      await filesystemCore.mkdir('/workspace', { recursive: true });
      const filePath = '/workspace/' + workerData.fileName;
      await filesystemCore.writeFile(filePath, new TextEncoder().encode(workerData.source));
      const bridge = {
        sync(request) { return filesystemCore.sync(request); },
        async(request) { return Promise.resolve(filesystemCore.sync(request)); },
        close() {},
      };
      const filesystem = new RuntimeFsMount(bridge);
      let unhandled;
      const output = [];
      let runtimeAlive = true;
      const runtime = new NodeRuntime({
        rootPath: '/workspace',
        filePath,
        bridge,
        filesystem,
        processStdin: new WorkerStdin(() => {}, () => {}, () => {}),
        runShell: async () => ({ stdout: '', stderr: '', code: 0 }),
        debugConsole: {
          log: (...args) => output.push(args.map(String).join(' ')),
          error: (...args) => output.push(args.map(String).join(' ')),
          warn: (...args) => output.push(args.map(String).join(' ')),
          clear() {},
        },
      });
      hostProcess.on('unhandledRejection', (reason, promise) => {
        unhandled = String(reason);
        try {
          if (runtimeAlive) runtime.handleUnhandledRejection(reason, promise);
        } catch (error) {
          if (!isProcessExitSignal(error)) throw error;
        }
      });
      hostProcess.on('uncaughtException', error => {
        try {
          if (!runtimeAlive || !runtime.handleUncaughtException(error)) throw error;
        } catch (listenerError) {
          if (!isProcessExitSignal(listenerError)) throw listenerError;
        }
      });
      await runtime.execute(filePath);
      await runtime.waitForEventLoop();
      runtimeAlive = false;
      runtime.dispose();
      await new Promise(resolve => hostSetTimeout(resolve, 5));
      parentPort.postMessage({ exitCode: runtime.getExitCode(), unhandled, output });
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

async function runIsolatedRuntime(
  source: string,
  fileName = 'main.js'
): Promise<IsolatedRuntimeResult> {
  const worker = new Worker(await buildIsolatedRuntimeBundle(), {
    eval: true,
    workerData: { source, fileName },
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
  vi.restoreAllMocks();
  vi.doUnmock('@/engine/runtime/bridge/client');
  vi.doUnmock('@/engine/runtime/storage/RuntimeFsMount');
  vi.doUnmock('@/engine/runtime/nodejs/nodeRuntime');
  vi.unstubAllGlobals();
});

describe('runtime worker boundaries', () => {
  it.each(['error', 'unhandledrejection'] as const)(
    'completes when the %s listener exits the process',
    async type => {
      const harness = await startWorker();
      const handler = {
        error: 'handleUncaughtException',
        unhandledrejection: 'handleUnhandledRejection',
      } as const;
      vi.spyOn(MockNodeRuntime.prototype, handler[type]).mockImplementation(() => {
        throw createProcessExitSignal(7);
      });
      const event = new Event(type);
      Object.defineProperties(event, {
        error: { value: new Error('guest failure') },
        reason: { value: new Error('guest failure') },
      });
      harness.listeners.get(type)?.(event);
      expect(harness.posted).toContainEqual({ type: 'complete', result: { exitCode: 7 } });
      expect(harness.posted.some(message => message.type === 'fatal')).toBe(false);
      finishMockExecution?.();
    }
  );

  it.each(['error', 'unhandledrejection'] as const)(
    'keeps an ordinary %s listener exception fatal',
    async type => {
      const harness = await startWorker();
      const handler = {
        error: 'handleUncaughtException',
        unhandledrejection: 'handleUnhandledRejection',
      } as const;
      vi.spyOn(MockNodeRuntime.prototype, handler[type]).mockImplementation(() => {
        throw new Error('listener failure');
      });
      const event = new Event(type);
      Object.defineProperties(event, {
        error: { value: new Error('guest failure') },
        reason: { value: new Error('guest failure') },
      });
      harness.listeners.get(type)?.(event);
      expect(harness.posted).toContainEqual({
        type: 'fatal',
        error: expect.stringContaining('listener failure'),
      });
      expect(harness.posted.some(message => message.type === 'complete')).toBe(false);
      finishMockExecution?.();
    }
  );

  it('preserves process exit from an interrupt exception listener', async () => {
    const harness = await startWorker();
    vi.spyOn(MockNodeRuntime.prototype, 'interrupt').mockImplementation(() => {
      throw new Error('interrupt failure');
    });
    vi.spyOn(MockNodeRuntime.prototype, 'handleUncaughtException').mockImplementation(() => {
      throw createProcessExitSignal(7);
    });
    harness.listeners.get('message')?.(
      new MessageEvent<MainMessage>('message', { data: { type: 'interrupt' } })
    );
    expect(harness.posted).toContainEqual({ type: 'complete', result: { exitCode: 7 } });
    expect(harness.posted.some(message => message.type === 'fatal')).toBe(false);
    finishMockExecution?.();
  });

  it.each([
    ['uncaughtException', "process.nextTick(() => { throw new Error('guest failure'); });"],
    ['unhandledRejection', "Promise.reject(new Error('guest failure'));"],
  ])('preserves exit from a real guest %s listener', async (type, trigger) => {
    const result = await runIsolatedRuntime(`
      process.on('exit', code => console.log('exit', code));
      process.on('${type}', () => {
        console.log('listener');
        process.exit(7);
      });
      ${trigger}
    `);
    expect(result.output).toEqual(['listener', 'exit 7']);
    expect(result.exitCode).toBe(7);
  });

  it('continues queued next ticks after handled exceptions like native Node', async () => {
    const source = `
      process.on('uncaughtException', error => console.log('error:' + error.message));
      process.nextTick(() => { throw new Error('first'); });
      process.nextTick(() => { throw new Error('second'); });
      process.nextTick(() => console.log('ordinary'));
    `;
    const nativeWorker = new Worker(
      `
      const { parentPort } = require('node:worker_threads');
      const output = [];
      console.log = (...args) => output.push(args.map(String).join(' '));
      process.on('exit', () => parentPort.postMessage(output));
      ${source}
      `,
      { eval: true }
    );
    const nativeOutput = await new Promise<string[]>((resolve, reject) => {
      nativeWorker.once('message', resolve);
      nativeWorker.once('error', reject);
    });
    const result = await runIsolatedRuntime(source);

    expect(nativeOutput).toEqual(['error:first', 'error:second', 'ordinary']);
    expect(result.output).toEqual(nativeOutput);
    expect(result.exitCode).toBe(0);
  });

  it('stops queued next ticks when an exception is unhandled', async () => {
    await expect(
      runIsolatedRuntime(`
        process.nextTick(() => { throw new Error('unhandled tick'); });
        process.nextTick(() => console.log('must not run'));
      `)
    ).rejects.toThrow('unhandled tick');
  });

  it('does not run remaining next ticks after the process exits', async () => {
    const result = await runIsolatedRuntime(`
      process.nextTick(() => process.exit(7));
      process.nextTick(() => console.log('must not run'));
    `);
    expect(result.output).toEqual([]);
    expect(result.exitCode).toBe(7);
  });

  it('loads events default and named exports from an mjs runtime entry', async () => {
    const result = await runIsolatedRuntime(
      `
        import DefaultEventEmitter, { EventEmitter, once, on } from 'node:events';
        void (async () => {
          const emitter = new EventEmitter();
          const onceResult = once(emitter, 'complete');
          emitter.emit('complete', 'done', 1);
          const [onceValue, onceCount] = await onceResult;
          const iterator = on(emitter, 'data');
          emitter.emit('data', 'chunk', 2);
          const [dataValue, dataCount] = (await iterator.next()).value;
          await iterator.return();
          console.log(
            typeof once,
            typeof on,
            DefaultEventEmitter === EventEmitter,
            onceValue,
            onceCount,
            dataValue,
            dataCount,
          );
        })().catch(error => {
          throw new Error('events ESM import fixture failed: ' + String(error));
        });
      `,
      'main.mjs'
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('function function true done 1 chunk 2');
  });

  it('formats guest console arguments like Node without changing runtime logger output', async () => {
    const harness = await startWorker();
    const debugConsole = harness.options()?.debugConsole;
    if (!debugConsole) throw new Error('Runtime worker debug console missing.');

    const error = new Error('No such built-in module: node:missing');
    error.stack =
      'Error: No such built-in module: node:missing\n    at Module.require (runtime.js:1:1)';
    const circular: { self?: object } = {};
    circular.self = circular;
    debugConsole.error(error);
    debugConsole.log('%s %d', 'value', 17);
    debugConsole.warn(circular, 23n);
    const { runtimeInfo } = await import('@/engine/runtime/core/runtimeLogger');
    runtimeInfo('diagnostic:', { rootPath: '/workspace' });

    finishMockExecution?.();
    await vi.waitFor(() =>
      expect(harness.posted.some(message => message.type === 'complete')).toBe(true)
    );
    const output = harness.posted.find(message => message.type === 'output');
    if (output?.type !== 'output') throw new Error('Expected guest console output.');
    const guestEntries = output.entries.filter(entry => entry.channel !== 'debug');
    expect(guestEntries).toEqual([
      { channel: 'error', text: nativeFormat(error) },
      { channel: 'log', text: nativeFormat('%s %d', 'value', 17) },
      { channel: 'warn', text: nativeFormat(circular, 23n) },
    ]);
    expect(guestEntries[0]?.text).toContain(error.message);
    expect(guestEntries[0]?.text).toContain('at Module.require');
    expect(output.entries).toContainEqual({
      channel: 'debug',
      text: 'diagnostic: {"rootPath":"/workspace"}',
      level: 'info',
    });
  });

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

  it('handles unhandled rejections before natural exit and drains listener timer work', async () => {
    const unhandled = await runIsolatedRuntime(`
      process.on('unhandledRejection', reason => {
        console.log('rejection:', reason);
        setTimeout(() => console.log('timer work'), 0);
      });
      process.on('exit', () => console.log('exit'));
      setTimeout(() => Promise.reject('guest failure'), 0);
    `);
    const caught = await runIsolatedRuntime(`
      process.on('unhandledRejection', () => console.log('unexpected rejection'));
      process.on('exit', () => console.log('exit'));
      Promise.reject('caught failure').catch(() => {});
    `);

    expect(unhandled.output).toEqual(['rejection: guest failure', 'timer work', 'exit']);
    expect(unhandled.exitCode).toBe(0);
    expect(caught.output).toEqual(['exit']);
    expect(caught.exitCode).toBe(0);
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

  it('streams shell output to the caller and sends its requested kill signal', async () => {
    const harness = await startWorker();
    const callbacks = { stdout: vi.fn(), stderr: vi.fn() };
    const controller = new AbortController();
    const shell = harness.options()?.runShell('long-command', {
      signal: controller.signal,
      onStdout: callbacks.stdout,
      onStderr: callbacks.stderr,
    });
    if (!shell) throw new Error('Runtime shell runner missing.');
    const request = harness.posted.find(item => item.type === 'shell');
    if (!request || request.type !== 'shell') throw new Error('Expected shell request.');
    const messageListener = harness.listeners.get('message');
    if (!messageListener) throw new Error('Runtime worker message listener missing.');

    messageListener(
      new MessageEvent<MainMessage>('message', {
        data: { type: 'shell-output', id: request.id, channel: 'stdout', data: 'first' },
      })
    );
    messageListener(
      new MessageEvent<MainMessage>('message', {
        data: { type: 'shell-output', id: request.id, channel: 'stderr', data: 'second' },
      })
    );
    expect(callbacks.stdout).toHaveBeenCalledWith('first');
    expect(callbacks.stderr).toHaveBeenCalledWith('second');

    controller.abort('SIGTERM');
    expect(harness.posted).toContainEqual({
      type: 'shell-cancel',
      id: request.id,
      signal: 'SIGTERM',
    });
    await expect(shell).rejects.toThrow('Shell command was aborted.');
    finishMockExecution?.();
  });

  it('sends child stdin bytes with bounded acknowledgement and EOF', async () => {
    const harness = await startWorker();
    const stdin = new PassThrough();
    stdin.write(Buffer.from('first'));
    stdin.end(Buffer.from('second'));
    const shell = harness.options()?.runShell('input-command', { stdin });
    if (!shell) throw new Error('Runtime shell runner missing.');
    const request = harness.posted.find(item => item.type === 'shell');
    if (!request || request.type !== 'shell') throw new Error('Expected shell request.');
    const messageListener = harness.listeners.get('message');
    if (!messageListener) throw new Error('Runtime worker message listener missing.');
    expect(request.hasStdin).toBe(true);

    await vi.waitFor(() =>
      expect(harness.posted).toContainEqual({
        type: 'shell-input',
        id: request.id,
        data: Buffer.from('first'),
      })
    );
    expect(harness.posted.filter(message => message.type === 'shell-input')).toHaveLength(1);

    messageListener(
      new MessageEvent<MainMessage>('message', {
        data: { type: 'shell-input-ack', id: request.id },
      })
    );
    await vi.waitFor(() =>
      expect(harness.posted).toContainEqual({
        type: 'shell-input',
        id: request.id,
        data: Buffer.from('second'),
      })
    );
    messageListener(
      new MessageEvent<MainMessage>('message', {
        data: { type: 'shell-input-ack', id: request.id },
      })
    );
    await vi.waitFor(() =>
      expect(harness.posted).toContainEqual({ type: 'shell-input-end', id: request.id })
    );

    messageListener(
      new MessageEvent<MainMessage>('message', {
        data: {
          type: 'shell-result',
          id: request.id,
          result: { stdout: '', stderr: '', code: 0 },
        },
      })
    );
    await expect(shell).resolves.toEqual({ stdout: '', stderr: '', code: 0 });
    expect(stdin.listenerCount('data')).toBe(0);
    expect(stdin.listenerCount('end')).toBe(0);
    finishMockExecution?.();
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
    const fatal = harness.posted.find(item => item.type === 'fatal');
    expect(fatal?.type).toBe('fatal');
    if (fatal?.type !== 'fatal') throw new Error('Expected worker fatal message.');
    expect(fatal.error).toContain('worker error');
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
    const fatal = harness.posted.find(item => item.type === 'fatal');
    expect(fatal?.type).toBe('fatal');
    if (fatal?.type !== 'fatal') throw new Error('Expected worker fatal message.');
    expect(fatal.error).toContain('worker rejection');
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
      options: { rootPath: '/workspace', filePath: '/workspace/next.js', argv: [], execArgv: [] },
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

  it('ignores a typed bridge-close rejection from an earlier execution only', async () => {
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
      options: { rootPath: '/workspace', filePath: '/workspace/next.js', argv: [], execArgv: [] },
    };
    const messageListener = harness.listeners.get('message');
    if (!messageListener) throw new Error('Runtime worker message listener missing.');
    messageListener(new MessageEvent<MainMessage>('message', { data: start }));
    await vi.waitFor(() => expect(mockExecutionCount).toBe(2));

    const rejectionListener = harness.listeners.get('unhandledrejection');
    if (!rejectionListener) throw new Error('Runtime worker rejection listener missing.');
    const stale = new Event('unhandledrejection');
    Object.defineProperties(stale, {
      promise: { value: Promise.resolve() },
      reason: { value: new MockRuntimeBridgeClosedError('runtime-1') },
    });
    rejectionListener(stale);
    expect(harness.posted.some(item => item.type === 'fatal')).toBe(false);

    const active = new Event('unhandledrejection');
    Object.defineProperties(active, {
      promise: { value: Promise.resolve() },
      reason: { value: new MockRuntimeBridgeClosedError('runtime-2') },
    });
    rejectionListener(active);
    expect(harness.posted.some(item => item.type === 'fatal')).toBe(true);
  });
});
