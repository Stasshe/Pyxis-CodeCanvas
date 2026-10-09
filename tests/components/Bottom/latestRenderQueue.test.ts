import { describe, expect, it } from 'vitest';
import { LatestRenderQueue } from '@/components/Bottom/latestRenderQueue';

describe('latest render queue', () => {
  it('keeps the active render and coalesces pending snapshots to the latest state', async () => {
    const rendered: number[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstRender = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const queue = new LatestRenderQueue<number>(
      async state => {
        rendered.push(state);
        if (state === 1) await firstRender;
      },
      error => {
        throw error;
      }
    );

    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3);
    const flushed = queue.flush();
    expect(rendered).toEqual([1]);

    releaseFirst?.();
    await flushed;
    expect(rendered).toEqual([1, 3]);
  });

  it('waits for a newly queued state before completing a flush', async () => {
    const rendered: number[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstRender = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const queue = new LatestRenderQueue<number>(
      async state => {
        rendered.push(state);
        if (state === 1) await firstRender;
      },
      error => {
        throw error;
      }
    );

    queue.enqueue(1);
    queue.enqueue(2);
    let flushed = false;
    const flush = queue.flush().then(() => {
      flushed = true;
    });
    expect(flushed).toBe(false);
    releaseFirst?.();
    await flush;

    expect(rendered).toEqual([1, 2]);
  });
});
