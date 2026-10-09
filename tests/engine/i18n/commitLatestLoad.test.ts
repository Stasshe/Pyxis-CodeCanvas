import { describe, expect, it } from 'vitest';
import { commitLatestLoad } from '@/engine/i18n/commitLatestLoad';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('commitLatestLoad', () => {
  it('ignores an older result that resolves after the latest request', async () => {
    let currentRequest = 1;
    const oldLoad = deferred<string>();
    const latestLoad = deferred<string>();
    const committed: string[] = [];
    const oldRequest = commitLatestLoad(
      1,
      () => currentRequest,
      () => oldLoad.promise,
      value => committed.push(value)
    );

    currentRequest = 2;
    const latestRequest = commitLatestLoad(
      2,
      () => currentRequest,
      () => latestLoad.promise,
      value => committed.push(value)
    );

    latestLoad.resolve('latest');
    await expect(latestRequest).resolves.toBe(true);
    oldLoad.resolve('stale');
    await expect(oldRequest).resolves.toBe(false);
    expect(committed).toEqual(['latest']);
  });
});
