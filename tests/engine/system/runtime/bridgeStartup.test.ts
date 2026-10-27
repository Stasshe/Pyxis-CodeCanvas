import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class Port {
  onmessage: (() => void) | null = null;
  peer: Port | null = null;
  closed = false;
  postMessage(): void {
    this.peer?.onmessage?.();
  }
  close(): void {
    this.closed = true;
  }
}

class Channel {
  port1 = new Port();
  port2 = new Port();
  constructor() {
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}

class Worker extends EventTarget {
  state = 'activated';
  messages: string[] = [];
  acknowledge = true;
  claim = true;
  postMessage(message: { type: string }, ports?: Port[]): void {
    this.messages.push(message.type);
    if (message.type === 'runtime-claim' && this.claim) {
      container.controller = this;
      container.dispatchEvent(new Event('controllerchange'));
    }
    if (message.type === 'runtime-fs-port' && this.acknowledge) ports?.[1].postMessage();
  }
}

class Container extends EventTarget {
  controller: Worker | null = null;
  register = vi.fn(async () => registration);
  ready = new Promise<void>(() => {});
}

let container: Container;
let worker: Worker;
let registration: {
  active: Worker | null;
  installing: Worker | null;
  waiting: Worker | null;
  scope: string;
};
let reload: ReturnType<typeof vi.fn>;
let ensureRuntimeBridge: typeof import('@/engine/system/runtime/bridge/main').ensureRuntimeBridge;

beforeEach(async () => {
  vi.resetModules();
  worker = new Worker();
  registration = {
    active: worker,
    installing: null,
    waiting: null,
    scope: 'https://pyxis.test/app/',
  };
  container = new Container();
  container.controller = worker;
  reload = vi.fn();
  vi.stubGlobal('navigator', { serviceWorker: container });
  vi.stubGlobal('MessageChannel', Channel);
  vi.stubGlobal('location', { reload });
  vi.stubGlobal('document', { documentElement: { dataset: { pyxisSwControlled: 'false' } } });
  vi.stubGlobal('sessionStorage', {
    getItem() {
      throw new Error('Storage is unavailable');
    },
    setItem() {
      throw new Error('Storage is unavailable');
    },
  });
  ({ ensureRuntimeBridge } = await import('@/engine/system/runtime/bridge/main'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// The factory result is only transferred; the fake SW acknowledges through the channel.
const createPort = async () => new MessageChannel().port1;

describe('service worker startup', () => {
  it('uses the current controller despite stale initial state, inaccessible storage and pending ready', async () => {
    await expect(ensureRuntimeBridge(createPort)).resolves.toBe(registration.scope);
    expect(reload).not.toHaveBeenCalled();
    expect(container.register).toHaveBeenCalledTimes(1);
    expect(container.register).toHaveBeenCalledWith('/sw.js', { updateViaCache: 'none' });
    expect(worker.messages).toEqual(['runtime-fs-port']);
  });

  it('waits for first installation and control without reloading the page', async () => {
    worker.state = 'installing';
    container.controller = null;
    registration.active = null;
    registration.installing = worker;
    const pending = ensureRuntimeBridge(createPort);
    await vi.waitFor(() => expect(container.register).toHaveBeenCalled());
    registration.active = worker;
    registration.installing = null;
    worker.state = 'activated';
    worker.dispatchEvent(new Event('statechange'));
    await expect(pending).resolves.toBe(registration.scope);
    expect(worker.messages).toEqual(['runtime-claim', 'runtime-fs-port']);
    expect(reload).not.toHaveBeenCalled();
  });

  it('waits for a waiting update and hands the port to the new controller', async () => {
    const old = worker;
    const update = new Worker();
    update.state = 'installed';
    registration.waiting = update;
    const pending = ensureRuntimeBridge(createPort);
    await vi.waitFor(() => expect(container.register).toHaveBeenCalled());
    registration.active = update;
    registration.waiting = null;
    update.state = 'activated';
    update.dispatchEvent(new Event('statechange'));
    await expect(pending).resolves.toBe(registration.scope);
    expect(old.messages).toEqual([]);
    expect(update.messages).toEqual(['runtime-claim', 'runtime-fs-port']);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reclaims an uncontrolled hard refresh with the already-active worker', async () => {
    container.controller = null;
    await expect(ensureRuntimeBridge(createPort)).resolves.toBe(registration.scope);
    expect(worker.messages).toEqual(['runtime-claim', 'runtime-fs-port']);
  });

  it('bounds registration that never returns', async () => {
    vi.useFakeTimers();
    container.register.mockImplementationOnce(() => new Promise(() => {}));
    const pending = ensureRuntimeBridge(createPort);
    const rejected = expect(pending).rejects.toThrow('Registering service worker timed out');
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(reload).not.toHaveBeenCalled();
  });

  it('bounds control that is never claimed', async () => {
    vi.useFakeTimers();
    container.controller = null;
    worker.claim = false;
    const rejected = expect(ensureRuntimeBridge(createPort)).rejects.toThrow(
      'did not take control'
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(reload).not.toHaveBeenCalled();
  });

  it('bounds FS port acquisition and closes a late port without transferring it', async () => {
    vi.useFakeTimers();
    let resolvePort: (port: MessagePort) => void = () => {};
    const port = new MessageChannel().port1;
    const close = vi.spyOn(port, 'close');
    const rejected = expect(
      ensureRuntimeBridge(
        () =>
          new Promise(resolve => {
            resolvePort = resolve;
          })
      )
    ).rejects.toThrow('did not accept');
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    resolvePort(port);
    await vi.advanceTimersByTimeAsync(0);
    expect(close).toHaveBeenCalled();
    expect(worker.messages).toEqual([]);
  });

  it('shares concurrent startup and retries after an acknowledgment failure', async () => {
    vi.useFakeTimers();
    worker.acknowledge = false;
    const first = ensureRuntimeBridge(createPort);
    expect(ensureRuntimeBridge(createPort)).toBe(first);
    const rejected = expect(first).rejects.toThrow('did not accept');
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    worker.acknowledge = true;
    await expect(ensureRuntimeBridge(createPort)).resolves.toBe(registration.scope);
    expect(container.register).toHaveBeenCalledTimes(2);
  });
});
