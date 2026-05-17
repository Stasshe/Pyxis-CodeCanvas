import { toAppPath } from '@/engine/core/fileRepository';
import type { EditorPane, Tab } from '@/engine/tabs/types';

export function flattenLeafPanes(
  panes: readonly EditorPane[],
  result: EditorPane[] = []
): EditorPane[] {
  for (const p of panes) {
    if (!p.children || p.children.length === 0) {
      result.push(p);
    } else {
      flattenLeafPanes(p.children, result);
    }
  }
  return result;
}

export function collectPaneIds(
  panes: readonly EditorPane[],
  result = new Set<string>()
): Set<string> {
  for (const pane of panes) {
    result.add(pane.id);
    if (pane.children) collectPaneIds(pane.children, result);
  }
  return result;
}

export function createUniquePaneId(
  panes: readonly EditorPane[],
  reserved = new Set<string>()
): string {
  const ids = collectPaneIds(panes);
  for (const id of reserved) ids.add(id);
  let next = 1;
  while (ids.has(`pane-${next}`)) next++;
  return `pane-${next}`;
}

export function findFirstLeafPane(panes: readonly EditorPane[]): EditorPane | null {
  for (const pane of panes) {
    if (!pane.children?.length) return pane;
    const childLeaf = findFirstLeafPane(pane.children);
    if (childLeaf) return childLeaf;
  }
  return null;
}

export function toLeafPaneId(
  panes: readonly EditorPane[],
  paneId: string | null | undefined
): string | null {
  if (!paneId) return null;
  const pane = findPaneRecursive(panes, paneId);
  if (!pane) return null;
  if (!pane.children?.length) return pane.id;
  return findFirstLeafPane([pane])?.id ?? null;
}

export function resolveOpenTargetPaneId(
  panes: readonly EditorPane[],
  activePane: string | null,
  preferredPaneId?: string | null
): string | null {
  const preferred = toLeafPaneId(panes, preferredPaneId);
  if (preferred) return preferred;

  const active = toLeafPaneId(panes, activePane);
  if (active) return active;

  const leaves = flattenLeafPanes(panes);
  const leafWithActiveTab = leaves.find(pane =>
    pane.activeTabId ? pane.tabs.some(tab => tab.id === pane.activeTabId) : false
  );
  return leafWithActiveTab?.id ?? leaves[0]?.id ?? null;
}

export function withTabsInPane(tabs: readonly Tab[], paneId: string): Tab[] {
  return tabs.map(tab => (tab.paneId === paneId ? tab : ({ ...tab, paneId } as Tab)));
}

export function validActiveTabId(tabs: readonly Tab[], activeTabId: string): string {
  if (activeTabId && tabs.some(tab => tab.id === activeTabId)) return activeTabId;
  return tabs[0]?.id ?? '';
}

export function normalizeTabPath(p?: string): string {
  if (!p) return '';
  const withoutKindPrefix = p.includes(':') ? p.replace(/^[^:]+:/, '') : p;
  const cleaned = withoutKindPrefix.replace(/(-preview|-diff|-ai)$/, '');
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

export function findPaneRecursive(panes: readonly EditorPane[], paneId: string): EditorPane | null {
  for (const pane of panes) {
    if (pane.id === paneId) return pane;
    if (pane.children) {
      const found = findPaneRecursive(pane.children, paneId);
      if (found) return found;
    }
  }
  return null;
}

export function collectAllTabs(panes: readonly EditorPane[]): Tab[] {
  const tabs: Tab[] = [];
  for (const pane of panes) {
    tabs.push(...pane.tabs);
    if (pane.children) tabs.push(...collectAllTabs(pane.children));
  }
  return tabs;
}

export function findInPanes(
  panes: readonly EditorPane[],
  path: string,
  kind?: string
): { paneId: string; tab: Tab } | null {
  const normalizedPath = toAppPath(path);

  for (const pane of panes) {
    const tab = pane.tabs.find(t => {
      const samePath = toAppPath(t.path || '') === normalizedPath;
      const matchesKind = kind === undefined || t.kind === kind;
      return samePath && matchesKind;
    });
    if (tab) return { paneId: pane.id, tab };
    if (pane.children) {
      const found = findInPanes(pane.children, path, kind);
      if (found) return found;
    }
  }
  return null;
}
