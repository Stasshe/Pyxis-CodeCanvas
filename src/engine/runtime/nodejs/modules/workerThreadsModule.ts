import type { WorkerOptions } from 'node:worker_threads';

const SHARE_ENV = Symbol.for('nodejs.worker_threads.SHARE_ENV');
const resourceLimits = {};

function unavailableWorker(): never {
  const error = new Error('worker_threads.Worker is unavailable in this runtime.');
  Object.assign(error, { code: 'ERR_FEATURE_UNAVAILABLE' });
  throw error;
}

export class Worker {
  constructor(_filename: string | URL, _options?: WorkerOptions) {
    unavailableWorker();
  }
}

export function createWorkerThreadsModule() {
  return {
    Worker,
    SHARE_ENV,
    isMainThread: true,
    isInternalThread: false,
    parentPort: null,
    resourceLimits,
    threadId: 0,
    threadName: '',
    workerData: null,
  };
}
