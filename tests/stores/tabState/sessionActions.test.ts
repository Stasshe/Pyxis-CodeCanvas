import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EditorTab } from '@/engine/tabs/types';
import { setCurrentProject } from '@/stores/projectStore';
import { type PyxisSession, sessionStore } from '@/stores/sessionStore';
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
    setCurrentProject({ rootPath: '/workspace/a', name: 'a', updatedAt: new Date() });
  });

  it('keeps an empty pane available when no workspace is open', async () => {
    setCurrentProject(null);

    await tabActions.loadSession(null);

    expect(tabState.panes).toEqual([{ id: 'pane-1', tabs: [], activeTabId: '' }]);
    expect(tabState.activePane).toBe('pane-1');
    expect(tabState.isRestored).toBe(true);
    expect(tabState.isContentRestored).toBe(true);
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
});
