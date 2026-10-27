import { describe, expect, it } from 'vitest';
import { isAIRequestIdentityCurrent, updateAIRequestIdentity } from '@/engine/ide/ai/requestIdentity';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('AI request identity', () => {
  it('invalidates a request when switching away and back to the same workspace and space', () => {
    const initial = { rootPath: '/workspace', spaceId: 'space-a', generation: 0 };
    const switchedAway = updateAIRequestIdentity(initial, '/other-workspace', 'space-b');
    const switchedBack = updateAIRequestIdentity(switchedAway, '/workspace', 'space-a');

    expect(isAIRequestIdentityCurrent(initial, switchedBack)).toBe(false);
  });

  it('drops a file read that resolves after the request identity changes', async () => {
    const request = { rootPath: '/workspace', spaceId: 'space-a', generation: 1 };
    let active = request;
    const read = deferred<string>();
    const result = read.promise.then(content =>
      isAIRequestIdentityCurrent(request, active) ? content : null
    );

    active = updateAIRequestIdentity(active, '/workspace', null);
    read.resolve('file content');

    await expect(result).resolves.toBeNull();
  });

  it('treats a missing captured space as an identity, not a wildcard', () => {
    const request = { rootPath: '/workspace', spaceId: null, generation: 1 };
    const active = updateAIRequestIdentity(request, '/workspace', 'space-a');

    expect(isAIRequestIdentityCurrent(request, active)).toBe(false);
  });
});
