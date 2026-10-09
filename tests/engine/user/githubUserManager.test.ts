import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getAccessToken: vi.fn<() => Promise<string | null>>() }));

vi.mock('@/engine/user/authRepository', () => ({
  authRepository: { getAccessToken: mocks.getAccessToken },
}));

import { githubUserManager } from '@/engine/user/githubUserManager';

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function user(login: string) {
  return {
    login,
    name: login,
    email: null,
    avatar_url: '',
    bio: null,
    company: null,
    location: null,
    blog: null,
    twitter_username: null,
    public_repos: 0,
    public_gists: 0,
    followers: 0,
    following: 0,
    created_at: '',
    updated_at: '',
  };
}

afterEach(() => {
  githubUserManager.clearCache();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('GitHub user cache', () => {
  it('does not repopulate the cache when a request completes after sign-out', async () => {
    const response = deferred<Response>();
    mocks.getAccessToken.mockResolvedValue('token');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response.promise)
    );

    const pendingUser = githubUserManager.getUser();
    await Promise.resolve();
    await Promise.resolve();
    githubUserManager.clearCache();
    response.resolve({ ok: true, json: async () => user('stale') } as Response);

    await expect(pendingUser).resolves.toBeNull();
    expect(githubUserManager.getCachedUser()).toBeNull();
  });

  it('does not let an older request clear or replace a newer request', async () => {
    const oldResponse = deferred<Response>();
    const newResponse = deferred<Response>();
    mocks.getAccessToken.mockResolvedValue('token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValueOnce(oldResponse.promise).mockReturnValueOnce(newResponse.promise)
    );

    const oldRequest = githubUserManager.getUser();
    await Promise.resolve();
    await Promise.resolve();
    githubUserManager.clearCache();
    const newRequest = githubUserManager.getUser();
    await Promise.resolve();
    await Promise.resolve();

    oldResponse.resolve({ ok: true, json: async () => user('old') } as Response);
    newResponse.resolve({ ok: true, json: async () => user('new') } as Response);
    await expect(oldRequest).resolves.toBeNull();
    await expect(newRequest).resolves.toMatchObject({ login: 'new' });
    expect(githubUserManager.getCachedUser()?.login).toBe('new');
  });
});
