import { describe, expect, it } from 'vitest';
import { NamespaceLock } from '@/engine/core/fs/locks';

describe('filesystem namespace leases', () => {
  it('does not allow new readers to overtake a waiting structural mutation', async () => {
    const lock = new NamespaceLock();
    const order: string[] = [];
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    const first = lock.shared(async () => {
      order.push('first');
      entered();
      await waiting;
    });
    await started;
    const writer = lock.exclusive(async () => {
      order.push('writer');
    });
    const later = lock.shared(async () => {
      order.push('later');
    });
    expect(order).toEqual(['first']);
    release();
    await Promise.all([first, writer, later]);
    expect(order).toEqual(['first', 'writer', 'later']);
  });

  it('releases failed shared and exclusive operations', async () => {
    const lock = new NamespaceLock();
    await expect(
      lock.shared(async () => {
        throw new Error('read failed');
      })
    ).rejects.toThrow('read failed');
    await expect(
      lock.exclusive(async () => {
        throw new Error('mutation failed');
      })
    ).rejects.toThrow('mutation failed');
    expect(await lock.shared(async () => 'recovered')).toBe('recovered');
  });
});
