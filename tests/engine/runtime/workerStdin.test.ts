import type { Buffer } from 'buffer';
import { describe, expect, it, vi } from 'vitest';
import { WorkerStdin } from '@/engine/runtime/nodejs/workerStdin';

describe('WorkerStdin', () => {
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

    expect(received).toEqual(['first\n', 'second\n']);
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

    expect(received).toEqual(['first\n', 'second\n']);
    expect(order).toEqual(['data', 'data', 'end']);
    expect(tracked).toHaveLength(2);
    await tracked[1];
  });
});
