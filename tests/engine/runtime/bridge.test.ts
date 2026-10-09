import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RpcCall, RpcReply, RpcResult } from '@/engine/runtime/bridge/protocol';

vi.mock('sync-message', () => ({
  isServiceWorkerRequest: () => true,
  serviceWorkerFetchListener: () => (event: { respondWith(response: Response): void }) => {
    event.respondWith(Promise.resolve(new Response('test-version')));
  },
}));

type PortMessage = RpcCall | RpcReply | { ready: true };

class FakePort {
  onmessage: ((event: { data: PortMessage }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  closed = false;
  readonly messages: PortMessage[] = [];
  onPostMessage: ((message: PortMessage) => void) | null = null;

  postMessage(message: PortMessage): void {
    this.messages.push(message);
    this.onPostMessage?.(message);
  }

  start(): void {}

  close(): void {
    this.closed = true;
  }

  emit(message: PortMessage): void {
    this.onmessage?.({ data: message });
  }
}

interface WindowClient {
  id: string;
  postMessage(message: { type: string; call?: RpcCall }, ports?: FakePort[]): void;
}

interface WorkerEvent {
  data: { type: string; runtimeId?: string };
  source: { id: string };
  ports: FakePort[];
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
  waitUntil(response: Promise<void>): void;
}

interface ServiceWorkerScope {
  location: { origin: string; pathname: string };
  clients: {
    matchAll(options: { type: string }): Promise<WindowClient[]>;
    get(id: string): Promise<WindowClient | undefined>;
    claim(): Promise<void>;
  };
  skipWaiting(): Promise<void>;
  addEventListener(type: string, listener: (event: WorkerEvent) => void): void;
}

const listeners = new Map<string, (event: WorkerEvent) => void>();
let windowClients: WindowClient[];

function createScope(): ServiceWorkerScope {
  return {
    location: { origin: 'https://pyxis.test', pathname: '/app/sw.js' },
    clients: {
      async matchAll() {
        return windowClients;
      },
      async get(id) {
        return windowClients.find(client => client.id === id);
      },
      async claim() {},
    },
    async skipWaiting() {},
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
}

async function loadServiceWorker(): Promise<void> {
  vi.resetModules();
  listeners.clear();
  vi.stubGlobal('self', createScope());
  await import('@/engine/runtime/bridge/serviceWorker.js');
}

function dispatchMessage(
  data: WorkerEvent['data'],
  ports: FakePort[] = [],
  sourceId = 'owner'
): void {
  const listener = listeners.get('message');
  if (!listener) throw new Error('Service worker message listener is missing.');
  listener({
    data,
    source: { id: sourceId },
    ports,
    request: new Request('https://pyxis.test/'),
    respondWith() {},
    waitUntil() {},
  });
}

async function read(call: RpcCall): Promise<Response> {
  const listener = listeners.get('fetch');
  if (!listener) throw new Error('Service worker fetch listener is missing.');
  let responsePromise: Promise<Response> | Response | undefined;
  listener({
    data: { type: 'fetch' },
    source: { id: 'owner' },
    ports: [],
    request: new Request('https://pyxis.test/app/__SyncMessageServiceWorkerInput__/read', {
      method: 'POST',
      body: JSON.stringify({ messageId: JSON.stringify(call) }),
    }),
    respondWith(response) {
      responsePromise = response;
    },
    waitUntil() {},
  });
  if (!responsePromise) throw new Error('Service worker did not handle the sync read.');
  return responsePromise;
}

function connectPort(port: FakePort): void {
  dispatchMessage({ type: 'runtime-fs-port' }, [port, new FakePort()]);
}

function fsCall(id: string): RpcCall {
  return {
    id,
    runtimeId: 'runtime-1',
    request: { kind: 'fs', op: 'readFile', path: '/workspace/missing.txt' },
  };
}

async function responseResult(response: Response): Promise<RpcResult> {
  const body = (await response.json()) as { message: RpcResult };
  return body.message;
}

describe('runtime service worker bridge', () => {
  beforeEach(async () => {
    windowClients = [];
    await loadServiceWorker();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('dispatches a sync filesystem request to the filesystem port and preserves ENOENT', async () => {
    const port = new FakePort();
    port.onPostMessage = message => {
      if (!('request' in message)) return;
      port.emit({
        id: message.id,
        result: { ok: false, error: 'No such file or directory', code: 'ENOENT' },
      });
    };
    connectPort(port);

    const result = await responseResult(await read(fsCall('missing-file')));

    expect(port.messages).toHaveLength(1);
    expect(port.messages[0]).toMatchObject({
      id: 'missing-file',
      request: { kind: 'fs', op: 'readFile', path: '/workspace/missing.txt' },
    });
    expect(result).toEqual({ ok: false, error: 'No such file or directory', code: 'ENOENT' });
  });

  it('executes repeated polling reads with the same message id only once', async () => {
    const port = new FakePort();
    port.onPostMessage = message => {
      if (!('request' in message)) return;
      port.emit({ id: message.id, result: { ok: true, value: 'QQ==' } });
    };
    let requestedPort = false;
    windowClients = [
      {
        id: 'owner',
        postMessage(message) {
          if (message.type !== 'runtime-request-fs-port' || requestedPort) return;
          requestedPort = true;
          connectPort(port);
        },
      },
    ];

    const firstPoll = read(fsCall('polled-read'));
    const secondPoll = read(fsCall('polled-read'));
    const results = await Promise.all([firstPoll, secondPoll]);

    expect(port.messages.filter(message => 'request' in message)).toHaveLength(1);
    await expect(responseResult(results[0])).resolves.toEqual({ ok: true, value: 'QQ==' });
    await expect(responseResult(results[1])).resolves.toEqual({ ok: true, value: 'QQ==' });
  });

  it('cancels a pending sync request when its runtime closes', async () => {
    const port = new FakePort();
    connectPort(port);

    const pendingRead = read(fsCall('cancelled-read'));
    await vi.waitFor(() => {
      expect(port.messages.filter(message => 'request' in message)).toHaveLength(1);
    });
    dispatchMessage({ type: 'runtime-cancel', runtimeId: 'runtime-1' });

    await expect(responseResult(await pendingRead)).resolves.toEqual({
      ok: false,
      error: 'Runtime closed.',
    });
    expect(port.messages.filter(message => 'request' in message)).toHaveLength(1);
  });

  it('reconnects a lost filesystem port through the window and routes the next read directly', async () => {
    const lostPort = new FakePort();
    connectPort(lostPort);
    const reconnectPort = new FakePort();
    reconnectPort.onPostMessage = message => {
      if (!('request' in message)) return;
      reconnectPort.emit({ id: message.id, result: { ok: true, value: [66] } });
    };
    let reconnectRequests = 0;
    const clientMessages: string[] = [];
    windowClients = [
      {
        id: 'owner',
        postMessage(message) {
          clientMessages.push(message.type);
          if (message.type !== 'runtime-request-fs-port') return;
          reconnectRequests += 1;
          connectPort(reconnectPort);
        },
      },
    ];

    const failedRead = read(fsCall('interrupted-read'));
    await vi.waitFor(() => {
      expect(lostPort.messages.filter(message => 'request' in message)).toHaveLength(1);
    });
    lostPort.onmessageerror?.();
    await expect(responseResult(await failedRead)).resolves.toEqual({
      ok: false,
      error: 'Runtime filesystem connection failed.',
    });

    const result = await responseResult(await read(fsCall('after-reconnect')));

    expect(reconnectRequests).toBe(1);
    expect(reconnectPort.messages.filter(message => 'request' in message)).toHaveLength(1);
    expect(clientMessages).toEqual(['runtime-request-fs-port']);
    expect(result).toEqual({ ok: true, value: [66] });
  });

  it('sends shell and stdin requests only to the window that owns the filesystem port', async () => {
    const blockedMessages: string[] = [];
    const ownerMessages: string[] = [];
    windowClients = [
      {
        id: 'blocked',
        postMessage(message) {
          blockedMessages.push(message.type);
        },
      },
      {
        id: 'owner',
        postMessage(message, ports) {
          ownerMessages.push(message.type);
          if (message.type !== 'runtime-host-call' || !message.call || !ports?.[0]) return;
          let stdout = 'stdin value';
          if (message.call.request.kind === 'shell') stdout = 'shell output';
          ports[0].postMessage({
            id: message.call.id,
            result: { ok: true, value: { stdout, stderr: '', exitCode: 0 } },
          });
        },
      },
    ];
    connectPort(new FakePort());

    const shellResult = await responseResult(
      await read({
        id: 'shell-call',
        runtimeId: 'runtime-1',
        request: { kind: 'shell', command: 'pwd', cwd: '/workspace' },
      })
    );
    const stdinResult = await responseResult(
      await read({
        id: 'stdin-call',
        runtimeId: 'runtime-1',
        request: { kind: 'stdin' },
      })
    );

    expect(blockedMessages).toEqual([]);
    expect(ownerMessages).toEqual(['runtime-host-call', 'runtime-host-call']);
    expect(shellResult).toEqual({
      ok: true,
      value: { stdout: 'shell output', stderr: '', exitCode: 0 },
    });
    expect(stdinResult).toEqual({
      ok: true,
      value: { stdout: 'stdin value', stderr: '', exitCode: 0 },
    });
  });

  it('forwards a per-call cancellation to the host window', async () => {
    const ownerMessages: string[] = [];
    let hostCall: RpcCall | undefined;
    windowClients = [
      {
        id: 'owner',
        postMessage(message) {
          ownerMessages.push(message.type);
          if (message.type === 'runtime-host-call') hostCall = message.call;
        },
      },
    ];
    connectPort(new FakePort());

    const pendingRead = read({
      id: 'cancel-shell',
      runtimeId: 'runtime-1',
      request: { kind: 'shell', command: 'npm install', cwd: '/workspace' },
    });
    await vi.waitFor(() => expect(hostCall?.id).toBe('cancel-shell'));
    dispatchMessage({ type: 'runtime-cancel', runtimeId: 'runtime-1', callId: 'cancel-shell' });

    await expect(responseResult(await pendingRead)).resolves.toEqual({
      ok: false,
      error: 'Runtime closed.',
    });
    await vi.waitFor(() => expect(ownerMessages).toContain('runtime-host-cancel'));
  });

  it('keeps an in-flight filesystem reply across port replacement and isolates a retired port error', async () => {
    const oldPort = new FakePort();
    connectPort(oldPort);
    const oldReply = read(fsCall('in-flight-before-replacement'));
    await vi.waitFor(() => {
      expect(oldPort.messages.filter(message => 'request' in message)).toHaveLength(1);
    });

    const newPort = new FakePort();
    newPort.onPostMessage = message => {
      if (!('request' in message)) return;
      newPort.emit({ id: message.id, result: { ok: true, value: [78] } });
    };
    connectPort(newPort);
    expect(oldPort.closed).toBe(false);

    const oldCall = oldPort.messages.find((message): message is RpcCall => 'request' in message);
    if (!oldCall) throw new Error('Old filesystem port did not receive the pending request.');
    oldPort.emit({ id: oldCall.id, result: { ok: true, value: [79] } });

    await expect(responseResult(await oldReply)).resolves.toEqual({ ok: true, value: [79] });
    expect(oldPort.closed).toBe(true);

    oldPort.onmessageerror?.();
    const newResult = await responseResult(await read(fsCall('new-port-after-old-error')));
    expect(newPort.closed).toBe(false);
    expect(newResult).toEqual({ ok: true, value: [78] });
  });

  it('ignores non-owner port errors while waiting for the filesystem owner', async () => {
    const ownerMessages: string[] = [];
    const blockedMessages: string[] = [];
    const port = new FakePort();
    port.onPostMessage = message => {
      if (!('request' in message)) return;
      port.emit({ id: message.id, result: { ok: true, value: 'QQ==' } });
    };
    windowClients = [
      {
        id: 'blocked',
        postMessage(message) {
          blockedMessages.push(message.type);
          if (message.type === 'runtime-request-fs-port') {
            dispatchMessage({ type: 'runtime-fs-port-error' }, [], 'blocked');
          }
        },
      },
      {
        id: 'owner',
        postMessage(message) {
          ownerMessages.push(message.type);
          if (message.type === 'runtime-request-fs-port') connectPort(port);
        },
      },
    ];
    const pendingRead = read(fsCall('handoff-failed'));
    await expect(responseResult(await pendingRead)).resolves.toEqual({ ok: true, value: 'QQ==' });
    expect(blockedMessages).toEqual(['runtime-request-fs-port']);
    expect(ownerMessages).toEqual(['runtime-request-fs-port']);
  });

  it('bounds waiting for a filesystem port when the owner never responds', async () => {
    let requests = 0;
    windowClients = [
      {
        id: 'owner',
        postMessage(message) {
          if (message.type === 'runtime-request-fs-port') requests += 1;
        },
      },
    ];
    vi.useFakeTimers();
    const pendingRead = read(fsCall('port-timeout'));
    await vi.waitFor(() => expect(requests).toBe(1));

    await vi.advanceTimersByTimeAsync(30000);

    await expect(responseResult(await pendingRead)).resolves.toEqual({
      ok: false,
      error: 'Error: Runtime filesystem port is unavailable.',
    });
  });
});
