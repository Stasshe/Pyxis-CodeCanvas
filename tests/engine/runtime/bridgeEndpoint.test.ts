import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeBridge } from '@/engine/runtime/bridge/client';
import { attachRuntimePort, type RuntimeFilesystem } from '@/engine/runtime/bridge/endpoint';
import type { RpcCall, RpcReply } from '@/engine/runtime/bridge/protocol';

vi.mock('sync-message', () => ({ makeServiceWorkerChannel: vi.fn(), readMessage: vi.fn() }));

function response(port: MessagePort, call: RpcCall): Promise<RpcReply> {
  return new Promise(resolve => {
    port.onmessage = (event: MessageEvent<RpcReply>) => resolve(event.data);
    port.postMessage(call);
  });
}

describe('runtime bridge endpoint', () => {
  let channels: MessageChannel[] = [];

  afterEach(() => {
    for (const channel of channels) {
      channel.port1.close();
      channel.port2.close();
    }
    channels = [];
  });

  it('waits for asynchronous filesystem work and serializes bytes', async () => {
    let completeRead: ((value: Uint8Array) => void) | undefined;
    let markReadStarted: (() => void) | undefined;
    const readStarted = new Promise<void>(resolve => {
      markReadStarted = resolve;
    });
    const fs: RuntimeFilesystem = {
      readFile: () =>
        new Promise(resolve => {
          completeRead = resolve;
          markReadStarted?.();
        }),
      writeFile: async () => {},
      readdir: async () => [],
      stat: async () => ({ type: 'file', size: 0, mtime: 1 }),
      lstat: async () => ({ type: 'file', size: 0, mtime: 1 }),
      readlink: async () => 'target',
      realpath: async path => path,
      symlink: async () => {},
      mkdir: async () => {},
      rm: async () => {},
      rename: async () => {},
    };
    const channel = new MessageChannel();
    channels.push(channel);
    attachRuntimePort(channel.port1, fs, async () => null);

    let replied = false;
    const result = response(channel.port2, {
      id: 'read-1',
      runtimeId: 'runtime-1',
      request: { kind: 'fs', op: 'readFile', path: '/workspace/data.bin' },
    }).then(reply => {
      replied = true;
      return reply;
    });
    await readStarted;
    expect(replied).toBe(false);

    completeRead?.(new Uint8Array([0, 255]));

    await expect(result).resolves.toEqual({
      id: 'read-1',
      result: { ok: true, value: [0, 255] },
    });
  });

  it('returns filesystem errors with their Node error code', async () => {
    const missing = Object.assign(new Error('Missing file'), { code: 'ENOENT' });
    const fs: RuntimeFilesystem = {
      readFile: async () => {
        throw missing;
      },
      writeFile: async () => {},
      readdir: async () => [],
      stat: async () => ({ type: 'file', size: 0, mtime: 1 }),
      lstat: async () => ({ type: 'file', size: 0, mtime: 1 }),
      readlink: async () => 'target',
      realpath: async path => path,
      symlink: async () => {},
      mkdir: async () => {},
      rm: async () => {},
      rename: async () => {},
    };
    const channel = new MessageChannel();
    channels.push(channel);
    attachRuntimePort(channel.port1, fs, async () => null);

    await expect(
      response(channel.port2, {
        id: 'read-missing',
        runtimeId: 'runtime-1',
        request: { kind: 'fs', op: 'readFile', path: '/workspace/missing' },
      })
    ).resolves.toEqual({
      id: 'read-missing',
      result: { ok: false, error: 'Missing file', code: 'ENOENT' },
    });
  });

  it('propagates opt-in queue and service diagnostics without changing values or errors', async () => {
    const fs: RuntimeFilesystem = {
      async readFile(path, benchmark) {
        if (benchmark) {
          benchmark.queueMs = 2;
          benchmark.coreMs = 3;
        }
        if (path.endsWith('missing')) throw Object.assign(new Error('Missing'), { code: 'ENOENT' });
        return new Uint8Array([65]);
      },
      writeFile: async () => {},
      readdir: async () => [],
      stat: async () => ({ type: 'file', size: 0, mtime: 1 }),
      lstat: async () => ({ type: 'file', size: 0, mtime: 1 }),
      readlink: async () => 'target',
      realpath: async path => path,
      symlink: async () => {},
      mkdir: async () => {},
      rm: async () => {},
      rename: async () => {},
    };
    const channel = new MessageChannel();
    channels.push(channel);
    attachRuntimePort(channel.port1, fs, async () => null);
    const bridge = new RuntimeBridge('/', channel.port2, 'diagnostics');
    const observe = vi.spyOn(bridge, 'benchmarkReply');
    try {
      await expect(bridge.async({ kind: 'fs', op: 'readFile', path: '/normal' })).resolves.toEqual([
        65,
      ]);
      expect(observe).not.toHaveBeenCalled();
      await expect(
        bridge.async({ kind: 'fs', op: 'readFile', path: '/measured', benchmark: true })
      ).resolves.toEqual([65]);
      expect(observe).toHaveBeenLastCalledWith(
        { kind: 'fs', op: 'readFile', path: '/measured', benchmark: true },
        { queueMs: 2, coreMs: 3 }
      );
      await expect(
        bridge.async({ kind: 'fs', op: 'readFile', path: '/missing', benchmark: true })
      ).rejects.toMatchObject({ message: 'Missing', code: 'ENOENT' });
      expect(observe).toHaveBeenCalledTimes(2);
      expect(observe).toHaveBeenLastCalledWith(
        { kind: 'fs', op: 'readFile', path: '/missing', benchmark: true },
        { queueMs: 2, coreMs: 3 }
      );
    } finally {
      bridge.close();
    }
  });
});
