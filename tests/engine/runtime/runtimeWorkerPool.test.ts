import { describe, expect, it } from 'vitest';
import {
  type RuntimeWorkerLike,
  RuntimeWorkerPool,
} from '@/engine/runtime/nodejs/runtimeWorkerPool';
import type { MainMessage, WorkerMessage } from '@/engine/runtime/nodejs/workerProtocol';

class PoolWorker implements RuntimeWorkerLike {
  readonly listeners = new Map<string, Set<EventListener>>();
  terminated = false;
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;

  constructor(ready = true) {
    if (ready) queueMicrotask(() => this.emit({ type: 'ready' }));
  }

  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerMessage>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  addEventListener(type: 'messageerror', listener: () => void): void;
  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: MessageEvent<WorkerMessage> | ErrorEvent) => void
  ): void {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener as EventListener);
  }

  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerMessage>) => void
  ): void;
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: 'messageerror', listener: () => void): void;
  removeEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(_message: MainMessage, _transfer?: Transferable[]): void {}

  terminate(): void {
    this.terminated = true;
  }

  emit(message: WorkerMessage): void {
    const event = { data: message } as MessageEvent<WorkerMessage>;
    this.onmessage?.(event);
    for (const listener of this.listeners.get('message') ?? []) listener(event as Event);
  }
}

describe('RuntimeWorkerPool', () => {
  it('keeps one prepared worker and releases normal completions for reuse', async () => {
    const workers: PoolWorker[] = [];
    const pool = new RuntimeWorkerPool(() => {
      const worker = new PoolWorker();
      workers.push(worker);
      return worker;
    });

    const first = await pool.acquire();
    expect(first.prepared).toBe(true);
    expect(workers).toHaveLength(1);
    pool.release(first.worker);
    const second = await pool.acquire();
    expect(second.worker).toBe(first.worker);
    expect(workers).toHaveLength(1);
    pool.release(second.worker);
    await pool.dispose();
    expect(workers[0].terminated).toBe(true);
  });

  it('keeps only one idle worker when executions overlap', async () => {
    const workers: PoolWorker[] = [];
    const pool = new RuntimeWorkerPool(() => {
      const worker = new PoolWorker();
      workers.push(worker);
      return worker;
    });

    const first = await pool.acquire();
    const second = await pool.acquire();
    expect(workers).toHaveLength(2);
    pool.release(first.worker);
    pool.release(second.worker);
    expect(workers.filter(worker => worker.terminated)).toHaveLength(1);
    await pool.dispose();
  });

  it('replaces a discarded worker with a prepared standby', async () => {
    const workers: PoolWorker[] = [];
    const pool = new RuntimeWorkerPool(() => {
      const worker = new PoolWorker();
      workers.push(worker);
      return worker;
    });

    const lease = await pool.acquire();
    pool.discard(lease.worker);
    expect(workers[0].terminated).toBe(true);
    await Promise.resolve();
    const replacement = await pool.acquire();
    expect(replacement.prepared).toBe(true);
    expect(workers).toHaveLength(2);
    await pool.dispose();
  });

  it('replaces an idle worker that reports a fatal error', async () => {
    const workers: PoolWorker[] = [];
    const pool = new RuntimeWorkerPool(() => {
      const worker = new PoolWorker();
      workers.push(worker);
      return worker;
    });

    const lease = await pool.acquire();
    pool.release(lease.worker);
    await Promise.resolve();
    workers[0].emit({ type: 'fatal', error: 'late failure' });
    await Promise.resolve();
    const replacement = await pool.acquire();
    expect(replacement.worker).not.toBe(lease.worker);
    expect(workers[0].terminated).toBe(true);
    await pool.dispose();
  });

  it('does not clear a newer idle slot when disposal sees a stale startup failure', async () => {
    const workers: PoolWorker[] = [];
    const pool = new RuntimeWorkerPool(() => {
      const worker = new PoolWorker(workers.length > 0);
      workers.push(worker);
      return worker;
    });

    const disposal = pool.dispose();
    const acquire = pool.acquire();
    await Promise.resolve();
    workers[1].emit({ type: 'ready' });
    const lease = await acquire;
    pool.release(lease.worker);
    await Promise.resolve();
    workers[0].emit({ type: 'fatal', error: 'startup failed' });
    await disposal;

    const next = await pool.acquire();
    expect(next.worker).toBe(lease.worker);
    await pool.dispose();
  });
});
