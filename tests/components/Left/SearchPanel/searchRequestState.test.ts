import { describe, expect, it } from 'vitest';
import { SearchRequestState } from '@/components/Left/SearchPanel/searchRequestState';

describe('SearchRequestState', () => {
  it('ignores delayed results from a previous root and caches by root', async () => {
    const state = new SearchRequestState<string>();
    let resolveOldSearch: (results: string[]) => void = () => {};
    const oldSearch = new Promise<string[]>(resolve => {
      resolveOldSearch = resolve;
    });
    const oldRequest = state.start('/workspace/a', 'needle', 'default');

    state.invalidate();
    const currentRequest = state.start('/workspace/b', 'needle', 'default');
    resolveOldSearch(['workspace a result']);

    const oldResults = await oldSearch;
    expect(state.complete(oldRequest, '/workspace/b', oldResults)).toBe(false);
    expect(state.getCached('/workspace/b', 'needle', 'default')).toBeNull();

    expect(state.complete(currentRequest, '/workspace/b', ['workspace b result'])).toBe(true);
    expect(state.getCached('/workspace/b', 'needle', 'default')).toEqual(['workspace b result']);
    expect(state.getCached('/workspace/a', 'needle', 'default')).toBeNull();
  });

  it('ignores errors from a previous root after a new search starts', async () => {
    const state = new SearchRequestState<string>();
    let rejectOldSearch: (error: Error) => void = () => {};
    const oldSearch = new Promise<string[]>((_resolve, reject) => {
      rejectOldSearch = reject;
    });
    const oldRequest = state.start('/workspace/a', 'needle', 'default');

    state.invalidate();
    state.start('/workspace/b', 'needle', 'default');
    rejectOldSearch(new Error('old search failed'));

    await expect(oldSearch).rejects.toThrow('old search failed');
    expect(state.isCurrent(oldRequest, '/workspace/b')).toBe(false);
    expect(state.getCached('/workspace/b', 'needle', 'default')).toBeNull();
  });

  it('restarts an in-flight request after its options or file tree changes', () => {
    const state = new SearchRequestState<string>();
    const oldRequest = state.start('/workspace', 'needle', 'before-change');

    state.invalidate();
    const refreshedRequest = state.start('/workspace', 'needle', 'after-change');

    expect(state.isCurrent(oldRequest, '/workspace')).toBe(false);
    expect(state.complete(oldRequest, '/workspace', ['stale result'])).toBe(false);
    expect(state.complete(refreshedRequest, '/workspace', ['fresh result'])).toBe(true);
    expect(state.getCached('/workspace', 'needle', 'after-change')).toEqual(['fresh result']);
    expect(state.getCached('/workspace', 'needle', 'before-change')).toBeNull();
  });
});
