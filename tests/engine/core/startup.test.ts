import { afterEach, describe, expect, it, vi } from 'vitest';
import { runStartupStage, type StartupContext } from '@/engine/core/startup';

afterEach(() => vi.useRealTimers());

describe('startup inactivity deadline', () => {
  it('allows a long migration while verified records keep arriving', async () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    const result = runStartupStage(
      'Migration',
      async context => {
        for (let completed = 1; completed <= 3; completed += 1) {
          await new Promise(resolve => setTimeout(resolve, 40_000));
          context.report({ detail: 'Verified file', completed, total: 3 });
        }
        return 'complete';
      },
      onProgress
    );
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(result).resolves.toBe('complete');
    expect(onProgress).toHaveBeenLastCalledWith('Migration', {
      detail: 'Verified file',
      completed: 3,
      total: 3,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects stalled startup and prevents late progress from resuming it', async () => {
    vi.useFakeTimers();
    let active: StartupContext | undefined;
    const result = runStartupStage(
      'Migration',
      context => {
        active = context;
        context.report({ detail: 'Copying /home/pyxis/project/large.bin' });
        return new Promise<void>(() => {});
      },
      vi.fn()
    );
    const rejected = expect(result).rejects.toThrow('large.bin');
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
    expect(active?.signal.aborted).toBe(true);
    expect(() => active?.report({ detail: 'Late completion' })).toThrow('timed out');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs failures with the stage and elapsed time and clears the deadline', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('Worker failed');
    await expect(
      runStartupStage(
        'Filesystem',
        async () => {
          throw error;
        },
        vi.fn()
      )
    ).rejects.toBe(error);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Filesystem: failed after'), error);
    expect(vi.getTimerCount()).toBe(0);
    log.mockRestore();
  });
});
