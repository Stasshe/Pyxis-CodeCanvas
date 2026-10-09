import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import { vi } from 'vitest';
import { RuntimeBridge } from '@/engine/runtime/bridge/client';
import { attachRuntimePort } from '@/engine/runtime/bridge/endpoint';
import type { RpcValue, TranspileRequest } from '@/engine/runtime/bridge/protocol';
import { setRuntimeLogSink } from '@/engine/runtime/core/runtimeLogger';
import { type ExecutionOptions, NodeRuntime } from '@/engine/runtime/nodejs/nodeRuntime';
import { WorkerStdin } from '@/engine/runtime/nodejs/workerStdin';
import { RuntimeFsMount } from '@/engine/runtime/storage/RuntimeFsMount';
import { MemoryFs } from './memoryFs';

interface TranspileWorkerResponse {
  id: number;
  result: { ok: true; value: RpcValue } | { ok: false; error: string; code?: string };
}

let transpilerWorkerBundle: Promise<string> | undefined;

async function buildTranspilerWorkerBundle(): Promise<string> {
  if (!transpilerWorkerBundle) {
    transpilerWorkerBundle = build({
      entryPoints: [fileURLToPath(new URL('./nodeRuntimeTranspilerWorker.ts', import.meta.url))],
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
      if (!output) throw new Error('Esbuild did not produce the transpiler worker bundle.');
      return output.text;
    });
  }
  return transpilerWorkerBundle;
}

export class NativeTranspiler {
  private readonly worker: Worker;
  private readonly pending = new Map<
    number,
    {
      resolve(value: RpcValue): void;
      reject(error: Error): void;
    }
  >();
  private nextId = 0;

  private constructor(worker: Worker) {
    this.worker = worker;
    worker.on('message', (response: TranspileWorkerResponse) => {
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.result.ok) {
        pending.resolve(response.result.value);
      } else {
        pending.reject(
          Object.assign(new Error(response.result.error), { code: response.result.code })
        );
      }
    });
    worker.on('error', error => this.rejectAll(error));
    worker.on('exit', code => {
      if (code !== 0) this.rejectAll(new Error(`Transpiler worker exited with code ${code}.`));
    });
  }

  static async create(): Promise<NativeTranspiler> {
    const worker = new Worker(await buildTranspilerWorkerBundle(), { eval: true });
    return new NativeTranspiler(worker);
  }

  transform(request: TranspileRequest): Promise<RpcValue> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, request });
    });
  }

  close(): void {
    void this.worker.terminate();
    this.rejectAll(new Error('Transpiler worker closed.'));
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

vi.mock('sync-message', () => ({
  makeServiceWorkerChannel: vi.fn(() => ({})),
  readMessage: vi.fn(() => null),
}));

export interface NodeRuntimeFixture {
  runtime: NodeRuntime;
  rootPath: string;
  bridge: RuntimeBridge;
  filesystem: RuntimeFsMount;
  fs: MemoryFs;
  stdin: WorkerStdin;
  close(): void;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
}

export interface RuntimeDebugConsole {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  clear: () => void;
}

export async function createNodeRuntimeFixture(
  rootPath = '/tmp/runtime-tests',
  debugConsole?: RuntimeDebugConsole,
  cwd = rootPath,
  onExit?: (code: number) => void,
  sharedFs?: MemoryFs,
  outputStreams?: Pick<ExecutionOptions, 'onStdout' | 'onStderr'>
): Promise<NodeRuntimeFixture> {
  setRuntimeLogSink(() => {});
  // The native compiler service stays isolated from guest globals, like the production workers.
  const transpiler = await NativeTranspiler.create();
  await transpiler.transform({ kind: 'transpile', code: '', filePath: '/fixture.mjs' });
  const fs = sharedFs ?? new MemoryFs();
  await fs.mkdir(rootPath, { recursive: true });
  const channel = new MessageChannel();
  const bridge = new RuntimeBridge('/', channel.port2, crypto.randomUUID(), () => {
    throw new Error('Unexpected runtime cancellation.');
  });
  const transpile = (request: TranspileRequest): Promise<RpcValue> => transpiler.transform(request);
  attachRuntimePort(channel.port1, fs, transpile);
  vi.spyOn(bridge, 'sync').mockImplementation(request => fs.sync(request));
  const filesystem = new RuntimeFsMount(bridge);
  let runtime: NodeRuntime;
  const stdin = new WorkerStdin(
    promise => runtime.trackIO(promise),
    () => {},
    () => {}
  );
  runtime = new NodeRuntime({
    rootPath,
    cwd,
    filePath: `${rootPath}/entry.js`,
    bridge,
    filesystem,
    runShell: async () => ({ stdout: '', stderr: '', code: 0 }),
    processStdin: stdin,
    ...outputStreams,
    debugConsole,
    onExit: code => {
      runtime.dispose();
      onExit?.(code);
    },
  });
  return {
    runtime,
    rootPath,
    bridge,
    filesystem,
    fs,
    stdin,
    close() {
      runtime.dispose();
      bridge.close();
      channel.port1.close();
      transpiler.close();
    },
    async writeFile(path, content) {
      const parent = path.slice(0, path.lastIndexOf('/')) || '/';
      await fs.mkdir(parent, { recursive: true });
      const data = typeof content === 'string' ? new TextEncoder().encode(content) : content;
      await fs.writeFile(path, data);
    },
  };
}
