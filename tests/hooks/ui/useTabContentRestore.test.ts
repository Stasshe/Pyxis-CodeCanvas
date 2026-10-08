import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EditorPane, EditorTab } from '@/engine/tabs/types';

type RestoreState = {
  panes: EditorPane[];
  isLoading: boolean;
  isRestored: boolean;
  isContentRestored: boolean;
  sessionGeneration: number;
  sessionRootPath: string | null;
};

const mocks = vi.hoisted(() => ({
  tabState: {
    panes: [] as EditorPane[],
    isLoading: false,
    isRestored: true,
    isContentRestored: false,
    sessionGeneration: 0,
    sessionRootPath: null,
  },
  projectState: { currentRootPath: null as string | null },
  refs: [] as object[],
  refIndex: 0,
  frames: [] as Array<(timestamp: number) => Promise<void>>,
  exists: vi.fn(),
  readFileContent: vi.fn(),
  setPanes: vi.fn(),
  setIsContentRestored: vi.fn(),
  initTabSaveSync: vi.fn(),
  dirtyTabIds: new Set<string>(),
}));

vi.mock('react', () => ({
  useCallback: <T extends (...args: never[]) => object>(callback: T) => callback,
  useEffect: (effect: () => void) => effect(),
  useRef: <T>(initial: T) => {
    const index = mocks.refIndex;
    mocks.refIndex += 1;
    if (!mocks.refs[index]) mocks.refs[index] = { current: initial };
    return mocks.refs[index] as { current: T };
  },
}));

vi.mock('valtio', () => ({
  snapshot: <T>(state: T) => state,
  useSnapshot: <T>(state: T) => state,
}));

vi.mock('@/engine/core/fs', () => ({
  fsClient: { exists: mocks.exists },
}));

vi.mock('@/engine/core/fileContent', () => ({
  readFileContent: mocks.readFileContent,
}));

vi.mock('@/engine/tabs/TabRegistry', () => ({
  tabRegistry: { get: () => undefined },
}));

vi.mock('@/stores/projectStore', () => ({
  getCurrentRootPath: () => mocks.projectState.currentRootPath,
  projectState: mocks.projectState,
}));

vi.mock('@/stores/tabContentStore', () => ({
  isTabDirty: (id: string) => mocks.dirtyTabIds.has(id),
  setBufferContent: vi.fn(),
  setTabContent: vi.fn(),
}));

vi.mock('@/stores/tabState', () => ({
  initTabSaveSync: mocks.initTabSaveSync,
  tabActions: {
    setIsContentRestored: (restored: boolean) => {
      mocks.setIsContentRestored(restored);
      mocks.tabState.isContentRestored = restored;
    },
    setPanes: (panes: EditorPane[]) => {
      mocks.setPanes(panes);
      mocks.tabState.panes = panes;
    },
  },
  tabState: mocks.tabState,
}));

import { useTabContentRestore } from '@/hooks/ui/useTabContentRestore';

function editorTab(id: string, path: string): EditorTab {
  return {
    id,
    name: id,
    kind: 'editor',
    path,
    paneId: 'pane',
    content: '',
    isDirty: false,
    needsContentRestore: true,
  };
}

function setSession(rootPath: string, generation: number, tab: EditorTab): void {
  const state = mocks.tabState as RestoreState;
  mocks.projectState.currentRootPath = rootPath;
  state.sessionRootPath = rootPath;
  state.sessionGeneration = generation;
  state.isLoading = false;
  state.isRestored = true;
  state.isContentRestored = false;
  state.panes = [{ id: 'pane', tabs: [tab], activeTabId: tab.id }];
}

function renderRestore(): void {
  mocks.refIndex = 0;
  useTabContentRestore(true);
}

async function restoreNextFrame(): Promise<void> {
  const frame = mocks.frames.shift();
  expect(frame).toBeDefined();
  await frame?.(0);
}

