import { snapshot } from 'valtio';

import type { EditorPane } from '@/engine/tabs/types';
import { pushLogMessage } from '@/stores/loggerStore';
import { getCurrentRootPath } from '@/stores/projectStore';
import { clearTabContent } from '@/stores/tabContentStore';
import { flushDirtyTabFiles } from './contentSync';
import { collectAllTabs } from './paneUtils';
import { tabState } from './state';

function hasTabs(panes: readonly EditorPane[]): boolean {
  for (const pane of panes) {
    if (pane.tabs.length > 0) return true;
    if (pane.children && hasTabs(pane.children)) return true;
  }
  return false;
}

function reportSessionError(rootPath: string | null, message: string): void {
  if (rootPath === getCurrentRootPath()) tabState.sessionError = message;
  pushLogMessage(message, 'error', 'Tab Session');
}

export async function saveTabSession(
  rootPath: string | null = getCurrentRootPath()
): Promise<void> {
  if (!rootPath || rootPath !== getCurrentRootPath()) return;

  const initialSession = tabState.isRestored
    ? {
        panes: snapshot(tabState.panes) as EditorPane[],
        activePane: tabState.activePane,
        globalActiveTab: tabState.globalActiveTab,
      }
    : null;
  try {
    await flushDirtyTabFiles();
  } catch (error) {
    const message = `Could not save dirty files for ${rootPath}: ${String(error)}`;
    reportSessionError(rootPath, message);
    throw error;
  }
  if (!initialSession) return;
  let session = initialSession;
  if (rootPath === getCurrentRootPath() && tabState.isRestored) {
    session = {
      panes: snapshot(tabState.panes) as EditorPane[],
      activePane: tabState.activePane,
      globalActiveTab: tabState.globalActiveTab,
    };
  }
  try {
    const { sessionStore, DEFAULT_SESSION } = await import('@/stores/sessionStore');
    await sessionStore.save(rootPath, {
      version: 1,
      lastSaved: Date.now(),
      tabs: {
        panes: session.panes,
        activePane: session.activePane,
        globalActiveTab: session.globalActiveTab,
      },
      ui: DEFAULT_SESSION.ui,
    });
    if (rootPath === getCurrentRootPath()) tabState.sessionError = null;
  } catch (error) {
    const message = `Could not save tab session for ${rootPath}: ${String(error)}`;
    reportSessionError(rootPath, message);
    throw error;
  }
}

export async function loadTabSession(
  rootPath: string | null = getCurrentRootPath()
): Promise<void> {
  if (rootPath !== getCurrentRootPath()) return;
  try {
    await flushDirtyTabFiles();
  } catch (error) {
    const message = `Could not save dirty files before loading tabs for ${rootPath ?? 'no workspace'}: ${String(error)}`;
    reportSessionError(rootPath, message);
    throw error;
  }
  if (rootPath !== getCurrentRootPath()) return;

  const generation = tabState.sessionGeneration + 1;
  tabState.sessionGeneration = generation;
  tabState.sessionRootPath = rootPath;
  tabState.isLoading = true;
  tabState.isRestored = false;
  tabState.isContentRestored = false;
  for (const tab of collectAllTabs(tabState.panes)) clearTabContent(tab.id);
  tabState.panes = [];
  tabState.activePane = null;
  tabState.globalActiveTab = null;

  if (!rootPath) {
    tabState.panes = [{ id: 'pane-1', tabs: [], activeTabId: '' }];
    tabState.activePane = 'pane-1';
    tabState.isLoading = false;
    tabState.isRestored = true;
    tabState.isContentRestored = true;
    tabState.sessionError = null;
    return;
  }

  let sessionLoaded = false;
  try {
    const { sessionStore } = await import('@/stores/sessionStore');
    const session = await sessionStore.load(rootPath);
    if (generation !== tabState.sessionGeneration || getCurrentRootPath() !== rootPath) return;

    tabState.sessionError = null;
    tabState.panes = session.tabs.panes;
    tabState.activePane = session.tabs.activePane;
    tabState.globalActiveTab = session.tabs.globalActiveTab;
    if (!hasTabs(session.tabs.panes)) tabState.isContentRestored = true;
    sessionLoaded = true;
  } catch (error) {
    if (generation !== tabState.sessionGeneration || getCurrentRootPath() !== rootPath) return;
    console.error('[tabState] loadSession failed:', error);
    tabState.isContentRestored = true;
    reportSessionError(rootPath, `Failed to load saved tabs for ${rootPath}: ${String(error)}`);
  } finally {
    if (generation === tabState.sessionGeneration && getCurrentRootPath() === rootPath) {
      tabState.isLoading = false;
      tabState.isRestored = sessionLoaded;
    }
  }
}
