import { afterEach, expect, it, vi } from 'vitest';
import { GitHubAPI, GitHubAPIError } from '@/engine/system/git/github/GitHubAPI';

afterEach(() => vi.unstubAllGlobals());

it('propagates nonmissing tree errors instead of attempting another upload', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ message: 'Unavailable' }), { status: 503 }))
  );
  const api = new GitHubAPI('fixture-token', 'example', 'repo');
  await expect(api.treeExists('f'.repeat(40))).rejects.toBeInstanceOf(GitHubAPIError);
});

it('uses HTTP status rather than numeric substrings in a message', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: 'backend 404 dependency failed' }), { status: 500 })
      )
  );
  const api = new GitHubAPI('fixture-token', 'example', 'repo');
  await expect(api.getRef('main')).rejects.toMatchObject({ status: 500 });
});
