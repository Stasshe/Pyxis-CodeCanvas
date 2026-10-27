/**
 * Restores content for tabs in each loaded project session.
 *
 * Uses each tab type's restoreContent method when available. File-backed tabs
 * are restored through the filesystem client. Live file synchronization is
 * owned by tabState.
 */

import { useCallback, useEffect, useRef } from 'react';
import { snapshot, useSnapshot } from 'valtio';

import { readFileContent } from '@/engine/core/fileContent';
import { fsClient } from '@/engine/core/fs/index';
import { tabRegistry } from '@/engine/ide/tabs/TabRegistry';
import type { SessionRestoreContext, Tab } from '@/engine/ide/tabs/types';
import { pushLogMessage } from '@/stores/loggerStore';
import { getCurrentRootPath, projectState } from '@/stores/projectStore';
import { isTabDirty, setBufferContent, setTabContent } from '@/stores/tabContentStore';
import { initTabSaveSync, tabActions, tabState } from '@/stores/tabState';
import type { EditorPane } from '@/types/index';

// Collect leaf panes recursively.
function flattenPanes(panes: readonly EditorPane[]): EditorPane[] {
  const result: EditorPane[] = [];
  function traverse(panes: readonly EditorPane[]) {
    for (const pane of panes) {
      if (pane.children && pane.children.length > 0) {
        traverse(pane.children);
      } else {
        result.push(pane);
      }
    }
  }
  traverse(panes);
  return result;
}

// File-backed tabs store their canonical filesystem path directly.
function extractFilePathFromTab(p?: string): string {
  if (!p) return '';
  return p.startsWith('/') ? p : `/${p}`;
}

function reportRestoreFailure(path: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  pushLogMessage(`Failed to restore ${path}: ${reason}`, 'error', 'Tab Session');
}

/**
 * Restore file-backed tab content when the tab type has no restoreContent handler.
 */
async function defaultFileRestore(
  tab: Tab & { needsContentRestore?: boolean },
  context: SessionRestoreContext
): Promise<Tab> {
  if (tab.kind !== 'editor' && tab.kind !== 'preview' && tab.kind !== 'binary') {
    return { ...tab, needsContentRestore: false };
  }
  const filePath = extractFilePathFromTab(tab.path);
  if (!filePath) {
    reportRestoreFailure(tab.name, new Error('Tab has no file path'));
    return { ...tab, needsContentRestore: true };
  }

  const file = await context.getFileByPath(filePath);

  if (!file) {
    reportRestoreFailure(filePath, new Error('File does not exist'));
    return { ...tab, needsContentRestore: true };
  }

  if (file.bufferContent !== undefined) {
    return {
      ...tab,
      kind: 'binary',
      content: '',
      bufferContent: file.bufferContent,
      mimeType: file.mimeType,
      needsContentRestore: false,
    };
  }

  console.log('[useTabContentRestore] ✓ Restored (default):', filePath);

  if (tab.kind === 'preview') {
    return { ...tab, kind: 'preview', content: file.content ?? '', needsContentRestore: false };
  }
  return {
    ...tab,
    kind: 'editor',
    content: file.content ?? '',
    isDirty: false,
    needsContentRestore: false,
  };
}

