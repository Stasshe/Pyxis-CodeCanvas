import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fsClient } from '@/engine/core/fs/index';
import type { EditorTab } from '@/engine/ide/tabs/types';
import { setCurrentProject } from '@/stores/projectStore';
import { type PyxisSession, sessionStore } from '@/stores/sessionStore';
import {
  clearTabContent,
  getTabContent,
  isTabDirty,
  setTabContent,
} from '@/stores/tabContentStore';
import { tabActions, tabState } from '@/stores/tabState';

function editorTab(id: string, path: string): EditorTab {
  return {
    id,
    name: id,
    kind: 'editor',
    path,
    paneId: 'pane',
    content: '',
    isDirty: false,
  };
}

function sessionWithTab(id: string, path: string): PyxisSession {
  const tab = editorTab(id, path);
  return {
    version: 1,
    lastSaved: Date.now(),
    tabs: {
      panes: [{ id: 'pane', tabs: [tab], activeTabId: id }],
      activePane: 'pane',
      globalActiveTab: id,
    },
    ui: {
      leftSidebarWidth: 240,
      rightSidebarWidth: 240,
      bottomPanelHeight: 200,
      isLeftSidebarVisible: true,
      isRightSidebarVisible: true,
      isBottomPanelVisible: true,
    },
  };
}

