import * as Comlink from 'comlink';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerPool } from '@/engine/system/runtime/transpiler/WorkerPool';

interface WorkerApi {
  run(id: number): Promise<number>;
}

class ComlinkWorker {
  private readonly channel = new MessageChannel();
  terminated = false;

  constructor(api: WorkerApi) {
    Comlink.expose(api, this.channel.port1);
  }

  postMessage(message: object, transfer: Transferable[] = []): void {
    this.channel.port2.postMessage(message, transfer);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.channel.port2.addEventListener(type, listener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.channel.port2.removeEventListener(type, listener);
  }

  start(): void {
    this.channel.port2.start();
  }

  terminate(): void {
    this.terminated = true;
    this.channel.port1.close();
    this.channel.port2.close();
  }

  get onmessage(): ((event: MessageEvent) => void) | null {
    return this.channel.port2.onmessage;
  }

  set onmessage(handler: ((event: MessageEvent) => void) | null) {
    this.channel.port2.onmessage = handler;
  }

  get onmessageerror(): ((event: MessageEvent) => void) | null {
    return this.channel.port2.onmessageerror;
  }

  set onmessageerror(handler: ((event: MessageEvent) => void) | null) {
    this.channel.port2.onmessageerror = handler;
  }

  get onerror(): ((event: ErrorEvent) => void) | null {
    return null;
  }

  set onerror(_handler: ((event: ErrorEvent) => void) | null) {}
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve = (_value: T) => {};
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('WorkerPool idle lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a worker alive until every concurrent call has completed', async () => {
    vi.useFakeTimers();
    const first = deferred<number>();
    const second = deferred<number>();
    const worker = new ComlinkWorker({
      run: id => (id === 1 ? first.promise : second.promise),
    });
    const pool = new WorkerPool<WorkerApi>({
      createWorker: () => worker as Worker,
      maxWorkers: 1,
      idleTimeoutMs: 20,
    });

    const firstCall = pool.call(api => api.run(1));
    const secondCall = pool.call(api => api.run(2));
    first.resolve(1);
    await expect(firstCall).resolves.toBe(1);
    await vi.advanceTimersByTimeAsync(25);
    expect(worker.terminated).toBe(false);

    second.resolve(2);
    await expect(secondCall).resolves.toBe(2);
    await vi.advanceTimersByTimeAsync(25);
    expect(worker.terminated).toBe(true);
    pool.terminate();
  });
});
