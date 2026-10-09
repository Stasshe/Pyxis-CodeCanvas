import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FSError, FsCore } from '@/engine/core/fs/core';
import { FIFO_STORAGE } from '@/engine/core/fs/fifo';
import { createWorkspace } from '@/engine/core/fs/workspace';
import { directoryTree } from '../../../_helpers/opfs';

const CAPACITY = 64 * 1024;
const ATOMIC_WRITE_SIZE = 4096;

describe('filesystem FIFOs', () => {
  let core: FsCore;

  beforeEach(() => {
    core = new FsCore();
  });

  it('creates a zero-sized FIFO in /tmp and rejects duplicate paths', async () => {
    await core.mkfifo('/tmp/pipe');

    expect(await core.stat('/tmp/pipe')).toMatchObject({
      path: '/tmp/pipe',
      type: 'fifo',
      size: 0,
    });
    await expect(core.mkfifo('/tmp/pipe')).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('exposes /dev/null as an empty character device that discards writes', async () => {
    expect(await core.exists('/dev/null')).toBe(true);
    expect(await core.stat('/dev/null')).toMatchObject({
      type: 'characterDevice',
      size: 0,
    });
    expect(await core.readFile('/dev/null')).toEqual(new Uint8Array());
    await core.writeFile('/dev/null', new Uint8Array([0, 255, 7]));
    expect(await core.readFile('/dev/null')).toEqual(new Uint8Array());
  });

  it('lists virtual device entries and protects them from filesystem mutation', async () => {
    const deviceEntries = await core.readdir('/dev');
    expect(deviceEntries.map(entry => entry.path)).toEqual(['/dev/fd', '/dev/null']);
    expect(deviceEntries.find(entry => entry.path === '/dev/null')).toMatchObject({
      type: 'characterDevice',
      size: 0,
    });
    await expect(core.rm('/dev/null')).rejects.toMatchObject({ code: 'EPERM' });
    await expect(core.rename('/dev/null', '/tmp/null')).rejects.toMatchObject({ code: 'EPERM' });
    await expect(core.mkdir('/dev/null')).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('lists named virtual entries when their mount has no physical directory', async () => {
    const root = directoryTree();
    await core.init(root);
    await core.mkfifo('/dev/pipe');
    await core.symlink('/dev/null', '/dev/link');
    await expect(root.getDirectoryHandle('dev')).rejects.toMatchObject({ name: 'NotFoundError' });

    const entries = await core.readdir('/dev');

    expect(entries.map(entry => [entry.path, entry.type])).toEqual([
      ['/dev/fd', 'folder'],
      ['/dev/link', 'symlink'],
      ['/dev/null', 'characterDevice'],
      ['/dev/pipe', 'fifo'],
    ]);
    expect((await core.walk('/dev')).map(entry => entry.path)).toEqual(
      entries.map(entry => entry.path)
    );
  });

  it('merges physical and named virtual entries in a device mount', async () => {
    const root = directoryTree();
    await root.getDirectoryHandle('dev', { create: true });
    await core.init(root);
    await core.writeFile('/dev/ordinary.txt', 'contents');
    await core.mkfifo('/dev/pipe');
    await core.symlink('ordinary.txt', '/dev/shortcut');

    const entries = await core.readdir('/dev');

    expect(entries.map(entry => [entry.path, entry.type])).toEqual([
      ['/dev/fd', 'folder'],
      ['/dev/null', 'characterDevice'],
      ['/dev/ordinary.txt', 'file'],
      ['/dev/pipe', 'fifo'],
      ['/dev/shortcut', 'symlink'],
    ]);
    expect(await core.readText('/dev/shortcut')).toBe('contents');
  });

  it('transfers bytes through open anonymous pipe aliases using file operations', async () => {
    const { readPath, writePath } = await core.createPipe('pipe-reader', 'pipe-writer');
    const payload = new Uint8Array([0, 255, 18, 0]);
    expect(readPath).toMatch(/^\/dev\/fd\/\d+$/);
    expect(writePath).toMatch(/^\/dev\/fd\/\d+$/);
    expect(await core.stat(readPath)).toMatchObject({ type: 'fifo', size: 0 });
    const entries = (await core.readdir('/dev/fd')).map(entry => entry.path);
    expect(entries).toContain(readPath);
    expect(entries).toContain(writePath);

    const reading = core.readFile(readPath, 'child-reader');
    const writing = core.writeFile(writePath, payload, true, 'child-writer');
    await writing;
    await core.closeFifos('pipe-writer');
    expect(await reading).toEqual(payload);
    await core.closeFifos('pipe-reader');
  });

  it('returns EOF and EPIPE when the anonymous pipe peer closes before use', async () => {
    const forEof = await core.createPipe('eof-reader', 'eof-writer');
    await core.closeFifos('eof-writer');
    expect(await core.readFile(forEof.readPath, 'child-reader')).toEqual(new Uint8Array());
    await core.closeFifos('eof-reader');

    const forEpipe = await core.createPipe('closed-reader', 'live-writer');
    await core.closeFifos('closed-reader');
    await expect(
      core.writeFile(forEpipe.writePath, new Uint8Array([1]), true, 'child-writer')
    ).rejects.toMatchObject({ code: 'EPIPE' });
    await core.closeFifos('live-writer');
  });

  it('keeps duplicated anonymous pipe endpoints alive after their original alias closes', async () => {
    const { readPath, writePath } = await core.createPipe('parent-reader', 'parent-writer');
    await core.openFifo(readPath, 'read', 'duplicate-reader', 'child-reader');
    await core.closeFifos('parent-reader');
    await expect(core.stat(readPath)).rejects.toMatchObject({ code: 'ENOENT' });

    await core.writeFile(writePath, new Uint8Array([42]), true, 'child-writer');
    expect(await core.readFifo('duplicate-reader', 1)).toEqual(new Uint8Array([42]));
    await core.closeFifos('child-reader');
    await core.closeFifos('parent-writer');
  });

  it('persists named FIFOs while keeping queued bytes in memory', async () => {
    const root = directoryTree();
    const first = new FsCore();
    await first.init(root);
    const workspace = await createWorkspace(first, 'fifo-test');
    const path = `${workspace}/pipe`;
    await first.mkfifo(path);
    await first.openFifo(path, 'readwrite', 'first', 'first-owner');
    expect(await first.writeFifo('first', new Uint8Array([1]))).toBe(1);

    const next = new FsCore();
    await next.init(root);
    expect(await next.stat(path)).toMatchObject({ type: 'fifo', size: 0 });
    await next.openFifo(path, 'readwrite', 'second', 'second-owner');
    expect(await next.writeFifo('second', new Uint8Array([2]))).toBe(1);
    expect(await next.readFifo('second', 1)).toEqual(new Uint8Array([2]));
    expect(await first.readFifo('first', 1)).toEqual(new Uint8Array([1]));
    await first.closeFifo('first');
    await next.closeFifo('second');
  });

  it('preserves FIFO endpoints when rename replaces another FIFO', async () => {
    const root = directoryTree();
    await core.init(root);
    await core.mkdir('/workspace');
    await core.mkfifo('/workspace/source');
    await core.mkfifo('/workspace/destination');
    await core.openFifo('/workspace/source', 'readwrite', 'source', 'owner');
    await core.openFifo('/workspace/destination', 'readwrite', 'destination', 'owner');
    expect(await core.writeFifo('source', new Uint8Array([1]))).toBe(1);
    expect(await core.writeFifo('destination', new Uint8Array([2]))).toBe(1);

    await core.rename('/workspace/source', '/workspace/destination');
    await core.openFifo('/workspace/destination', 'readwrite', 'renamed', 'owner');

    expect(await core.readFifo('renamed', 1)).toEqual(new Uint8Array([1]));
    expect(await core.readFifo('destination', 1)).toEqual(new Uint8Array([2]));
    expect(await core.writeFifo('source', new Uint8Array([3]))).toBe(1);
    expect(await core.readFifo('renamed', 1)).toEqual(new Uint8Array([3]));
    await core.closeFifo('source');
    await core.closeFifo('destination');
    await core.closeFifo('renamed');
  });

  it('preserves source and destination FIFOs when source record removal fails', async () => {
    const root = directoryTree();
    await core.init(root);
    await core.mkfifo('/source');
    await core.mkfifo('/destination');
    const records = await root.getDirectoryHandle(FIFO_STORAGE);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('/source'));
    const sourceRecord = Array.from(new Uint8Array(digest), byte =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    const removeEntry = records.removeEntry.bind(records);
    vi.spyOn(records, 'removeEntry').mockImplementation(async (name, options) => {
      if (name === sourceRecord) throw new Error('source FIFO removal failed');
      return removeEntry(name, options);
    });

    await expect(core.rename('/source', '/destination')).rejects.toThrow(
      'source FIFO removal failed'
    );
    expect(await core.stat('/source')).toMatchObject({ type: 'fifo' });
    expect(await core.stat('/destination')).toMatchObject({ type: 'fifo' });
    const next = new FsCore();
    await next.init(root);
    expect(await next.stat('/source')).toMatchObject({ type: 'fifo' });
    expect(await next.stat('/destination')).toMatchObject({ type: 'fifo' });
  });

  it('keeps FIFO endpoints attached through a folder rename', async () => {
    const root = directoryTree();
    await core.init(root);
    await core.mkdir('/source');
    await core.mkfifo('/source/pipe');
    await core.openFifo('/source/pipe', 'readwrite', 'old-path', 'owner');
    expect(await core.writeFifo('old-path', new Uint8Array([4]))).toBe(1);

    await core.rename('/source', '/destination');
    await core.openFifo('/destination/pipe', 'readwrite', 'new-path', 'owner');

    expect(await core.readFifo('new-path', 1)).toEqual(new Uint8Array([4]));
    expect(await core.writeFifo('new-path', new Uint8Array([5]))).toBe(1);
    expect(await core.readFifo('old-path', 1)).toEqual(new Uint8Array([5]));
    await core.closeFifo('old-path');
    await core.closeFifo('new-path');
  });

  it('keeps namespace operations available while an open waits for its peer', async () => {
    await core.mkfifo('/tmp/pipe');
    const waitingWriter = core.openFifo('/tmp/pipe', 'write', 'writer', 'writer-owner');

    await core.mkdir('/tmp/other');
    await core.writeFile('/tmp/other/file', 'available');
    expect(await core.readText('/tmp/other/file')).toBe('available');
    expect(await core.stat('/tmp/pipe')).toMatchObject({ type: 'fifo', size: 0 });

    let writerOpened = false;
    void waitingWriter.then(() => {
      writerOpened = true;
    });
    await Promise.resolve();
    expect(writerOpened).toBe(false);

    await core.openFifo('/tmp/pipe', 'read', 'reader', 'reader-owner');
    await waitingWriter;
    await core.closeFifo('reader');
    await core.closeFifo('writer');
  });

  it('supports nonblocking readers and reports ENXIO for a writer without readers', async () => {
    await core.mkfifo('/tmp/pipe');
    await expect(
      core.openFifo('/tmp/pipe', 'write', 'writer-without-reader', 'owner', {
        nonblocking: true,
      })
    ).rejects.toMatchObject({ code: 'ENXIO' });
    await core.openFifo('/tmp/pipe', 'read', 'reader', 'owner', {
      nonblocking: true,
    });
    await core.openFifo('/tmp/pipe', 'write', 'writer', 'owner', {
      nonblocking: true,
    });
    expect(await core.writeFifo('writer', new Uint8Array([3]))).toBe(1);
    expect(await core.readFifo('reader', 1)).toEqual(new Uint8Array([3]));
    await core.closeFifo('writer');
    await core.closeFifo('reader');
  });

  it('transfers binary whole-file data through a FIFO beyond its buffer capacity', async () => {
    await core.mkfifo('/tmp/pipe');
    const payload = new Uint8Array(CAPACITY * 2 + 17);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] = (index * 37) % 256;
    }
    const reading = core.readFile('/tmp/pipe', 'reader-owner');
    const writing = core.writeFile('/tmp/pipe', payload, true, 'writer-owner');

    expect(await reading).toEqual(payload);
    await writing;
    expect(await core.stat('/tmp/pipe')).toMatchObject({ type: 'fifo', size: 0 });
  });

  it('cancels a whole-file read waiting for a writer without blocking namespace work', async () => {
    await core.mkfifo('/tmp/pipe');
    const reading = core.readFile('/tmp/pipe', 'reader-owner');
    const interrupted = expect(reading).rejects.toMatchObject({ code: 'EINTR' });

    await core.mkdir('/tmp/other');
    await core.writeFile('/tmp/other/file', 'available');
    expect(await core.readText('/tmp/other/file')).toBe('available');
    await core.closeFifos('reader-owner');

    await interrupted;
  });

  it('cancels a whole-file write waiting for a reader', async () => {
    await core.mkfifo('/tmp/pipe');
    const writing = core.writeFile('/tmp/pipe', new Uint8Array([1]), true, 'writer-owner');
    const interrupted = expect(writing).rejects.toMatchObject({ code: 'EINTR' });

    await core.mkdir('/tmp/other');
    await core.closeFifos('writer-owner');

    await interrupted;
  });

  it('moves binary data in order and gives competing readers each byte once', async () => {
    await core.mkfifo('/tmp/pipe');
    await core.openFifo('/tmp/pipe', 'readwrite', 'writer', 'owner');
    await core.openFifo('/tmp/pipe', 'read', 'reader-a', 'owner');
    await core.openFifo('/tmp/pipe', 'read', 'reader-b', 'owner');
    const bytes = new Uint8Array([0, 255, 12, 0, 128, 42]);

    expect(await core.writeFifo('writer', bytes)).toBe(bytes.length);
    const first = await core.readFifo('reader-a', 2);
    const second = await core.readFifo('reader-b', 4);
    expect(first).toEqual(new Uint8Array([0, 255]));
    expect(second).toEqual(new Uint8Array([12, 0, 128, 42]));
    await core.closeFifo('writer');
    await core.closeFifo('reader-a');
    await core.closeFifo('reader-b');
  });

  it('waits for data, then returns EOF only after the final writer closes', async () => {
    await core.mkfifo('/tmp/pipe');
    await core.openFifo('/tmp/pipe', 'readwrite', 'writer-a', 'owner');
    await core.openFifo('/tmp/pipe', 'write', 'writer-b', 'owner');
    await core.openFifo('/tmp/pipe', 'read', 'reader', 'owner');
    const pendingRead = core.readFifo('reader', 8);

    await core.closeFifo('writer-a');
    expect(await core.writeFifo('writer-b', new Uint8Array([7]))).toBe(1);
    expect(await pendingRead).toEqual(new Uint8Array([7]));
    const secondRead = core.readFifo('reader', 8);
    await core.closeFifo('writer-b');
    expect(await secondRead).toEqual(new Uint8Array());
    await core.closeFifo('reader');
  });

  it('keeps small concurrent writes atomic and preserves their byte order', async () => {
    await core.mkfifo('/tmp/pipe');
    await core.openFifo('/tmp/pipe', 'readwrite', 'writer-a', 'owner');
    await core.openFifo('/tmp/pipe', 'write', 'writer-b', 'owner');
    await core.openFifo('/tmp/pipe', 'read', 'reader', 'owner');
    const firstPayload = new Uint8Array(ATOMIC_WRITE_SIZE).fill(0x31);
    const secondPayload = new Uint8Array(ATOMIC_WRITE_SIZE).fill(0x72);

    const writes = await Promise.all([
      core.writeFifo('writer-a', firstPayload),
      core.writeFifo('writer-b', secondPayload),
    ]);
    expect(writes).toEqual([ATOMIC_WRITE_SIZE, ATOMIC_WRITE_SIZE]);
    const output = await core.readFifo('reader', ATOMIC_WRITE_SIZE * 2);
    expect(output).toHaveLength(ATOMIC_WRITE_SIZE * 2);
    const firstByte = output[0];
    expect(firstByte === 0x31 || firstByte === 0x72).toBe(true);
    const boundary = output.findIndex(byte => byte !== firstByte);
    expect(boundary === -1 || boundary === ATOMIC_WRITE_SIZE).toBe(true);
    expect(output.slice(0, ATOMIC_WRITE_SIZE).every(byte => byte === firstByte)).toBe(true);
    expect(output.slice(ATOMIC_WRITE_SIZE).every(byte => byte !== firstByte)).toBe(true);
    await core.closeFifo('writer-a');
    await core.closeFifo('writer-b');
    await core.closeFifo('reader');
  });

  it('waits for enough room before writing an atomic chunk', async () => {
    await core.mkfifo('/tmp/pipe');
    await core.openFifo('/tmp/pipe', 'readwrite', 'writer', 'owner');
    await core.openFifo('/tmp/pipe', 'read', 'reader', 'owner');
    const bufferedBytes = CAPACITY - ATOMIC_WRITE_SIZE + 1;
    expect(await core.writeFifo('writer', new Uint8Array(bufferedBytes).fill(4))).toBe(
      bufferedBytes
    );
    const payload = new Uint8Array(ATOMIC_WRITE_SIZE).fill(9);
    const pendingWrite = core.writeFifo('writer', payload);

    expect(await core.readFifo('reader', bufferedBytes)).toEqual(
      new Uint8Array(bufferedBytes).fill(4)
    );
    expect(await pendingWrite).toBe(ATOMIC_WRITE_SIZE);
    expect(await core.readFifo('reader', ATOMIC_WRITE_SIZE)).toEqual(payload);
    await core.closeFifo('writer');
    await core.closeFifo('reader');
  });

  it('applies backpressure at capacity and resumes a blocked writer after a read', async () => {
    await core.mkfifo('/tmp/pipe');
    await core.openFifo('/tmp/pipe', 'readwrite', 'endpoint', 'owner');
    const full = new Uint8Array(CAPACITY).fill(1);
    expect(await core.writeFifo('endpoint', full)).toBe(CAPACITY);

    const pendingWrite = core.writeFifo('endpoint', new Uint8Array([2]));
    const pendingResult = expect(pendingWrite).resolves.toBe(1);
    expect(await core.readFifo('endpoint', 1)).toEqual(new Uint8Array([1]));
    await pendingResult;
    const remainder = await core.readFifo('endpoint', CAPACITY);
    expect(remainder).toHaveLength(CAPACITY);
    expect(remainder.at(-1)).toBe(2);
    await core.closeFifo('endpoint');
  });

  it('keeps unlinked endpoints attached to their FIFO after a same-path recreation', async () => {
    await core.mkfifo('/tmp/pipe');
    await core.openFifo('/tmp/pipe', 'readwrite', 'old', 'owner');
    await core.rm('/tmp/pipe');
    await core.mkfifo('/tmp/pipe');
    await core.openFifo('/tmp/pipe', 'readwrite', 'new', 'owner');

    expect(await core.writeFifo('old', new Uint8Array([1]))).toBe(1);
    expect(await core.writeFifo('new', new Uint8Array([9]))).toBe(1);
    expect(await core.readFifo('new', 1)).toEqual(new Uint8Array([9]));
    expect(await core.readFifo('old', 1)).toEqual(new Uint8Array([1]));
    expect(await core.stat('/tmp/pipe')).toMatchObject({ type: 'fifo', size: 0 });
    await core.closeFifo('old');
    await core.closeFifo('new');
  });

  it('clears buffered bytes after the final endpoint closes', async () => {
    await core.mkfifo('/tmp/pipe');
    await core.openFifo('/tmp/pipe', 'readwrite', 'first', 'first-owner');
    expect(await core.writeFifo('first', new Uint8Array([1, 2]))).toBe(2);
    await core.closeFifo('first');

    await core.openFifo('/tmp/pipe', 'readwrite', 'second', 'second-owner');
    expect(await core.writeFifo('second', new Uint8Array([8]))).toBe(1);
    expect(await core.readFifo('second', 8)).toEqual(new Uint8Array([8]));
    await core.closeFifo('second');
  });

  it('interrupts a blocked open when its endpoint closes', async () => {
    await core.mkfifo('/tmp/pipe');
    const waitingOpen = core.openFifo('/tmp/pipe', 'read', 'waiting', 'owner');
    const interrupted = expect(waitingOpen).rejects.toBeInstanceOf(FSError);

    await core.closeFifo('waiting');

    await interrupted;
    await expect(waitingOpen).rejects.toMatchObject({ code: 'EINTR' });
  });

  it('interrupts a blocked read when closeFifos closes its owner', async () => {
    await core.mkfifo('/tmp/pipe');
    await core.openFifo('/tmp/pipe', 'readwrite', 'reader', 'reader-owner');
    const pendingRead = core.readFifo('reader', 1);
    const interrupted = expect(pendingRead).rejects.toMatchObject({ code: 'EINTR' });

    await core.closeFifos('reader-owner');

    await interrupted;
    await expect(core.readFifo('reader', 1)).rejects.toMatchObject({ code: 'EBADF' });
  });

  it('interrupts a blocked write when its endpoint closes', async () => {
    await core.mkfifo('/tmp/pipe');
    await core.openFifo('/tmp/pipe', 'readwrite', 'endpoint', 'owner');
    expect(await core.writeFifo('endpoint', new Uint8Array(CAPACITY))).toBe(CAPACITY);
    const pendingWrite = core.writeFifo('endpoint', new Uint8Array([1]));
    const interrupted = expect(pendingWrite).rejects.toMatchObject({ code: 'EINTR' });

    await core.closeFifo('endpoint');

    await interrupted;
  });

  it('fails writes with EPIPE after the last reader closes', async () => {
    await core.mkfifo('/tmp/pipe');
    const openingReader = core.openFifo('/tmp/pipe', 'read', 'reader', 'reader-owner');
    await core.openFifo('/tmp/pipe', 'write', 'writer', 'writer-owner');
    await openingReader;
    await core.closeFifo('reader');

    await expect(core.writeFifo('writer', new Uint8Array([1]))).rejects.toMatchObject({
      code: 'EPIPE',
    });
    await core.closeFifo('writer');
  });
});
