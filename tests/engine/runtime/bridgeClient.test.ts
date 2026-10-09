import { makeServiceWorkerChannel, readMessage } from 'sync-message';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeBridge } from '@/engine/runtime/bridge/client';
import type { RuntimeRequest } from '@/engine/runtime/bridge/protocol';

vi.mock('sync-message', () => ({
  makeServiceWorkerChannel: vi.fn(() => ({ scope: '/' })),
  readMessage: vi.fn(() => ({ ok: true, value: null })),
}));

describe('runtime bridge sync deadlines', () => {
  let bridge: RuntimeBridge | undefined;
  let port: MessagePort | undefined;

  afterEach(() => {
    bridge?.close();
    bridge = undefined;
    port?.close();
    port = undefined;
    vi.clearAllMocks();
  });

  function createBridge(): void {
    const channel = new MessageChannel();
    port = channel.port1;
    channel.port2.close();
    bridge = new RuntimeBridge('/', channel.port1, 'runtime-sync-deadline-test', () => {});
  }

  it('leaves peer-blocking byte and FIFO operations without a timeout', () => {
    createBridge();
    const requests: RuntimeRequest[] = [
      { kind: 'fs', op: 'readFile', path: '/workspace/pipe' },
      { kind: 'fs', op: 'writeFile', path: '/workspace/pipe', data: 'QQ==' },
      {
        kind: 'fs',
        op: 'fifoOpen',
        path: '/workspace/pipe',
        endpointId: 'endpoint',
        mode: 'read',
        nonblocking: false,
      },
      { kind: 'fs', op: 'fifoRead', endpointId: 'endpoint', maxBytes: 16 },
      { kind: 'fs', op: 'fifoWrite', endpointId: 'endpoint', data: 'QQ==' },
    ];

    for (const request of requests) bridge?.sync(request);

    expect(readMessage).toHaveBeenCalledTimes(requests.length);
    for (const [, , options] of vi.mocked(readMessage).mock.calls) {
      expect(options).toEqual({});
    }
    expect(makeServiceWorkerChannel).toHaveBeenCalledWith({ scope: '/' });
  });

  it('retains the deadline for ordinary filesystem and shell requests', () => {
    createBridge();
    bridge?.sync({ kind: 'fs', op: 'stat', path: '/workspace/file' });
    bridge?.sync({ kind: 'shell', command: 'pwd', cwd: '/workspace' });

    expect(readMessage).toHaveBeenCalledTimes(2);
    for (const [, , options] of vi.mocked(readMessage).mock.calls) {
      expect(options).toEqual({ timeout: 120000 });
    }
  });
});
