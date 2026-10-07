import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FsChangeEvent } from '@/engine/core/fs';
import type { Project, ProjectFile } from '@/types';

const mocks = vi.hoisted(() => ({
  listeners: [] as Array<(event: FsChangeEvent) => void>,
  cleanups: [] as Array<() => void>,
  root: null as Project | null,
  effectCount: 0,
  walk: vi.fn<(rootPath: string) => Promise<ProjectFile[]>>(),
  setProjectFiles: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('react', () => ({
  useCallback: <Callback>(callback: Callback) => callback,
  useEffect: (effect: () => (() => void) | undefined) => {
    mocks.effectCount += 1;
    if (mocks.effectCount === 1) return;
    const cleanup = effect();
    if (cleanup) mocks.cleanups.push(cleanup);
  },
  useMemo: <Value>(callback: () => Value) => callback(),
  useState: <State>(initial: State | (() => State)) => {
    let value: State;
    if (typeof initial === 'function') value = (initial as () => State)();
    else value = initial;
    const setState = () => {
      if (Array.isArray(value)) mocks.setProjectFiles();
    };
    return [value, setState];
  },
}));

vi.mock('@/engine/core/fs', async importOriginal => {
  const actual = await importOriginal<typeof import('@/engine/core/fs')>();
  return {
    ...actual,
    fsClient: {
      init: vi.fn().mockResolvedValue(undefined),
      walk: mocks.walk,
      addChangeListener: (listener: (event: FsChangeEvent) => void) => {
        mocks.listeners.push(listener);
        return mocks.unsubscribe;
      },
    },
  };
});

vi.mock('@/engine/storage/recentFolderStorageAdapter', () => ({
  listRecentFolders: vi.fn().mockResolvedValue([]),
  saveRecentFolder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/stores/projectStore', () => ({
  getCurrentProject: () => mocks.root,
  setCurrentProject: (project: Project | null) => {
    mocks.root = project;
  },
}));

import { useProject } from '@/engine/core/project';

describe('useProject filesystem tree refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.listeners = [];
    mocks.cleanups = [];
    mocks.root = { rootPath: '/repo', name: 'repo', updatedAt: new Date() };
    mocks.effectCount = 0;
    mocks.walk.mockReset();
    mocks.walk.mockResolvedValue([]);
    mocks.setProjectFiles.mockReset();
    mocks.unsubscribe.mockReset();
  });

  afterEach(() => {
    for (const cleanup of mocks.cleanups) cleanup();
    vi.useRealTimers();
  });

  function mountProject(): (event: FsChangeEvent) => void {
    useProject();
    const listener = mocks.listeners[0];
    if (!listener) throw new Error('Filesystem listener was not registered.');
    return listener;
  }

  it('skips file updates and batches structural changes within the root', async () => {
    const listener = mountProject();
    listener({ type: 'update', path: '/repo/.git/index' });
    listener({ type: 'create', path: '/repo/a.ts' });
    listener({ type: 'delete', path: '/repo/b.ts' });
    listener({ type: 'rename', path: '/elsewhere/a.ts', oldPath: '/repo/a.ts' });
    listener({ type: 'rename', path: '/repo/moved.ts', oldPath: '/elsewhere/moved.ts' });
    listener({ type: 'create', path: '/repos/outside.ts' });

    await vi.advanceTimersByTimeAsync(99);
    expect(mocks.walk).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.walk).toHaveBeenCalledTimes(1);
    expect(mocks.walk).toHaveBeenCalledWith('/repo');
  });

  it('does not walk the tree for file updates alone', async () => {
    const listener = mountProject();
    listener({ type: 'update', path: '/repo/.git/index' });
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.walk).not.toHaveBeenCalled();
  });

  it('coalesces events arriving during an in-flight walk', async () => {
    let finishWalk: ((files: ProjectFile[] | PromiseLike<ProjectFile[]>) => void) | null = null;
    mocks.walk.mockImplementation(
      () =>
        new Promise(resolve => {
          finishWalk = resolve;
        })
    );
    const listener = mountProject();
    listener({ type: 'create', path: '/repo/first.ts' });
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.walk).toHaveBeenCalledTimes(1);

    listener({ type: 'delete', path: '/repo/second.ts' });
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.walk).toHaveBeenCalledTimes(1);
    finishWalk?.([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.walk).toHaveBeenCalledTimes(2);
  });

  it('ignores results from an old root and cancels pending work on cleanup', async () => {
    let finishWalk: ((files: ProjectFile[] | PromiseLike<ProjectFile[]>) => void) | null = null;
    mocks.walk.mockImplementation(
      () =>
        new Promise(resolve => {
          finishWalk = resolve;
        })
    );
    const listener = mountProject();
    listener({ type: 'create', path: '/repo/old.ts' });
    await vi.advanceTimersByTimeAsync(100);
    mocks.root = { rootPath: '/next', name: 'next', updatedAt: new Date() };
    finishWalk?.([]);
    await Promise.resolve();
    expect(mocks.setProjectFiles).not.toHaveBeenCalled();

    mocks.root = { rootPath: '/repo', name: 'repo', updatedAt: new Date() };
    listener({ type: 'create', path: '/repo/pending.ts' });
    for (const cleanup of mocks.cleanups) cleanup();
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.walk).toHaveBeenCalledTimes(1);
    expect(mocks.unsubscribe).toHaveBeenCalled();
  });

  it('does not publish a walk that finishes after unmount', async () => {
    let finishWalk: ((files: ProjectFile[] | PromiseLike<ProjectFile[]>) => void) | null = null;
    mocks.walk.mockImplementation(
      () =>
        new Promise(resolve => {
          finishWalk = resolve;
        })
    );
    const listener = mountProject();
    listener({ type: 'create', path: '/repo/file.ts' });
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.walk).toHaveBeenCalledTimes(1);
    for (const cleanup of mocks.cleanups) cleanup();
    finishWalk?.([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.setProjectFiles).not.toHaveBeenCalled();
  });
});
