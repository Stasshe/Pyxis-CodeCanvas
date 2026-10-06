import { snapshot } from 'valtio';

import type { EditorPane } from '@/engine/tabs/types';
import { getCurrentRootPath } from '@/stores/projectStore';
import { tabState } from './state';

let loadGeneration = 0;

function hasTabs(panes: readonly EditorPane[]): boolean {
  for (const pane of panes) {
    if (pane.tabs.length > 0) return true;
    if (pane.children && hasTabs(pane.children)) return true;
  }
  return false;
}

export async function saveTabSession(
  rootPath: string | null = getCurrentRootPath()
): Promise<void> {
  if (!rootPath || rootPath !== getCurrentRootPath()) return;

  const sessionPanes = snapshot(tabState.panes) as EditorPane[];
  const activePane = tabState.activePane;
  const globalActiveTab = tabState.globalActiveTab;
  const { sessionStore, DEFAULT_SESSION } = await import('@/stores/sessionStore');
  await sessionStore.save(rootPath, {
    version: 1,
    lastSaved: Date.now(),
    tabs: { panes: sessionPanes, activePane, globalActiveTab },
    ui: DEFAULT_SESSION.ui,
  });
}

export async function loadTabSession(
  rootPath: string | null = getCurrentRootPath()
): Promise<void> {
  if (rootPath !== getCurrentRootPath()) return;
  const generation = ++loadGeneration;
  tabState.isLoading = true;
  tabState.isRestored = false;
  tabState.isContentRestored = false;
  tabState.panes = [];
  tabState.activePane = null;
  tabState.globalActiveTab = null;

  if (!rootPath) {
    tabState.panes = [{ id: 'pane-1', tabs: [], activeTabId: '' }];
    tabState.activePane = 'pane-1';
    tabState.isLoading = false;
    tabState.isRestored = true;
    tabState.isContentRestored = true;
    return;
  }

  try {
    const { sessionStore } = await import('@/stores/sessionStore');
    const session = await sessionStore.load(rootPath);
    if (generation !== loadGeneration || getCurrentRootPath() !== rootPath) return;

    tabState.panes = session.tabs.panes;
    tabState.activePane = session.tabs.activePane;
    tabState.globalActiveTab = session.tabs.globalActiveTab;
    if (!hasTabs(session.tabs.panes)) tabState.isContentRestored = true;
  } catch (error) {
    if (generation !== loadGeneration || getCurrentRootPath() !== rootPath) return;
    console.error('[tabState] loadSession failed:', error);
    tabState.isContentRestored = true;
  } finally {
    if (generation === loadGeneration && getCurrentRootPath() === rootPath) {
      tabState.isLoading = false;
      tabState.isRestored = true;
    }
  }
}
