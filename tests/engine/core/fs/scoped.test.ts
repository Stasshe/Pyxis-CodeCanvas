import * as Comlink from 'comlink';
import { describe, expect, it, vi } from 'vitest';
import { FsClient } from '@/engine/core/fs/client';
import { FsCore } from '@/engine/core/fs/core';

describe('scoped filesystem clients', () => {
  it('binds whole-file owners and can re-scope from the original client', async () => {
    const core = new FsCore();
    const client = new FsClient();
    vi.spyOn(client, 'mkfifo').mockImplementation(path => core.mkfifo(path));
    const readFile = vi
      .spyOn(client, 'readFile')
      .mockImplementation((path, ownerId) => core.readFile(path, ownerId));
    const writeFile = vi
      .spyOn(client, 'writeFile')
      .mockImplementation((path, data, options, ownerId) =>
        core.writeFile(path, data, options, true, ownerId)
      );
    vi.spyOn(client, 'closeFifos').mockImplementation(ownerId => core.closeFifos(ownerId));
    vi.spyOn(client, 'stat').mockImplementation(path => core.stat(path));
    await client.mkfifo('/tmp/pipe');

    const parent = client.scoped('parent');
    const reader = parent.scoped('reader');
    const writer = parent.scoped('writer');
    const reading = reader.readFile('/tmp/pipe');
    const writing = writer.writeFile('/tmp/pipe', new Uint8Array([0, 255, 12]));

    expect(await reader.stat('/tmp/pipe')).toMatchObject({ type: 'fifo', size: 0 });
    await writing;
    expect(await reading).toEqual(new Uint8Array([0, 255, 12]));
    expect(readFile).toHaveBeenCalledWith('/tmp/pipe', 'reader', expect.any(AbortSignal));
    expect(writeFile).toHaveBeenCalledWith(
      '/tmp/pipe',
      new Uint8Array([0, 255, 12]),
      undefined,
      'writer',
      expect.any(AbortSignal)
    );
  });

  it('cancels only the scoped owner while preserving filesystem access', async () => {
    const core = new FsCore();
    const client = new FsClient();
    vi.spyOn(client, 'mkfifo').mockImplementation(path => core.mkfifo(path));
    vi.spyOn(client, 'readFile').mockImplementation((path, ownerId) =>
      core.readFile(path, ownerId)
    );
    vi.spyOn(client, 'closeFifos').mockImplementation(ownerId => core.closeFifos(ownerId));
    vi.spyOn(client, 'stat').mockImplementation(path => core.stat(path));
    await client.mkfifo('/tmp/pipe');

    const scope = client.scoped('reader-owner');
    const pendingRead = scope.readFile('/tmp/pipe');
    const interrupted = expect(pendingRead).rejects.toMatchObject({ code: 'EINTR' });
    expect(await scope.stat('/tmp/pipe')).toMatchObject({ type: 'fifo' });
    await scope.closeFifos('reader-owner');

    await interrupted;
  });

  it('cancels a scoped whole-file write waiting for a reader', async () => {
    const core = new FsCore();
    const client = new FsClient();
    vi.spyOn(client, 'mkfifo').mockImplementation(path => core.mkfifo(path));
    vi.spyOn(client, 'writeFile').mockImplementation((path, data, options, ownerId) =>
      core.writeFile(path, data, options, true, ownerId)
    );
    vi.spyOn(client, 'closeFifos').mockImplementation(ownerId => core.closeFifos(ownerId));
    await client.mkfifo('/tmp/pipe');

    const scope = client.scoped('writer-owner');
    const pendingWrite = scope.writeFile('/tmp/pipe', new Uint8Array([1]));
    const interrupted = expect(pendingWrite).rejects.toMatchObject({ code: 'EINTR' });
    await scope.closeFifos('writer-owner');

    await interrupted;
  });

  it('rejects whole-file I/O after the scope has been closed', async () => {
    const client = new FsClient();
    const readFile = vi.spyOn(client, 'readFile');
    vi.spyOn(client, 'closeFifos').mockResolvedValue();
    const scope = client.scoped('closed-owner');

    await scope.closeFifos('closed-owner');
    await expect(scope.readFile('/tmp/pipe')).rejects.toMatchObject({ code: 'EINTR' });
    await expect(scope.readText('/tmp/pipe')).rejects.toMatchObject({ code: 'EINTR' });
    await expect(scope.writeFile('/tmp/pipe', 'x')).rejects.toMatchObject({ code: 'EINTR' });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('cancels a read delayed in FsClient initialization before RPC dispatch', async () => {
    let signalInitStarted!: () => void;
    let releaseInit!: () => void;
    const initStarted = new Promise<void>(resolve => {
      signalInitStarted = resolve;
    });
    const initWait = new Promise<void>(resolve => {
      releaseInit = resolve;
    });
    const service = {
      init: vi.fn(() => {
        signalInitStarted();
        return initWait;
      }),
      readFile: vi.fn(async () => new Uint8Array()),
      closeFifos: vi.fn(async () => {}),
    };

    class LoopbackWorker extends EventTarget {
      private readonly channel = new MessageChannel();

      constructor() {
        super();
        Comlink.expose(service, this.channel.port2);
        this.channel.port1.addEventListener('message', event => {
          this.dispatchEvent(new MessageEvent('message', { data: event.data }));
        });
        this.channel.port1.start();
      }

      postMessage(message: object, transfer: Transferable[] = []): void {
        this.channel.port1.postMessage(message, transfer);
      }

      terminate(): void {
        this.channel.port1.close();
        this.channel.port2.close();
      }
    }

    vi.stubGlobal('Worker', LoopbackWorker);
    vi.stubGlobal('navigator', {
      locks: {
        request: (
          _name: string,
          _options: { ifAvailable: boolean },
          callback: (lock: { name: string; mode: 'exclusive' }) => Promise<void>
        ) => callback({ name: 'pyxis-fs-owner', mode: 'exclusive' }),
      },
    });

    const client = new FsClient();
    try {
      const scope = client.scoped('delayed-owner');
      const pendingRead = scope.readFile('/tmp/ordinary-file');
      await initStarted;
      const pendingClose = scope.closeFifos('delayed-owner');

      releaseInit();
      await expect(pendingRead).rejects.toMatchObject({ code: 'EINTR' });
      await pendingClose;
      expect(service.readFile).not.toHaveBeenCalled();
      expect(service.closeFifos).toHaveBeenCalledWith('delayed-owner');
    } finally {
      releaseInit();
      client.close();
      vi.unstubAllGlobals();
    }
  });
});
