import { pushLogMessage } from '@/stores/loggerStore';
import type { MainMessage, WorkerMessage } from './workerProtocol';

export interface RuntimeWorkerLike {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: MainMessage, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerMessage>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  addEventListener(type: 'messageerror', listener: () => void): void;
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerMessage>) => void
  ): void;
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: 'messageerror', listener: () => void): void;
}

function describeWorkerError(event: ErrorEvent): string {
  if (event.error instanceof Error) {
    return event.error.stack ?? `${event.error.name}: ${event.error.message}`;
  }
  if (event.message) return event.message;
  if (event.filename) return `${event.filename}:${event.lineno}:${event.colno}`;
  return 'Runtime worker failed before it became ready.';
}

function waitUntilReady(worker: RuntimeWorkerLike): Promise<RuntimeWorkerLike> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<WorkerMessage>) => {
      if (event.data.type !== 'ready' && event.data.type !== 'fatal') return;
      cleanup();
      if (event.data.type === 'fatal') reject(new Error(event.data.error));
      else resolve(worker);
    };
    const onError = (event: ErrorEvent) => {
      event.preventDefault();
      cleanup();
      worker.terminate();
      reject(new Error(describeWorkerError(event)));
    };
    const onMessageError = () => {
      cleanup();
      reject(new Error('Runtime worker message could not be decoded during startup.'));
    };
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);
  });
}

export class RuntimeWorkerPool {
  private idle: Promise<RuntimeWorkerLike> | undefined;
  private readonly idleErrors = new Map<RuntimeWorkerLike, (event: ErrorEvent) => void>();
  private readonly idleMessages = new Map<
    RuntimeWorkerLike,
    (event: MessageEvent<WorkerMessage>) => void
  >();
  private readonly idleMessageErrors = new Map<RuntimeWorkerLike, () => void>();

  constructor(private readonly createWorker: () => RuntimeWorkerLike) {
    this.prepareIdle();
  }

  async acquire(): Promise<{ worker: RuntimeWorkerLike; prepared: boolean }> {
    let worker: RuntimeWorkerLike;
    let prepared = false;
    if (this.idle) {
      const readyWorker = this.idle;
      this.idle = undefined;
      worker = await readyWorker;
      this.removeIdleErrorHandler(worker);
      prepared = true;
    } else {
      worker = await this.prepareWorker();
    }
    return { worker, prepared };
  }

  release(worker: RuntimeWorkerLike): void {
    this.clearHandlers(worker);
    if (this.idle) {
      worker.terminate();
      return;
    }
    let held: Promise<RuntimeWorkerLike>;
    held = Promise.resolve(worker).then(readyWorker => {
      const onError = (event: ErrorEvent) => {
        event.preventDefault();
        if (this.idle !== held) return;
        this.retireIdleWorker(readyWorker, held, event.message);
      };
      this.idleErrors.set(readyWorker, onError);
      readyWorker.addEventListener('error', onError);
      this.watchIdleMessages(readyWorker, held);
      return readyWorker;
    });
    this.idle = held;
  }

  discard(worker: RuntimeWorkerLike): void {
    this.clearHandlers(worker);
    worker.terminate();
    this.prepareIdle();
  }

  async dispose(): Promise<void> {
    const prepared = this.idle;
    if (!prepared) return;
    this.idle = undefined;
    try {
      const worker = await prepared;
      this.clearHandlers(worker);
      worker.terminate();
    } catch {
      return;
    }
  }

  private prepareIdle(): void {
    if (this.idle) return;
    let preparation: Promise<RuntimeWorkerLike>;
    preparation = this.prepareWorker()
      .then(worker => {
        const onError = (event: ErrorEvent) => {
          event.preventDefault();
          if (this.idle !== preparation) return;
          this.retireIdleWorker(worker, preparation, event.message);
        };
        this.idleErrors.set(worker, onError);
        worker.addEventListener('error', onError);
        this.watchIdleMessages(worker, preparation);
        return worker;
      })
      .catch(error => {
        if (this.idle === preparation) this.idle = undefined;
        pushLogMessage(
          `Runtime worker could not be prepared: ${String(error)}`,
          'error',
          'Runtime'
        );
        throw error;
      });
    this.idle = preparation;
    void this.idle.catch(() => {});
  }

  private async prepareWorker(): Promise<RuntimeWorkerLike> {
    const worker = this.createWorker();
    try {
      await waitUntilReady(worker);
      return worker;
    } catch (error) {
      worker.terminate();
      throw error;
    }
  }

  private clearHandlers(worker: RuntimeWorkerLike): void {
    this.removeIdleErrorHandler(worker);
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
  }

  private removeIdleErrorHandler(worker: RuntimeWorkerLike): void {
    const onError = this.idleErrors.get(worker);
    if (!onError) return;
    worker.removeEventListener('error', onError);
    this.idleErrors.delete(worker);
    const onMessage = this.idleMessages.get(worker);
    if (onMessage) worker.removeEventListener('message', onMessage);
    this.idleMessages.delete(worker);
    const onMessageError = this.idleMessageErrors.get(worker);
    if (onMessageError) worker.removeEventListener('messageerror', onMessageError);
    this.idleMessageErrors.delete(worker);
  }

  private watchIdleMessages(worker: RuntimeWorkerLike, slot: Promise<RuntimeWorkerLike>): void {
    const onMessage = (event: MessageEvent<WorkerMessage>) => {
      if (event.data.type !== 'fatal') return;
      this.retireIdleWorker(worker, slot, event.data.error);
    };
    const onMessageError = () => {
      this.retireIdleWorker(worker, slot, 'Runtime worker message could not be decoded.');
    };
    this.idleMessages.set(worker, onMessage);
    this.idleMessageErrors.set(worker, onMessageError);
    worker.addEventListener('message', onMessage);
    worker.addEventListener('messageerror', onMessageError);
  }

  private retireIdleWorker(
    worker: RuntimeWorkerLike,
    slot: Promise<RuntimeWorkerLike>,
    reason: string
  ): void {
    if (this.idle !== slot) return;
    this.removeIdleErrorHandler(worker);
    worker.terminate();
    this.idle = undefined;
    pushLogMessage(`Idle runtime worker was discarded: ${reason}`, 'error', 'Runtime');
    this.prepareIdle();
  }
}

let workerPool: RuntimeWorkerPool | undefined;

function getWorkerPool(): RuntimeWorkerPool {
  if (!workerPool) {
    workerPool = new RuntimeWorkerPool(
      () => new Worker(new URL('./runtimeWorker.ts', import.meta.url), { type: 'module' })
    );
  }
  return workerPool;
}

export function acquireRuntimeWorker(): Promise<{ worker: RuntimeWorkerLike; prepared: boolean }> {
  return getWorkerPool().acquire();
}

export function warmRuntimeWorkerPool(): void {
  getWorkerPool();
}

export async function disposeRuntimeWorkerPool(): Promise<void> {
  const pool = workerPool;
  workerPool = undefined;
  await pool?.dispose();
}

export function releaseRuntimeWorker(worker: RuntimeWorkerLike): void {
  getWorkerPool().release(worker);
}

export function discardRuntimeWorker(worker: RuntimeWorkerLike): void {
  getWorkerPool().discard(worker);
}
