import * as Comlink from 'comlink';

type PendingCall = {
  reject: (error: Error) => void;
};

type WorkerState<T extends object> = {
  worker: Worker;
  proxy: Comlink.Remote<T>;
  inFlight: number;
  pending: Set<PendingCall>;
};

export type WorkerPoolOptions = {
  createWorker: () => Worker;
  maxWorkers?: number;
  timeoutMs?: number;
};

export type UrlWorkerPoolOptions = Omit<WorkerPoolOptions, 'createWorker'> & {
  url: string | URL;
  workerOptions?: WorkerOptions;
};

export class WorkerPool<T extends object> {
  private workers: WorkerState<T>[] = [];
  private readonly createWorker: () => Worker;
  private readonly maxWorkers: number;
  private readonly timeoutMs: number;

  constructor(options: WorkerPoolOptions) {
    this.createWorker = options.createWorker;
    this.maxWorkers = options.maxWorkers ?? getDefaultWorkerCount();
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

  async call<R>(fn: (api: Comlink.Remote<T>) => Promise<R>): Promise<R> {
    const state = this.getWorkerState();
    state.inFlight++;

    let timeout: ReturnType<typeof setTimeout> | null = null;
    const pending: PendingCall = {
      reject: () => {},
    };

    try {
      return await new Promise<R>((resolve, reject) => {
        pending.reject = reject;
        state.pending.add(pending);

        timeout = setTimeout(() => {
          const error = new Error('Worker call timeout');
          this.disposeWorker(state, error);
          reject(error);
        }, this.timeoutMs);

        fn(state.proxy).then(resolve, reject);
      });
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      state.pending.delete(pending);
      state.inFlight = Math.max(0, state.inFlight - 1);
    }
  }

  terminate(): void {
    for (const state of [...this.workers]) {
      this.disposeWorker(state);
    }
  }

  private getWorkerState(): WorkerState<T> {
    const leastBusy = this.workers.reduce<WorkerState<T> | null>((best, current) => {
      if (!best || current.inFlight < best.inFlight) return current;
      return best;
    }, null);

    if (!leastBusy || (leastBusy.inFlight > 0 && this.workers.length < this.maxWorkers)) {
      return this.createWorkerState();
    }

    return leastBusy;
  }

  private createWorkerState(): WorkerState<T> {
    const worker = this.createWorker();
    const state: WorkerState<T> = {
      worker,
      proxy: Comlink.wrap<T>(worker),
      inFlight: 0,
      pending: new Set(),
    };

    worker.onerror = event => {
      this.disposeWorker(
        state,
        new Error(`Worker error: ${event.message || 'Unknown worker error'}`)
      );
    };

    worker.onmessageerror = () => {
      this.disposeWorker(state, new Error('Worker message error'));
    };

    this.workers.push(state);
    return state;
  }

  private disposeWorker(state: WorkerState<T>, reason?: Error): void {
    this.workers = this.workers.filter(item => item !== state);

    if (reason) {
      for (const pending of state.pending) {
        pending.reject(reason);
      }
    }
    state.pending.clear();

    try {
      state.proxy[Comlink.releaseProxy]();
    } catch {
      // ignore release failures; terminate below is definitive.
    }

    state.worker.terminate();
  }
}

export function createWorkerPool<T extends object>(options: WorkerPoolOptions): WorkerPool<T> {
  return new WorkerPool<T>(options);
}

export function createUrlWorkerPool<T extends object>(
  options: UrlWorkerPoolOptions
): WorkerPool<T> {
  return new WorkerPool<T>({
    ...options,
    createWorker: () => new Worker(options.url, options.workerOptions),
  });
}

function getDefaultWorkerCount(): number {
  if (typeof navigator === 'undefined') return 1;
  return Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
}
