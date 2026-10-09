import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeBridge } from '@/engine/runtime/bridge/client';
import { constants } from '@/engine/runtime/nodejs/modules/constantsModule';
import { RuntimeFsDescriptors } from '@/engine/runtime/nodejs/modules/fsDescriptors';
import { createReadStream, createWriteStream } from '@/engine/runtime/nodejs/modules/fsStreams';
import { RuntimeFsMount } from '@/engine/runtime/storage/RuntimeFsMount';

vi.mock('sync-message', () => ({ makeServiceWorkerChannel: vi.fn(), readMessage: vi.fn() }));

describe('runtime FIFO descriptors', () => {
  const bridges: RuntimeBridge[] = [];
  const ports: MessagePort[] = [];

  afterEach(() => {
    for (const bridge of bridges) bridge.close();
    bridges.length = 0;
    for (const port of ports) port.close();
    ports.length = 0;
  });

  function setup() {
    const channel = new MessageChannel();
    ports.push(channel.port2);
    const bridge = new RuntimeBridge('/', channel.port1, 'runtime-fifo-test', () => {
      throw new Error('Unexpected runtime cancellation.');
    });
    bridges.push(bridge);
    const filesystem = new RuntimeFsMount(bridge);
    const fifoStat = { type: 'fifo' as const, size: 0, mtime: new Date(1) };
    vi.spyOn(filesystem, 'lstatSync').mockReturnValue(fifoStat);
    vi.spyOn(filesystem, 'statSync').mockReturnValue(fifoStat);
    vi.spyOn(filesystem, 'realpathSync').mockReturnValue('/tmp/pipe');
    const openFifo = vi.spyOn(filesystem, 'openFifoSync').mockImplementation(() => {});
    const readFifo = vi.spyOn(filesystem, 'readFifoSync').mockReturnValue(new Uint8Array([65, 66]));
    const writeFifo = vi
      .spyOn(filesystem, 'writeFifoSync')
      .mockImplementation((_id, bytes) => bytes.byteLength);
    const closeFifo = vi.spyOn(filesystem, 'closeFifoSync').mockImplementation(() => {});
    const setFile = vi.spyOn(filesystem, 'setFileSync');
    const descriptors = new RuntimeFsDescriptors(
      filesystem,
      () => {},
      () => {}
    );
    return {
      bridge,
      closeFifo,
      descriptors,
      fifoStat,
      filesystem,
      openFifo,
      readFifo,
      setFile,
      writeFifo,
    };
  }

  it('passes a virtual descriptor alias unchanged to the filesystem FIFO RPC', () => {
    const { bridge, filesystem, openFifo } = setup();
    openFifo.mockRestore();
    const sync = vi.spyOn(bridge, 'sync').mockReturnValue(null);

    filesystem.openFifoSync('/dev/fd/17', 'read', 'reader-endpoint', true);

    expect(sync).toHaveBeenCalledWith({
      kind: 'fs',
      op: 'fifoOpen',
      path: '/dev/fd/17',
      endpointId: 'reader-endpoint',
      mode: 'read',
      nonblocking: true,
    });
  });

  it('opens FIFO without truncation, streams bytes, and rejects positions', () => {
    const { closeFifo, descriptors, fifoStat, openFifo, readFifo, setFile } = setup();
    const descriptor = descriptors.openSync('/tmp/pipe', 'w+');
    expect(openFifo).toHaveBeenCalledWith('/tmp/pipe', 'readwrite', expect.any(String), false);
    expect(setFile).not.toHaveBeenCalled();

    const buffer = new Uint8Array(2);
    expect(descriptors.readSync(descriptor, buffer)).toBe(2);
    expect(buffer).toEqual(new Uint8Array([65, 66]));
    expect(readFifo).toHaveBeenCalledWith(expect.any(String), 2);
    expect(() => descriptors.readSync(descriptor, buffer, 0, 2, 0)).toThrow(
      expect.objectContaining({ code: 'ESPIPE' })
    );
    expect(descriptors.statSync(descriptor)).toBe(fifoStat);

    descriptors.closeSync(descriptor);
    expect(closeFifo).toHaveBeenCalledOnce();
  });

  it('passes O_NONBLOCK into the FIFO open operation and writes through its endpoint', () => {
    const { descriptors, openFifo, writeFifo } = setup();
    const descriptor = descriptors.openSync('/tmp/pipe', constants.O_WRONLY | constants.O_NONBLOCK);
    expect(openFifo).toHaveBeenCalledWith('/tmp/pipe', 'write', expect.any(String), true);
    expect(descriptors.writeSync(descriptor, new Uint8Array([1, 2, 3]))).toBe(3);
    expect(writeFifo).toHaveBeenCalledWith(expect.any(String), expect.any(Uint8Array));
    expect(Array.from(writeFifo.mock.calls[0]?.[1] ?? [])).toEqual([1, 2, 3]);
    expect(() => descriptors.writeSync(descriptor, new Uint8Array([1]), 0, 1, 0)).toThrow(
      expect.objectContaining({ code: 'ESPIPE' })
    );
    descriptors.closeSync(descriptor);
  });

  it('writes complete stream chunks when the FIFO accepts partial writes', async () => {
    const { filesystem } = setup();
    vi.spyOn(filesystem, 'stat').mockResolvedValue({
      type: 'fifo',
      size: 0,
      mtime: new Date(1),
    });
    vi.spyOn(filesystem, 'openFifo').mockResolvedValue();
    const writeFifo = vi
      .spyOn(filesystem, 'writeFifo')
      .mockResolvedValueOnce(2)
      .mockResolvedValue(1);
    const closeFifo = vi.spyOn(filesystem, 'closeFifo').mockResolvedValue();
    const stream = createWriteStream(filesystem, '/tmp/pipe');

    await new Promise<void>((resolve, reject) => {
      stream.once('error', reject);
      stream.end(new Uint8Array([1, 2, 3]), resolve);
    });

    expect(writeFifo).toHaveBeenCalledTimes(2);
    expect(Uint8Array.from(writeFifo.mock.calls[0]?.[1] ?? [])).toEqual(new Uint8Array([1, 2, 3]));
    expect(Uint8Array.from(writeFifo.mock.calls[1]?.[1] ?? [])).toEqual(new Uint8Array([3]));
    expect(closeFifo).toHaveBeenCalledOnce();
  });

  it('opens read-write FIFO streams without a peer and rejects positioned streams', async () => {
    const { filesystem } = setup();
    vi.spyOn(filesystem, 'stat').mockResolvedValue({
      type: 'fifo',
      size: 0,
      mtime: new Date(1),
    });
    const openFifo = vi.spyOn(filesystem, 'openFifo').mockResolvedValue();
    vi.spyOn(filesystem, 'writeFifo').mockImplementation(async (_id, bytes) => bytes.byteLength);
    vi.spyOn(filesystem, 'closeFifo').mockResolvedValue();
    const writer = createWriteStream(filesystem, '/tmp/pipe', { flags: 'r+' });
    await new Promise<void>((resolve, reject) => {
      writer.once('error', reject);
      writer.end(new Uint8Array([65]), resolve);
    });
    expect(openFifo).toHaveBeenCalledWith('/tmp/pipe', 'readwrite', expect.any(String));

    const reader = createReadStream(filesystem, '/tmp/pipe', { start: 0 });
    const readError = new Promise<Error>(resolve => reader.once('error', resolve));
    reader.resume();
    await expect(readError).resolves.toMatchObject({ code: 'ESPIPE' });
    expect(openFifo).toHaveBeenCalledOnce();
  });

  it('cancels a read stream while its blocking FIFO open is pending', async () => {
    const { filesystem } = setup();
    vi.spyOn(filesystem, 'stat').mockResolvedValue({
      type: 'fifo',
      size: 0,
      mtime: new Date(1),
    });
    let finishOpen: (() => void) | undefined;
    const openStarted = new Promise<void>(resolve => {
      vi.spyOn(filesystem, 'openFifo').mockImplementation(
        () =>
          new Promise<void>(complete => {
            finishOpen = complete;
            resolve();
          })
      );
    });
    const closeFifo = vi.spyOn(filesystem, 'closeFifo').mockImplementation(async () => {
      finishOpen?.();
    });
    const stream = createReadStream(filesystem, '/tmp/pipe');
    const closed = new Promise<void>(resolve => stream.once('close', resolve));
    stream.resume();
    await openStarted;
    stream.destroy();
    finishOpen?.();
    await closed;
    expect(closeFifo).toHaveBeenCalledOnce();
  });
});