describe('tab session root switching', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    tabState.panes = [];
    tabState.activePane = null;
    tabState.globalActiveTab = null;
    tabState.isLoading = false;
    tabState.isRestored = true;
    tabState.isContentRestored = true;
    tabState.sessionError = null;
    tabState.sessionGeneration = 0;
    tabState.sessionRootPath = null;
    setCurrentProject({ rootPath: '/workspace/a', name: 'a', updatedAt: new Date() });
  });

  afterEach(() => {
    clearTabContent('shared-tab-id');
  });

  it('keeps an empty pane available when no workspace is open', async () => {
    setCurrentProject(null);

    await tabActions.loadSession(null);

    expect(tabState.panes).toEqual([{ id: 'pane-1', tabs: [], activeTabId: '' }]);
    expect(tabState.activePane).toBe('pane-1');
    expect(tabState.isRestored).toBe(true);
    expect(tabState.isContentRestored).toBe(true);
  });

  it('advances the restore generation when the same root is reopened', async () => {
    vi.spyOn(sessionStore, 'load').mockResolvedValue(sessionWithTab('tab', '/workspace/a/main.ts'));

    await tabActions.loadSession('/workspace/a');
    const firstGeneration = tabState.sessionGeneration;

    await tabActions.loadSession('/workspace/a');

    expect(tabState.sessionGeneration).toBeGreaterThan(firstGeneration);
    expect(tabState.sessionRootPath).toBe('/workspace/a');
  });

  it('ignores a slower session load after switching to another root', async () => {
    let finishFirstLoad: (session: PyxisSession) => void = () => {};
    vi.spyOn(sessionStore, 'load').mockImplementation((rootPath: string) => {
      if (rootPath === '/workspace/a') {
        return new Promise(resolve => {
          finishFirstLoad = resolve;
        });
      }
      return Promise.resolve(sessionWithTab('b-tab', '/workspace/b/main.ts'));
    });

    const firstLoad = tabActions.loadSession('/workspace/a');
    await vi.waitFor(() => expect(sessionStore.load).toHaveBeenCalledWith('/workspace/a'));
    expect(tabState.isLoading).toBe(true);
    expect(tabState.isRestored).toBe(false);

    setCurrentProject({ rootPath: '/workspace/b', name: 'b', updatedAt: new Date() });
    await tabActions.loadSession('/workspace/b');
    finishFirstLoad(sessionWithTab('a-tab', '/workspace/a/main.ts'));
    await firstLoad;

    expect(tabState.panes[0].tabs.map(tab => tab.id)).toEqual(['b-tab']);
    expect(tabState.activePane).toBe('pane');
    expect(tabState.globalActiveTab).toBe('b-tab');
    expect(tabState.isLoading).toBe(false);
  });

  it('does not expose dirty content from the previous workspace when tab IDs match', async () => {
    tabState.panes = [
      {
        id: 'pane',
        tabs: [editorTab('shared-tab-id', '/workspace/a/main.ts')],
        activeTabId: 'shared-tab-id',
      },
    ];
    setTabContent('shared-tab-id', 'workspace A draft', true);
    vi.spyOn(sessionStore, 'load').mockResolvedValue(
      sessionWithTab('shared-tab-id', '/workspace/b/main.ts')
    );
    vi.spyOn(fsClient, 'exists').mockResolvedValue(false);
    vi.spyOn(fsClient, 'writeFile').mockResolvedValue(undefined);
    setCurrentProject({ rootPath: '/workspace/b', name: 'b', updatedAt: new Date() });

    await tabActions.loadSession('/workspace/b');

    expect(getTabContent('shared-tab-id')).toBeUndefined();
    expect(isTabDirty('shared-tab-id')).toBe(false);
  });

  it('preserves old tabs when the final workspace-switch flush fails', async () => {
    const oldTab = editorTab('old-tab', '/workspace/a/main.ts');
    tabState.panes = [{ id: 'pane', tabs: [oldTab], activeTabId: oldTab.id }];
    setTabContent(oldTab.id, 'unsaved old workspace content', true);
    const load = vi.spyOn(sessionStore, 'load');
    vi.spyOn(fsClient, 'exists').mockResolvedValue(false);
    vi.spyOn(fsClient, 'writeFile').mockRejectedValue(new Error('disk unavailable'));
    setCurrentProject({ rootPath: '/workspace/b', name: 'b', updatedAt: new Date() });

    await expect(tabActions.loadSession('/workspace/b')).rejects.toThrow('disk unavailable');

    expect(load).not.toHaveBeenCalled();
    expect(tabState.panes[0].tabs.map(tab => tab.id)).toEqual(['old-tab']);
    expect(getTabContent(oldTab.id)).toBe('unsaved old workspace content');
    expect(isTabDirty(oldTab.id)).toBe(true);
    expect(tabState.sessionError).toContain('disk unavailable');
  });

  it('keeps a failed session load from overwriting the saved session', async () => {
    const loadError = new Error('storage unavailable');
    const save = vi.spyOn(sessionStore, 'save').mockResolvedValue(undefined);
    vi.spyOn(sessionStore, 'load').mockRejectedValue(loadError);

    await tabActions.loadSession('/workspace/a');
    await tabActions.saveSession('/workspace/a');

    expect(tabState.isLoading).toBe(false);
    expect(tabState.isRestored).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(tabState.sessionError).toContain('storage unavailable');
  });

  it('reports a tab session persistence failure to the visible state', async () => {
    vi.spyOn(sessionStore, 'save').mockRejectedValue(new Error('storage unavailable'));
    tabState.panes = [
      {
        id: 'pane',
        tabs: [editorTab('clean-tab', '/workspace/a/main.ts')],
        activeTabId: 'clean-tab',
      },
    ];

    await expect(tabActions.saveSession('/workspace/a')).rejects.toThrow('storage unavailable');

    expect(tabState.sessionError).toContain('storage unavailable');
  });

  it('flushes dirty files after session load failure without saving an empty layout', async () => {
    vi.spyOn(sessionStore, 'load').mockRejectedValue(new Error('storage unavailable'));
    const saveSession = vi.spyOn(sessionStore, 'save').mockResolvedValue(undefined);
    const writeFile = vi.spyOn(fsClient, 'writeFile').mockResolvedValue(undefined);
    vi.spyOn(fsClient, 'exists').mockResolvedValue(false);

    await tabActions.loadSession('/workspace/a');
    tabState.panes = [
      { id: 'pane', tabs: [editorTab('new-tab', '/workspace/a/new.ts')], activeTabId: 'new-tab' },
    ];
    setTabContent('new-tab', 'draft after restore failure', true);

    await tabActions.saveSession('/workspace/a');

    expect(writeFile).toHaveBeenCalledWith('/workspace/a/new.ts', 'draft after restore failure');
    expect(saveSession).not.toHaveBeenCalled();
    expect(tabState.sessionError).toContain('storage unavailable');
  });

  it('saves the old root with the pane snapshot captured before a switch', async () => {
    const saveSession = vi.spyOn(sessionStore, 'save').mockResolvedValue(undefined);
    tabState.panes = [
      { id: 'pane', tabs: [editorTab('a-tab', '/workspace/a/main.ts')], activeTabId: 'a-tab' },
    ];
    tabState.activePane = 'pane';
    tabState.globalActiveTab = 'a-tab';

    const save = tabActions.saveSession('/workspace/a');
    setCurrentProject({ rootPath: '/workspace/b', name: 'b', updatedAt: new Date() });
    tabState.panes = [
      { id: 'pane', tabs: [editorTab('b-tab', '/workspace/b/main.ts')], activeTabId: 'b-tab' },
    ];
    tabState.globalActiveTab = 'b-tab';
    await save;

    expect(saveSession).toHaveBeenCalledWith(
      '/workspace/a',
      expect.objectContaining({
        tabs: expect.objectContaining({
          panes: [expect.objectContaining({ tabs: [expect.objectContaining({ id: 'a-tab' })] })],
          globalActiveTab: 'a-tab',
        }),
      })
    );
  });

  it('captures pane changes made while dirty files are flushing', async () => {
    const saveSession = vi.spyOn(sessionStore, 'save').mockResolvedValue(undefined);
    vi.spyOn(fsClient, 'exists').mockResolvedValue(false);
    let releaseWrite: () => void = () => {};
    let markWriteStarted: () => void = () => {};
    const writeStarted = new Promise<void>(resolve => {
      markWriteStarted = resolve;
    });
    const writeReleased = new Promise<void>(resolve => {
      releaseWrite = resolve;
    });
    vi.spyOn(fsClient, 'writeFile').mockImplementation(async () => {
      markWriteStarted();
      await writeReleased;
    });
    const firstTab = editorTab('first-tab', '/workspace/a/first.ts');
    tabState.panes = [{ id: 'pane', tabs: [firstTab], activeTabId: firstTab.id }];
    tabState.activePane = 'pane';
    tabState.globalActiveTab = firstTab.id;
    setTabContent(firstTab.id, 'dirty content', true);

    const saving = tabActions.saveSession('/workspace/a');
    await writeStarted;
    const secondTab = editorTab('second-tab', '/workspace/a/second.ts');
    tabState.panes = [
      {
        id: 'pane',
        tabs: [firstTab, secondTab],
        activeTabId: secondTab.id,
      },
    ];
    tabState.globalActiveTab = secondTab.id;
    releaseWrite();
    await saving;

    expect(saveSession).toHaveBeenCalledWith(
      '/workspace/a',
      expect.objectContaining({
        tabs: expect.objectContaining({
          panes: [expect.objectContaining({ tabs: expect.arrayContaining([secondTab]) })],
          globalActiveTab: secondTab.id,
        }),
      })
    );
  });
});
