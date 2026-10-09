import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FsChangeEvent } from '@/engine/core/fs';
import { saveRecentFolder } from '@/engine/storage/recentFolderStorageAdapter';
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
    const setState = (next: State) => {
      if (Array.isArray(value)) mocks.setProjectFiles(next);
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
      stat: vi.fn(async (path: string) => ({ path, type: 'folder', size: 0, mtime: 123 })),
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

function file(path: string, type: ProjectFile['type'] = 'file'): ProjectFile {
  return { path, type, size: 12, mtime: 123 };
}

describe('useProject filesystem tree publication', () => {
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

  async function useMountedProject() {
    const project = useProject();
    if (!mocks.root) throw new Error('Project root is not initialized.');
    await project.loadProject(mocks.root);
    mocks.setProjectFiles.mockClear();
    const listener = mocks.listeners[0];
    if (!listener) throw new Error('Filesystem listener was not registered.');
    return { project, listener };
  }

  it('batches npm-style structural metadata without walking the workspace again', async () => {
    const { listener } = await useMountedProject();
    for (let index = 0; index < 100; index += 1) {
      const entry = file(`/repo/node_modules/package-${index}`, 'folder');
      listener({ type: 'create', path: entry.path, file: entry });
    }
    listener({ type: 'create', path: '/repos/outside.ts', file: file('/repos/outside.ts') });
    await vi.advanceTimersByTimeAsync(99);
    expect(mocks.setProjectFiles).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.walk.mock.calls).toEqual([['/repo']]);
    expect(mocks.setProjectFiles).toHaveBeenCalledTimes(1);
    expect(mocks.setProjectFiles.mock.calls[0][0]).toHaveLength(100);
  });

  it('does not publish or walk for file updates alone', async () => {
    const { listener } = await useMountedProject();
    listener({ type: 'update', path: '/repo/.git/index', file: file('/repo/.git/index') });
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.walk).toHaveBeenCalledTimes(1);
    expect(mocks.setProjectFiles).not.toHaveBeenCalled();
  });

  it('retains an explicit manual refresh and cancels pending publication on cleanup', async () => {
    const { project, listener } = await useMountedProject();
    mocks.walk.mockResolvedValueOnce([file('/repo/manual.ts')]);
    await project.refreshProjectFiles();
    expect(mocks.walk.mock.calls).toEqual([['/repo'], ['/repo']]);
    expect(mocks.setProjectFiles).toHaveBeenLastCalledWith([file('/repo/manual.ts')]);
    mocks.setProjectFiles.mockClear();
    listener({ type: 'create', path: '/repo/pending.ts', file: file('/repo/pending.ts') });
    await Promise.resolve();
    for (const cleanup of mocks.cleanups) cleanup();
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.setProjectFiles).not.toHaveBeenCalled();
    expect(mocks.unsubscribe).toHaveBeenCalled();
  });

  it('runs workspace switching work after preparation but before committing the new root', async () => {
    const { project } = await useMountedProject();
    const previousProject = mocks.root;
    const nextProject = {
      rootPath: '/other',
      name: 'other',
      updatedAt: new Date(),
    };
    const beforeCommit = vi.fn(async () => {
      expect(mocks.root).toBe(previousProject);
    });

    await project.loadProject(nextProject, beforeCommit);

    expect(mocks.walk.mock.calls).toEqual([['/repo'], ['/other']]);
    expect(beforeCommit).toHaveBeenCalledOnce();
    expect(mocks.root).toEqual(nextProject);
  });

  it('keeps the current root and restores its tree when switching work fails', async () => {
    const { project } = await useMountedProject();
    const previousProject = mocks.root;
    const switchError = new Error('dirty file could not be saved');

    await expect(
      project.loadProject(
        { rootPath: '/other', name: 'other', updatedAt: new Date() },
        async () => {
          throw switchError;
        }
      )
    ).rejects.toBe(switchError);

    expect(mocks.root).toBe(previousProject);
    expect(mocks.walk.mock.calls).toEqual([['/repo'], ['/other'], ['/repo']]);
  });

  it('restores the current tree when recent-folder persistence fails', async () => {
    const { project } = await useMountedProject();
    const previousProject = mocks.root;
    vi.mocked(saveRecentFolder).mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(
      project.loadProject({ rootPath: '/other', name: 'other', updatedAt: new Date() })
    ).rejects.toThrow('storage unavailable');

    expect(mocks.root).toBe(previousProject);
    expect(mocks.walk.mock.calls).toEqual([['/repo'], ['/other'], ['/repo']]);
  });
});