function deferred<T>() {
  let resolve = (_value: T) => {};
  let reject = (_reason: Error) => {};
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('useTabContentRestore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.refs = [];
    mocks.refIndex = 0;
    mocks.frames = [];
    mocks.dirtyTabIds.clear();
    mocks.projectState.currentRootPath = null;
    Object.assign(mocks.tabState, {
      panes: [],
      isLoading: false,
      isRestored: true,
      isContentRestored: false,
      sessionGeneration: 0,
      sessionRootPath: null,
    });
    mocks.exists.mockResolvedValue(true);
    mocks.initTabSaveSync.mockResolvedValue(undefined);
    mocks.readFileContent.mockImplementation(async (path: string) => ({
      kind: 'text',
      content: `content:${path}`,
    }));
    vi.stubGlobal('requestAnimationFrame', (callback: (timestamp: number) => Promise<void>) => {
      mocks.frames.push(callback);
      return 1;
    });
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('restores each newly loaded session, including a same-root reopen', async () => {
    setSession('/workspace/a', 1, editorTab('first', '/workspace/a/main.ts'));
    renderRestore();
    await restoreNextFrame();
    expect(mocks.setIsContentRestored).toHaveBeenLastCalledWith(true);
    expect((mocks.tabState as RestoreState).panes[0].tabs[0].content).toBe(
      'content:/workspace/a/main.ts'
    );

    setSession('/workspace/a', 2, editorTab('reopened', '/workspace/a/README.md'));
    renderRestore();
    await restoreNextFrame();

    expect(mocks.setPanes).toHaveBeenCalledTimes(2);
    expect((mocks.tabState as RestoreState).panes[0].tabs[0].content).toBe(
      'content:/workspace/a/README.md'
    );
    expect(mocks.setIsContentRestored).toHaveBeenCalledTimes(2);
  });

  it('does not let an old restore commit after a newer session starts', async () => {
    const firstRead = deferred<boolean>();
    const secondRead = deferred<boolean>();
    mocks.exists.mockImplementation((path: string) => {
      if (path.includes('/workspace/a/')) return firstRead.promise;
      return secondRead.promise;
    });

    setSession('/workspace/a', 1, editorTab('old', '/workspace/a/main.ts'));
    renderRestore();
    const oldRestore = mocks.frames.shift()?.(0);
    await Promise.resolve();

    setSession('/workspace/b', 2, editorTab('current', '/workspace/b/main.ts'));
    renderRestore();
    const currentRestore = mocks.frames.shift()?.(0);
    await Promise.resolve();

    firstRead.resolve(true);
    await oldRestore;
    expect(mocks.setPanes).not.toHaveBeenCalled();
    expect((mocks.tabState as RestoreState).isContentRestored).toBe(false);

    secondRead.resolve(true);
    await currentRestore;
    expect((mocks.tabState as RestoreState).panes[0].tabs[0].id).toBe('current');
    expect((mocks.tabState as RestoreState).panes[0].tabs[0].content).toBe(
      'content:/workspace/b/main.ts'
    );
    expect((mocks.tabState as RestoreState).isContentRestored).toBe(true);
  });

  it('waits until the selected root owns a loaded session', async () => {
    setSession('/workspace/a', 1, editorTab('old', '/workspace/a/main.ts'));
    mocks.projectState.currentRootPath = '/workspace/b';
    renderRestore();
    expect(mocks.frames).toHaveLength(0);
    expect(mocks.setPanes).not.toHaveBeenCalled();

    const state = mocks.tabState as RestoreState;
    state.sessionRootPath = '/workspace/b';
    state.sessionGeneration = 2;
    state.isLoading = true;
    state.isRestored = false;
    renderRestore();
    expect(mocks.frames).toHaveLength(0);

    state.panes = [{ id: 'pane', tabs: [editorTab('new', '/workspace/b/main.ts')], activeTabId: 'new' }];
    state.isLoading = false;
    state.isRestored = true;
    renderRestore();
    await restoreNextFrame();
    expect((mocks.tabState as RestoreState).panes[0].tabs[0].id).toBe('new');
    expect((mocks.tabState as RestoreState).isContentRestored).toBe(true);
  });

  it('ignores a queued animation frame after a newer session starts', async () => {
    setSession('/workspace/a', 1, editorTab('old', '/workspace/a/main.ts'));
    renderRestore();
    const oldFrame = mocks.frames.shift();

    setSession('/workspace/b', 2, editorTab('current', '/workspace/b/main.ts'));
    renderRestore();
    const currentFrame = mocks.frames.shift();

    await oldFrame?.(0);
    expect(mocks.exists).not.toHaveBeenCalled();
    await currentFrame?.(0);
    expect((mocks.tabState as RestoreState).panes[0].tabs[0].content).toBe(
      'content:/workspace/b/main.ts'
    );
  });

  it('ignores a stale restore rejection while a newer session is loading', async () => {
    const rejectFirstSync = deferred<void>();
    mocks.initTabSaveSync
      .mockImplementationOnce(() => rejectFirstSync.promise)
      .mockResolvedValue(undefined);

    setSession('/workspace/a', 1, editorTab('old', '/workspace/a/main.ts'));
    renderRestore();
    const oldRestore = mocks.frames.shift()?.(0);
    await Promise.resolve();

    setSession('/workspace/b', 2, editorTab('current', '/workspace/b/main.ts'));
    const state = mocks.tabState as RestoreState;
    state.isLoading = true;
    state.isRestored = false;
    renderRestore();

    rejectFirstSync.reject(new Error('stale failure'));
    await oldRestore;
    expect(state.isContentRestored).toBe(false);
    expect(mocks.setIsContentRestored).not.toHaveBeenCalled();

    state.isLoading = false;
    state.isRestored = true;
    renderRestore();
    await restoreNextFrame();
    expect(state.isContentRestored).toBe(true);
  });

  it('preserves dirty tab content while completing session restoration', async () => {
    const tab = editorTab('dirty', '/workspace/a/main.ts');
    tab.content = 'unsaved';
    mocks.dirtyTabIds.add(tab.id);
    setSession('/workspace/a', 1, tab);

    renderRestore();
    await restoreNextFrame();

    expect((mocks.tabState as RestoreState).panes[0].tabs[0].content).toBe('unsaved');
    expect((mocks.tabState as RestoreState).isContentRestored).toBe(true);
  });

  it('does not dispatch a delayed refresh for an earlier session', async () => {
    setSession('/workspace/a', 1, editorTab('first', '/workspace/a/main.ts'));
    renderRestore();
    await restoreNextFrame();

    setSession('/workspace/b', 2, editorTab('current', '/workspace/b/main.ts'));
    const state = mocks.tabState as RestoreState;
    state.isLoading = true;
    state.isRestored = false;
    renderRestore();
    vi.advanceTimersByTime(100);

    expect(window.dispatchEvent).not.toHaveBeenCalled();
    expect(state.isContentRestored).toBe(false);
  });
});
