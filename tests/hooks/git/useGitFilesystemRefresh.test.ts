import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FsChangeEvent } from '@/engine/core/fs/index';

const mocks = vi.hoisted(() => ({
  listener: null as ((event: FsChangeEvent) => void) | null,
  cleanup: null as (() => void) | null,
  unsubscribe: vi.fn(),
  triggerGitRefresh: vi.fn(),
}));

vi.mock('react', () => ({
  useEffect: (effect: () => (() => void) | undefined) => {
    mocks.cleanup = effect() ?? null;
  },
}));

vi.mock('@/engine/core/fs/index', async importOriginal => {
  const actual = await importOriginal<typeof import('@/engine/core/fs/index')>();
  return {
    ...actual,
    fsClient: {
      addChangeListener: (listener: (event: FsChangeEvent) => void) => {
        mocks.listener = listener;
        return mocks.unsubscribe;
      },
    },
  };
});

vi.mock('@/stores/gitRefreshStore', () => ({
  triggerGitRefresh: mocks.triggerGitRefresh,
}));

import { useGitFilesystemRefresh } from '@/hooks/git/useGitFilesystemRefresh';

describe('useGitFilesystemRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.listener = null;
    mocks.cleanup = null;
    mocks.unsubscribe.mockReset();
    mocks.triggerGitRefresh.mockReset();
  });

  afterEach(() => {
    mocks.cleanup?.();
    vi.useRealTimers();
  });

  it('coalesces changes within the root and includes rename source paths', () => {
    useGitFilesystemRefresh('/repo');
    const listener = mocks.listener;
    expect(listener).not.toBeNull();

    listener?.({ type: 'update', path: '/repos/repo/README.md' });
    listener?.({ type: 'update', path: '/repo/.git/index' });
    listener?.({ type: 'rename', path: '/elsewhere/README.md', oldPath: '/repo/README.md' });

    vi.advanceTimersByTime(99);
    expect(mocks.triggerGitRefresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(mocks.triggerGitRefresh).toHaveBeenCalledTimes(1);
  });

  it('coalesces repeated writes to one file into a single Git refresh', () => {
    useGitFilesystemRefresh('/repo');
    const listener = mocks.listener;
    expect(listener).not.toBeNull();

    listener?.({ type: 'update', path: '/repo/src/shared.ts' });
    listener?.({ type: 'update', path: '/repo/src/shared.ts' });

    vi.advanceTimersByTime(100);
    expect(mocks.triggerGitRefresh).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes and cancels pending refreshes on cleanup', () => {
    useGitFilesystemRefresh('/repo');
    mocks.listener?.({ type: 'create', path: '/repo/file.txt' });
    mocks.cleanup?.();
    vi.runAllTimers();

    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.triggerGitRefresh).not.toHaveBeenCalled();
  });
});
