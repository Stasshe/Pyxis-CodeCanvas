interface WaitingLease {
  exclusive: boolean;
  grant: () => void;
}

/** Fair namespace leases keep path resolution stable during structural changes. */
export class NamespaceLock {
  private readers = 0;
  private writer = false;
  private readonly waiting: WaitingLease[] = [];

  shared<T>(operation: () => Promise<T>): Promise<T> {
    return this.run(false, operation);
  }

  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    return this.run(true, operation);
  }

  private async run<T>(exclusive: boolean, operation: () => Promise<T>): Promise<T> {
    await new Promise<void>(grant => {
      this.waiting.push({ exclusive, grant });
      this.drain();
    });
    try {
      return await operation();
    } finally {
      if (exclusive) this.writer = false;
      else this.readers -= 1;
      this.drain();
    }
  }

  private drain(): void {
    if (this.writer) return;
    while (this.waiting.length > 0) {
      const next = this.waiting[0];
      if (next.exclusive) {
        if (this.readers > 0) return;
        this.writer = true;
        this.waiting.shift();
        next.grant();
        return;
      }
      this.readers += 1;
      this.waiting.shift();
      next.grant();
    }
  }
}

const rootQueues = new WeakMap<object, Map<string, Promise<void>>>();

/** Service transactions share an owner and a canonical root key. */
export async function queueRootOperation<T>(
  owner: object,
  key: string,
  operation: () => Promise<T>
): Promise<T> {
  let queues = rootQueues.get(owner);
  if (!queues) {
    queues = new Map();
    rootQueues.set(owner, queues);
  }
  const previous = queues.get(key) ?? Promise.resolve();
  const task = previous.then(operation);
  const completion = task.then(
    () => {},
    () => {}
  );
  queues.set(key, completion);
  try {
    return await task;
  } finally {
    if (queues.get(key) === completion) queues.delete(key);
  }
}
