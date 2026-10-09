import { fileURLToPath } from 'node:url';
import { type Transferable, Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import type { MainMessage, WorkerMessage } from '@/engine/system/runtime/nodejs/workerProtocol';

let bundle: string | undefined;

export async function prepareRuntimeWorker(): Promise<void> {
  if (bundle) return;
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./runtimeWorkerEntry.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    tsconfig: 'tsconfig.json',
    external: ['esbuild'],
    define: {
      'import.meta.env': JSON.stringify({ BASE_URL: '/', PROD: false }),
      __PYXIS_VERSION__: JSON.stringify('test'),
    },
    plugins: [
      {
        name: 'fixture-sync-message',
        setup(builder) {
          builder.onResolve({ filter: /^sync-message$/ }, () => ({
            path: 'sync-message',
            namespace: 'fixture',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents:
              'export const makeServiceWorkerChannel = () => ({}); export const readMessage = () => null;',
          }));
        },
      },
    ],
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error('Esbuild did not produce the runtime worker bundle.');
  bundle = output.text;
}

/** The browser Worker contract backed by an actual isolated Node.js thread. */
export class RuntimeWorker {
  private static readonly instances = new Set<RuntimeWorker>();
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  private readonly events = new EventTarget();
  private readonly worker: Worker;
  private termination: Promise<number> | undefined;

  constructor() {
    if (!bundle) throw new Error('Prepare the runtime worker before constructing it.');
    this.worker = new Worker(bundle, { eval: true });
    RuntimeWorker.instances.add(this);
    this.worker.on('exit', () => RuntimeWorker.instances.delete(this));
    this.worker.on('message', (data: WorkerMessage) => {
      const event = new MessageEvent<WorkerMessage>('message', { data });
      this.onmessage?.(event);
      this.events.dispatchEvent(event);
    });
    this.worker.on('error', error => {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      const event = Object.assign(new Event('error'), {
        error,
        message,
        filename: '',
        lineno: 0,
        colno: 0,
      });
      this.onerror?.(event);
      this.events.dispatchEvent(event);
    });
    this.worker.on('messageerror', error => {
      const event = new MessageEvent('messageerror', { data: error });
      this.onmessageerror?.(event);
      this.events.dispatchEvent(event);
    });
  }

  static async closeAll(): Promise<void> {
    await Promise.all([...RuntimeWorker.instances].map(worker => worker.close()));
  }

  addEventListener(type: string, listener: EventListener): void {
    this.events.addEventListener(type, listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.events.removeEventListener(type, listener);
  }

  postMessage(message: MainMessage, transfer: readonly Transferable[] = []): void {
    this.worker.postMessage(message, transfer);
  }

  terminate(): void {
    this.termination ??= this.worker.terminate();
  }

  async close(): Promise<void> {
    this.terminate();
    await this.termination;
  }
}