export function useTabContentRestore(isRestored: boolean) {
  const { panes, isLoading, sessionGeneration, sessionRootPath } = useSnapshot(tabState);
  const { currentRootPath } = useSnapshot(projectState);
  const restoreSession = useRef<{
    generation: number;
    completed: boolean;
    inProgress: boolean;
  } | null>(null);

  // Restore each loaded session once.
  const performContentRestoration = useCallback(async () => {
    if (restoreSession.current?.generation !== sessionGeneration) {
      restoreSession.current = {
        generation: sessionGeneration,
        completed: false,
        inProgress: false,
      };
    }
    const activeRestoreSession = restoreSession.current;
    if (
      !activeRestoreSession ||
      activeRestoreSession.completed ||
      activeRestoreSession.inProgress
    ) {
      return;
    }

    if (
      !isRestored ||
      isLoading ||
      sessionRootPath !== currentRootPath ||
      panes.length === 0 ||
      !currentRootPath
    ) {
      return;
    }

    const generation = sessionGeneration;
    const rootPath = currentRootPath;
    const isCurrentRestore = () =>
      tabState.sessionGeneration === generation &&
      tabState.sessionRootPath === rootPath &&
      getCurrentRootPath() === rootPath;

    const flatPanes = flattenPanes(panes);
    const tabsNeedingRestore = flatPanes.flatMap(pane =>
      pane.tabs.filter(tab => tab.needsContentRestore)
    );

    // Mark sessions without pending tabs as restored.
    if (tabsNeedingRestore.length === 0) {
      activeRestoreSession.completed = true;
      tabActions.setIsContentRestored(true);
      console.log('[useTabContentRestore] No tabs need restoration, marking as completed');
      return;
    }

    activeRestoreSession.inProgress = true;
    console.log(
      '[useTabContentRestore] Starting content restoration for',
      tabsNeedingRestore.length,
      'tabs'
    );

    // Restore asynchronously so editor state can synchronize after session loading.
    requestAnimationFrame(async () => {
      try {
        await initTabSaveSync();
        if (!isCurrentRestore()) return;

        // Prepare the restore context.
        const context: SessionRestoreContext = {
          rootPath,
          getFileByPath: async (path: string) => {
            if (!(await fsClient.exists(path))) return null;
            const file = await readFileContent(path);
            if (file.kind === 'binary')
              return { bufferContent: file.bufferContent, mimeType: file.mimeType };
            return { content: file.content };
          },
        };

        // Restore all tabs asynchronously.
        const currentPanes = snapshot(tabState).panes;

        const restoreTabAsync = async (
          tab: Tab & { needsContentRestore?: boolean }
        ): Promise<Tab> => {
          if (!tab.needsContentRestore) return tab;

          const tabDef = tabRegistry.get(tab.kind);

          try {
            // Use the tab type's restoreContent handler when available.
            if (tabDef?.restoreContent) {
              const restored = await tabDef.restoreContent(tab, context);
              console.log(
                '[useTabContentRestore] ✓ Restored (custom):',
                tab.kind,
                tab.path || tab.name
              );
              return { ...restored, needsContentRestore: false };
            }

            // Preserve tab types that do not require session restoration.
            if (tabDef?.needsSessionRestore === false) {
              return { ...tab, needsContentRestore: false };
            }

            // Extension tab data is already serialized, even if its type is not registered yet.
            if (tab.kind.startsWith('extension:') && !tabDef) {
              console.log(
                '[useTabContentRestore] Extension tab type not registered yet, preserving data:',
                tab.kind
              );
              return { ...tab, needsContentRestore: false };
            }

            // Default: restore file content through the filesystem client.
            return await defaultFileRestore(tab, context);
          } catch (error) {
            console.error(
              '[useTabContentRestore] Failed to restore tab:',
              tab.kind,
              tab.path,
              error
            );
            reportRestoreFailure(tab.path || tab.name, error);
            return { ...tab, needsContentRestore: true };
          }
        };

        const updatePaneRecursive = async (
          paneList: readonly EditorPane[]
        ): Promise<EditorPane[]> => {
          const results: EditorPane[] = [];

          for (const pane of paneList) {
            if (pane.children && pane.children.length > 0) {
              results.push({
                ...pane,
                children: await updatePaneRecursive(pane.children),
              });
            } else {
              const restoredTabs = await Promise.all(
                pane.tabs.map(tab =>
                  restoreTabAsync(tab as Tab & { needsContentRestore?: boolean })
                )
              );
              results.push({
                ...pane,
                tabs: restoredTabs,
              });
            }
          }

          return results;
        };

        const loadedPanes = await updatePaneRecursive(currentPanes);
        if (!isCurrentRestore()) return;
        const restoredById = new Map(
          flattenPanes(loadedPanes)
            .flatMap(pane => pane.tabs)
            .map(tab => [tab.id, tab])
        );
        const mergeCurrentPanes = (current: readonly EditorPane[]): EditorPane[] =>
          current.map(pane => {
            if (pane.children) return { ...pane, children: mergeCurrentPanes(pane.children) };
            return {
              ...pane,
              tabs: pane.tabs.map(tab => {
                if (tab.isDirty || isTabDirty(tab.id)) return tab;
                return restoredById.get(tab.id) ?? tab;
              }),
            };
          });
        const restoredPanes = mergeCurrentPanes(snapshot(tabState).panes);
        tabActions.setPanes(restoredPanes);

        // Populate tabContentStore from restored tab.content so components
        // don't need tab.content as a fallback
        for (const pane of flattenPanes(restoredPanes)) {
          for (const tab of pane.tabs) {
            if (tab.needsContentRestore || isTabDirty(tab.id)) continue;
            if ('content' in tab && typeof tab.content === 'string') {
              setTabContent(tab.id, tab.content, tab.isDirty ?? false);
            }
            if (
              'bufferContent' in tab &&
              tab.kind === 'binary' &&
              tab.bufferContent instanceof ArrayBuffer
            ) {
              setBufferContent(tab.id, tab.bufferContent);
            }
          }
        }

        // Mark the session restored.
        activeRestoreSession.completed = true;
        activeRestoreSession.inProgress = false;
        tabActions.setIsContentRestored(true);
        console.log('[useTabContentRestore] Content restoration completed successfully');

        // Refresh Monaco after its restored content has rendered.
        setTimeout(() => {
          if (!isCurrentRestore()) return;
          window.dispatchEvent(new CustomEvent('pyxis-force-monaco-refresh'));
        }, 100);
      } catch (error) {
        if (!isCurrentRestore()) return;
        console.error('[useTabContentRestore] Restoration failed:', error);
        reportRestoreFailure(rootPath, error);
        activeRestoreSession.inProgress = false;
        // Mark failed restoration complete to avoid retrying indefinitely.
        activeRestoreSession.completed = true;
        tabActions.setIsContentRestored(true);
      }
    });
  }, [isRestored, isLoading, panes, currentRootPath, sessionGeneration, sessionRootPath]);

  // Restore content after the session has loaded.
  useEffect(() => {
    performContentRestoration();
  }, [performContentRestoration]);

  // File changes and live synchronization are handled by initTabSaveSync.
}
