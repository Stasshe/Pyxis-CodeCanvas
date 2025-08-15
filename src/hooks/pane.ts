// src/hooks/pane.ts
// ペイン・タブ系のロジックを分離
import type { Tab, EditorPane, EditorLayoutType, MenuTab } from '@/types';
import type { Dispatch, SetStateAction } from 'react';

export function addEditorPane(editors: EditorPane[], setEditors: Dispatch<SetStateAction<EditorPane[]>>) {
  // 既存ID一覧を取得
  const existingIds = editors.map(e => e.id);
  let nextNum = 1;
  while (existingIds.includes(`editor-${nextNum}`)) {
    nextNum++;
  }
  const newId = `editor-${nextNum}`;
  setEditors(prev => [...prev, { id: newId, tabs: [], activeTabId: '' }]);
}

export function removeEditorPane(editors: EditorPane[], setEditors: Dispatch<SetStateAction<EditorPane[]>>, id: string) {
  if (editors.length === 1) return; // 最低1ペインは残す
  setEditors(prev => prev.filter(e => e.id !== id));
}

export function toggleEditorLayout(editorLayout: EditorLayoutType, setEditorLayout: Dispatch<SetStateAction<EditorLayoutType>>) {
  setEditorLayout(l => l === 'vertical' ? 'horizontal' : 'vertical');
}

export function setTabsForPane(editors: EditorPane[], setEditors: Dispatch<SetStateAction<EditorPane[]>>, paneIdx: number, update: Tab[] | ((tabs: Tab[]) => Tab[])) {
  setEditors((prev: EditorPane[]) => {
    const updated = [...prev];
    const newTabs = typeof update === 'function' ? update(updated[paneIdx].tabs) : update;
    updated[paneIdx] = { ...updated[paneIdx], tabs: newTabs };
    return updated;
  });
}

export function setActiveTabIdForPane(editors: EditorPane[], setEditors: Dispatch<SetStateAction<EditorPane[]>>, paneIdx: number, id: string) {
  setEditors((prev: EditorPane[]) => {
    const updated = [...prev];
    updated[paneIdx] = { ...updated[paneIdx], activeTabId: id };
    return updated;
  });
}

export function handleMenuTabClick(
  activeMenuTab: MenuTab,
  setActiveMenuTab: (tab: MenuTab) => void,
  isLeftSidebarVisible: boolean,
  setIsLeftSidebarVisible: (visible: boolean) => void,
  tab: MenuTab
) {
  if (activeMenuTab === tab && isLeftSidebarVisible) {
    setIsLeftSidebarVisible(false);
  } else {
    setActiveMenuTab(tab);
    setIsLeftSidebarVisible(true);
  }
}
