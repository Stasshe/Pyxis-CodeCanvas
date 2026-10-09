import { normalizePath } from '@/engine/core/fs';
import { tabRegistry } from '@/engine/tabs/TabRegistry';
import type { EditorPane, Tab } from '@/engine/tabs/types';
import { clearTabContent, isTabDirty } from '@/stores/tabContentStore';
import { notifyTabClosed } from './closeCallbacks';
import { removeSaveTimerForPath } from './contentSync';
import { collectAllTabs, findFirstLeafPane } from './paneUtils';
import { tabState } from './state';

export function removePane(paneId: string): boolean {
  const currentPanes = tabState.panes.filter(Boolean) as EditorPane[];
  const removedTabs: Tab[] = [];

  const findAndCollect = (panes: readonly EditorPane[]): boolean => {
    for (const pane of panes) {
      if (!pane) continue;
      if (pane.id === paneId) {
        const collect = (node: EditorPane) => {
          removedTabs.push(...(node.tabs ?? []));
          if (node.children) for (const child of node.children) collect(child);
        };
        collect(pane);
        return true;
      }
      if (pane.children && findAndCollect(pane.children)) return true;
    }
    return false;
  };

  findAndCollect(currentPanes);
  if (
    removedTabs.some(
      tab =>
        tab.isDirty || isTabDirty(tab.id) || tabRegistry.get(tab.kind)?.hasPendingChanges?.(tab)
    )
  )
    return false;

  const allTabs = collectAllTabs(currentPanes);
  const removedIds = new Set(removedTabs.map(tab => tab.id));
  for (const tab of removedTabs) {
    const path = tabRegistry.get(tab.kind)?.getContentPath?.(tab) ?? tab.path;
    if (path && (tab.kind === 'editor' || tab.kind === 'diff' || tab.kind === 'ai')) {
      const retainedTab = allTabs.some(other => {
        if (removedIds.has(other.id)) return false;
        if (other.kind !== 'editor' && other.kind !== 'diff' && other.kind !== 'ai') return false;
        const otherPath = tabRegistry.get(other.kind)?.getContentPath?.(other) ?? other.path;
        return otherPath && normalizePath(otherPath) === normalizePath(path);
      });
      if (!retainedTab) removeSaveTimerForPath(path);
    }
    clearTabContent(tab.id);
  }

  if (tabState.globalActiveTab && removedTabs.some(tab => tab.id === tabState.globalActiveTab)) {
    tabState.globalActiveTab = null;
  }

  const rootFiltered = currentPanes.filter(pane => pane.id !== paneId);
  if (rootFiltered.length !== currentPanes.length) {
    tabState.panes = rootFiltered.map(pane => ({ ...pane, size: 100 / rootFiltered.length }));
  } else {
    const removeRecursive = (pane: EditorPane): EditorPane | null => {
      if (!pane.children) return pane;
      const children = pane.children
        .map(child => (child.id === paneId ? null : removeRecursive(child)))
        .filter((child): child is EditorPane => child !== null);
      if (children.length === 1) return { ...children[0], size: pane.size };
      if (children.length > 1) {
        const size = 100 / children.length;
        return { ...pane, children: children.map(child => ({ ...child, size })) };
      }
      return { ...pane, children };
    };

    const sanitize = (panes: readonly EditorPane[]): EditorPane[] =>
      panes.map(pane => {
        const children = pane.children ? sanitize(pane.children) : undefined;
        return {
          ...pane,
          children: children?.length
            ? children.map(child => ({ ...child, parentId: pane.id }))
            : children,
        };
      });

    tabState.panes = sanitize(
      currentPanes.map(removeRecursive).filter((pane): pane is EditorPane => pane !== null)
    );
  }

  if (tabState.activePane === paneId) {
    const leaf = findFirstLeafPane(tabState.panes);
    tabState.activePane = leaf?.id ?? null;
    tabState.globalActiveTab = leaf?.activeTabId || null;
  }
  for (const tab of removedTabs) notifyTabClosed(tab);
  return true;
}
