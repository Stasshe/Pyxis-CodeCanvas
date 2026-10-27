import { PassThrough } from 'node:stream';
import type { Buffer } from 'buffer';
import { describe, expect, it, vi } from 'vitest';
import { WorkerStdin } from '@/engine/system/runtime/nodejs/workerStdin';

describe('WorkerStdin', () => {
  it('is a byte-preserving stream-browserify PassThrough with encoded reads', async () => {
    const stdin = new WorkerStdin(
      () => {},
      () => {},
      () => {}
    );
    expect(stdin).toBeInstanceOf(PassThrough);
    stdin.setEncoding('utf8');
    let received = '';
    const ended = new Promise<void>(resolve => stdin.once('end', resolve));
    stdin.on('data', chunk => {
      received += chunk;
    });
    await vi.waitFor(() => expect(stdin.listenerCount('data')).toBe(1));

    stdin.submit(Uint8Array.of(0xe2, 0x82));
    stdin.submit(Uint8Array.of(0xac));
    stdin.eof();
    await ended;

    expect(received).toBe('€');
  });

  it('supports readable-mode consumers and requests input only while observed', async () => {
    const requestInput = vi.fn();
    const stdin = new WorkerStdin(
      () => {},
      requestInput,
      () => {}
    );
    const received = new Promise<Buffer>(resolve => {
      stdin.on('readable', () => {
        const chunk = stdin.read();
        if (chunk) resolve(chunk);
      });
    });
    await vi.waitFor(() => expect(requestInput).toHaveBeenCalledOnce());

    stdin.submit(Uint8Array.of(0, 255, 128));
    expect([...(await received)]).toEqual([0, 255, 128]);
    const ended = new Promise<void>(resolve => stdin.once('end', resolve));
    stdin.eof();
    await ended;
  });

  it('resumes buffered delivery when a data consumer attaches after one was removed', async () => {
    const requestInput = vi.fn();
    const stdin = new WorkerStdin(
      () => {},
      requestInput,
      () => {}
    );
    const firstListener = vi.fn();
    stdin.on('data', firstListener);
    await vi.waitFor(() => expect(requestInput).toHaveBeenCalledOnce());
    stdin.removeListener('data', firstListener);
    stdin.submit('buffered');

    const received = new Promise<Buffer>(resolve => stdin.on('data', resolve));
    await expect(received).resolves.toEqual(Buffer.from('buffered'));
  });

  it('keeps an explicit pause until resume even when a data listener attaches later', async () => {
    const stdin = new WorkerStdin(
      () => {},
      () => {},
      () => {}
    );
    stdin.pause();
    stdin.submit('buffered');
    let received = false;
    const chunk = new Promise<Buffer>(resolve => {
      stdin.on('data', value => {
        received = true;
        resolve(value);
      });
    });
    await Promise.resolve();
    expect(received).toBe(false);

    stdin.resume();
    await expect(chunk).resolves.toEqual(Buffer.from('buffered'));
  });

  it('forwards raw-mode changes to the terminal host', () => {
    const changeRawMode = vi.fn();
    const stdin = new WorkerStdin(
      () => {},
      () => {},
      () => {},
      changeRawMode
    );

    expect(stdin.setRawMode(true)).toBe(stdin);
    expect(changeRawMode).toHaveBeenCalledWith(true);
  });

  it('buffers queued lines while paused and delivers them in order after resume', async () => {
    const requestInput = vi.fn();
    const pauseInput = vi.fn();
    const received: string[] = [];
    const stdin = new WorkerStdin(() => {}, requestInput, pauseInput);
    stdin.on('data', (chunk: Buffer) => received.push(chunk.toString()));
    await Promise.resolve();

    stdin.pause();
    stdin.submit('first\n');
    stdin.submit('second\n');

    expect(pauseInput).toHaveBeenCalledOnce();
    expect(received).toEqual([]);

    stdin.resume();
    await Promise.resolve();

    await vi.waitFor(() => expect(received).toEqual(['first\n', 'second\n']));
  });

  it('delivers queued data before EOF when the source ends while paused', async () => {
    const tracked: Promise<void>[] = [];
    const stdin = new WorkerStdin(
      promise => tracked.push(promise),
      () => {},
      () => {}
    );
    const received: string[] = [];
    const order: string[] = [];
    stdin.on('data', (chunk: Buffer) => {
      received.push(chunk.toString());
      order.push('data');
    });
    stdin.once('end', () => order.push('end'));
    await Promise.resolve();

    stdin.pause();
    stdin.submit('first\n');
    stdin.submit('second\n');
    stdin.eof();

    expect(received).toEqual([]);
    expect(order).toEqual([]);
    expect(tracked).toHaveLength(1);

    let pausedTrackingSettled = false;
    void tracked[0]?.then(() => {
      pausedTrackingSettled = true;
    });
    await Promise.resolve();
    expect(pausedTrackingSettled).toBe(true);

    stdin.resume();

    await vi.waitFor(() => expect(received).toEqual(['first\n', 'second\n']));
    await vi.waitFor(() => expect(order).toEqual(['data', 'data', 'end']));
    expect(tracked).toHaveLength(2);
    await tracked[1];
  });

  it('releases pending input and discards listeners and queued data on disposal', async () => {
    const tracked: Promise<void>[] = [];
    const requestInput = vi.fn();
    const stdin = new WorkerStdin(
      promise => tracked.push(promise),
      requestInput,
      () => {}
    );
    const listener = vi.fn();
    stdin.on('data', listener);
    await Promise.resolve();
    stdin.dispose();
    stdin.submit('late input');
    await Promise.resolve();

    expect(tracked).toHaveLength(1);
    await tracked[0];
    expect(listener).not.toHaveBeenCalled();
    expect(requestInput).toHaveBeenCalledOnce();
  });
});
