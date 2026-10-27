import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FsClient } from '@/engine/core/fs/client';

const transport = vi.hoisted(() => ({
  init: vi.fn(async () => {}),
  release: Symbol('release'),
}));

vi.mock('comlink', () => ({
  wrap: () => ({ init: transport.init, [transport.release]: vi.fn() }),
  proxy: (callback: (event: Event) => void) => callback,
  releaseProxy: transport.release,
}));

class Worker extends EventTarget {
  static instances: Worker[] = [];
  terminate = vi.fn();
  constructor() {
    super();
    Worker.instances.push(this);
  }
}

class WorkerError extends Event {
  message = 'Filesystem module failed to load';
  constructor() {
    super('error');
  }
}

let client: FsClient;
let lockHeld: boolean;

beforeEach(() => {
  Worker.instances = [];
  lockHeld = false;
  transport.init.mockReset().mockImplementation(async () => {});
  vi.stubGlobal('Worker', Worker);
  vi.stubGlobal('ErrorEvent', WorkerError);
  vi.stubGlobal('navigator', {
    locks: {
      request: vi.fn(
        async (
          _name: string,
          options: { ifAvailable: boolean; signal?: AbortSignal },
          callback: (lock: object | null) => Promise<void>
        ) => {
          if (options.signal) throw new Error('signal cannot be combined with ifAvailable');
          if (lockHeld) return callback(null);
          lockHeld = true;
          try {
            await callback({});
          } finally {
            lockHeld = false;
          }
        }
      ),
    },
  });
  client = new FsClient();
});

afterEach(() => {
  client.close();
  vi.unstubAllGlobals();
});

describe('filesystem startup', () => {
  it('reports worker load failures, releases ownership and permits another init attempt', async () => {
    transport.init.mockImplementationOnce(() => new Promise(() => {}));
    const pending = client.init();
    const rejected = expect(pending).rejects.toThrow('module failed');
    await vi.waitFor(() => expect(Worker.instances).toHaveLength(1));
    Worker.instances[0].dispatchEvent(new WorkerError());
    await rejected;
    await vi.waitFor(() => expect(lockHeld).toBe(false));
    expect(Worker.instances[0].terminate).toHaveBeenCalled();
    await expect(client.init()).resolves.toBeUndefined();
    expect(Worker.instances).toHaveLength(2);
  });

  it('rejects a second owner immediately without creating a worker', async () => {
    lockHeld = true;
    await expect(client.init()).rejects.toThrow('another tab');
    expect(Worker.instances).toHaveLength(0);
    lockHeld = false;
    await expect(client.init()).resolves.toBeUndefined();
  });

  it('does not start a worker when startup is closed before the lock request completes', async () => {
    let grant: () => void = () => {};
    vi.stubGlobal('navigator', {
      locks: {
        request: (_name: string, _options: object, callback: (lock: object) => Promise<void>) =>
          new Promise<void>((resolve, reject) => {
            grant = () => {
              void callback({}).then(resolve, reject);
            };
          }),
      },
    });
    const pending = client.init();
    const rejected = expect(pending).rejects.toThrow();
    client.close();
    grant();
    await rejected;
    expect(Worker.instances).toHaveLength(0);
  });
});
