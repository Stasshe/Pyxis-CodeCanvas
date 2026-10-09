import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeBridge } from '@/engine/runtime/bridge/client';
import { attachRuntimePort, type RuntimeFilesystem } from '@/engine/runtime/bridge/endpoint';
import type { RpcCall, RpcReply } from '@/engine/runtime/bridge/protocol';

vi.mock('sync-message', () => ({ makeServiceWorkerChannel: vi.fn(), readMessage: vi.fn() }));

function fifoMethods(): Pick<
  RuntimeFilesystem,
  'openFifo' | 'readFifo' | 'writeFifo' | 'closeFifo'
> {
  return {
    openFifo: async () => {},
    readFifo: async () => new Uint8Array(),
    writeFifo: async (_endpointId, data) => data.byteLength,
    closeFifo: async () => {},
  };
}

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
    let readOwner = '';
    const readStarted = new Promise<void>(resolve => {
      markReadStarted = resolve;
    });
    const fs: RuntimeFilesystem = {
      ...fifoMethods(),
      readFile: (_path, _benchmark, ownerId) =>
        new Promise(resolve => {
          readOwner = ownerId ?? '';
          completeRead = resolve;
          markReadStarted?.();
        }),
      writeFile: async () => {},
      writeRange: async (_path, data, position) => (position ?? 0) + data.byteLength,
      readdir: async () => [],
      stat: async () => ({ type: 'file', size: 0, mtime: 1, mode: 0o100644 }),
      lstat: async () => ({ type: 'file', size: 0, mtime: 1, mode: 0o100644 }),
      readlink: async () => 'target',
      realpath: async path => path,
      symlink: async () => {},
      mkdir: async () => {},
      chmod: async () => {},
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
    expect(readOwner).toBe('runtime-1');

    completeRead?.(new Uint8Array([0, 255]));

    await expect(result).resolves.toEqual({
      id: 'read-1',
      result: { ok: true, value: 'AP8=' },
    });
  });

  it('returns filesystem errors with their Node error code', async () => {
    const missing = Object.assign(new Error('Missing file'), { code: 'ENOENT' });
    const fs: RuntimeFilesystem = {
      ...fifoMethods(),
      readFile: async () => {
        throw missing;
      },
      writeFile: async () => {},
      writeRange: async (_path, data, position) => (position ?? 0) + data.byteLength,
      readdir: async () => [],
      stat: async () => ({ type: 'file', size: 0, mtime: 1, mode: 0o100644 }),
      lstat: async () => ({ type: 'file', size: 0, mtime: 1, mode: 0o100644 }),
      readlink: async () => 'target',
      realpath: async path => path,
      symlink: async () => {},
      mkdir: async () => {},
      chmod: async () => {},
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

  it('forwards creation modes and chmod errors to the filesystem', async () => {
    const writeFile = vi.fn(async () => {});
    const writeRange = vi.fn(async () => 1);
    const mkdir = vi.fn(async () => {});
    const chmod = vi.fn(async () => {
      throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
    });
    const fs: RuntimeFilesystem = {
      ...fifoMethods(),
      readFile: async () => new Uint8Array(),
      writeFile,
      writeRange,
      readdir: async () => [],
      stat: async () => ({ type: 'file', size: 0, mtime: 1, mode: 0o100644 }),
      lstat: async () => ({ type: 'file', size: 0, mtime: 1, mode: 0o100644 }),
      readlink: async () => 'target',
      realpath: async path => path,
      symlink: async () => {},
      mkdir,
      chmod,
      rm: async () => {},
      rename: async () => {},
    };
    const channel = new MessageChannel();
    channels.push(channel);
    attachRuntimePort(channel.port1, fs, async () => null);

    await response(channel.port2, {
      id: 'mode-write',
      runtimeId: 'runtime-1',
      request: { kind: 'fs', op: 'writeFile', path: '/workspace/file', data: 'QQ==', mode: 0o600 },
    });
    await response(channel.port2, {
      id: 'mode-range',
      runtimeId: 'runtime-1',
      request: {
        kind: 'fs',
        op: 'writeRange',
        path: '/workspace/file',
        data: 'QQ==',
        position: 0,
        create: true,
        exclusive: false,
        mode: 0o640,
      },
    });
    await response(channel.port2, {
      id: 'mode-mkdir',
      runtimeId: 'runtime-1',
      request: { kind: 'fs', op: 'mkdir', path: '/workspace/dir', recursive: false, mode: 0o750 },
    });
    const result = await response(channel.port2, {
      id: 'chmod-denied',
      runtimeId: 'runtime-1',
      request: { kind: 'fs', op: 'chmod', path: '/workspace/file', mode: 0o640 },
    });

    expect(writeFile).toHaveBeenCalledWith(
      '/workspace/file',
      expect.any(Uint8Array),
      undefined,
      'runtime-1',
      0o600
    );
    expect(writeRange).toHaveBeenCalledWith(
      '/workspace/file',
      expect.any(Uint8Array),
      0,
      true,
      false,
      undefined,
      0o640
    );
    expect(mkdir).toHaveBeenCalledWith(
      '/workspace/dir',
      { recursive: false, mode: 0o750 },
      undefined
    );
    expect(result.result).toEqual({ ok: false, error: 'Permission denied', code: 'EACCES' });
  });

  it('propagates opt-in queue and service diagnostics without changing values or errors', async () => {
    const fs: RuntimeFilesystem = {
      ...fifoMethods(),
      async readFile(path, benchmark) {
        if (benchmark) {
          benchmark.queueMs = 2;
          benchmark.coreMs = 3;
        }
        if (path.endsWith('missing')) throw Object.assign(new Error('Missing'), { code: 'ENOENT' });
        return new Uint8Array([65]);
      },
      writeFile: async () => {},
      writeRange: async (_path, data, position) => (position ?? 0) + data.byteLength,
      readdir: async () => [],
      stat: async () => ({ type: 'file', size: 0, mtime: 1, mode: 0o100644 }),
      lstat: async () => ({ type: 'file', size: 0, mtime: 1, mode: 0o100644 }),
      readlink: async () => 'target',
      realpath: async path => path,
      symlink: async () => {},
      mkdir: async () => {},
      chmod: async () => {},
      rm: async () => {},
      rename: async () => {},
    };
    const channel = new MessageChannel();
    channels.push(channel);
    attachRuntimePort(channel.port1, fs, async () => null);
    const bridge = new RuntimeBridge('/', channel.port2, 'diagnostics', () => {
      throw new Error('Unexpected runtime cancellation.');
    });
    const observe = vi.spyOn(bridge, 'benchmarkReply');
    try {
      await expect(bridge.async({ kind: 'fs', op: 'readFile', path: '/normal' })).resolves.toEqual(
        'QQ=='
      );
      expect(observe).not.toHaveBeenCalled();
      await expect(
        bridge.async({ kind: 'fs', op: 'readFile', path: '/measured', benchmark: true })
      ).resolves.toEqual('QQ==');
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
