import { afterEach, describe, expect, it } from 'vitest';
import { attachRuntimePort, type RuntimeFilesystem } from '@/engine/runtime/bridge/endpoint';
import type { RpcCall, RpcReply } from '@/engine/runtime/bridge/protocol';

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
});
