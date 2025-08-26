// src/hooks/pane.ts
// ペイン・タブ系のロジックを分離
import type { Tab, EditorPane, EditorLayoutType, MenuTab } from '@/types';
import type { Dispatch, SetStateAction } from 'react';

export function addEditorPane(editors: EditorPane[], setEditors: Dispatch<SetStateAction<EditorPane[]>>, parentId?: string, layout: EditorLayoutType = 'vertical') {
  // 既存ID一覧を取得
  const existingIds = getAllPaneIds(editors);
  let nextNum = 1;
  while (existingIds.includes(`editor-${nextNum}`)) {
    nextNum++;
  }
  const newId = `editor-${nextNum}`;
  
  if (parentId) {
    // 親ペイン内に子ペインとして追加
    setEditors(prev => {
      return prev.map(pane => updatePaneRecursive(pane, parentId, (targetPane) => ({
        ...targetPane,
        layout,
        children: [
          ...(targetPane.children || []),
          { 
            id: newId, 
            tabs: [], // 空のタブ配列で初期化
            activeTabId: '', // 空のアクティブタブIDで初期化
            parentId,
            size: 50 // デフォルトは50%
          }
        ]
      })));
    });
  } else {
    // ルートレベルに追加
    const newPane: EditorPane = { 
      id: newId, 
      tabs: [], // 空のタブ配列で初期化
      activeTabId: '', // 空のアクティブタブIDで初期化
      size: 100 / (editors.length + 1) // 均等分割
    };
    
    // 既存ペインのサイズを調整
    setEditors(prev => {
      const totalPanes = prev.length + 1;
      const newSize = 100 / totalPanes;
      return [
        ...prev.map(pane => ({ ...pane, size: newSize })),
        newPane
      ];
    });
  }
}

export function removeEditorPane(editors: EditorPane[], setEditors: Dispatch<SetStateAction<EditorPane[]>>, id: string) {
  if (editors.length === 1 && !hasChildPanes(editors)) return; // 最低1ペインは残す

  setEditors(prev => {
    // ルートレベルから削除
    let filtered = prev.filter(e => e.id !== id);
    if (filtered.length !== prev.length) {
      // ルートレベルで削除された場合、残りペインのサイズを調整
      const newSize = 100 / filtered.length;
      filtered = filtered.map(pane => ({ ...pane, size: newSize }));
      return filtered;
    }

    // 子ペインから削除
    const updated = prev.map(pane => removePaneRecursive(pane, id));
    // 兄弟ペインのsizeを均等割り
    const total = updated.length;
    if (total > 0) {
      const newSize = 100 / total;
      return updated.map(pane => ({ ...pane, size: newSize }));
    }
    return updated;
  });
}

export function splitPane(editors: EditorPane[], setEditors: Dispatch<SetStateAction<EditorPane[]>>, paneId: string, direction: EditorLayoutType) {
  const existingIds = getAllPaneIds(editors);
  let nextNum = 1;
  while (existingIds.includes(`editor-${nextNum}`)) {
    nextNum++;
  }
  const newId = `editor-${nextNum}`;
  
  setEditors(prev => {
    return prev.map(pane => updatePaneRecursive(pane, paneId, (targetPane) => {
      // 既存の子ペインのIDを生成
      const existingPaneId = `editor-${nextNum + 1}`;
      
      return {
        ...targetPane,
        layout: direction,
        children: [
          { 
            id: existingPaneId, // 新しいIDを割り当て
            tabs: targetPane.tabs?.map(tab => ({
              ...tab,
              id: tab.id.replace(targetPane.id, existingPaneId) // タブIDも更新
            })) || [], 
            activeTabId: targetPane.activeTabId ? targetPane.activeTabId.replace(targetPane.id, existingPaneId) : '', // アクティブタブIDも更新
            parentId: paneId,
            size: 50
          },
          { 
            id: newId, 
            tabs: [], 
            activeTabId: '',
            parentId: paneId,
            size: 50 
          }
        ],
        tabs: [], // 親ペインはタブを持たない
        activeTabId: ''
      };
    }));
  });
}

export function toggleEditorLayout(editorLayout: EditorLayoutType, setEditorLayout: Dispatch<SetStateAction<EditorLayoutType>>) {
  setEditorLayout(l => l === 'vertical' ? 'horizontal' : 'vertical');
}

export function resizePane(editors: EditorPane[], setEditors: Dispatch<SetStateAction<EditorPane[]>>, paneId: string, newSize: number) {
  setEditors(prev => {
    return prev.map(pane => updatePaneRecursive(pane, paneId, (targetPane) => ({
      ...targetPane,
      size: newSize
    })));
  });
}

export function setTabsForPane(editors: EditorPane[], setEditors: Dispatch<SetStateAction<EditorPane[]>>, paneIdx: number, update: Tab[] | ((tabs: Tab[]) => Tab[])) {
  setEditors((prev: EditorPane[]) => {
    // フラット化してインデックスを取得
    const flatPanes = flattenPanes(prev);
    if (paneIdx < 0 || paneIdx >= flatPanes.length) return prev;
    
    const targetPane = flatPanes[paneIdx];
    const newTabs = typeof update === 'function' ? update(targetPane.tabs || []) : update;
    
    // IDベースでペインを更新
    return updatePaneRecursiveInEditors(prev, targetPane.id, (pane) => ({
      ...pane,
      tabs: newTabs
    }));
  });
}

export function setActiveTabIdForPane(editors: EditorPane[], setEditors: Dispatch<SetStateAction<EditorPane[]>>, paneIdx: number, id: string) {
  setEditors((prev: EditorPane[]) => {
    // フラット化してインデックスを取得
    const flatPanes = flattenPanes(prev);
    if (paneIdx < 0 || paneIdx >= flatPanes.length) return prev;
    
    const targetPane = flatPanes[paneIdx];
    
    // IDベースでペインを更新
    return updatePaneRecursiveInEditors(prev, targetPane.id, (pane) => ({
      ...pane,
      activeTabId: id
    }));
  });
}

// 新しいヘルパー関数：エディタ配列全体でペインを更新
function updatePaneRecursiveInEditors(editors: EditorPane[], targetId: string, updater: (pane: EditorPane) => EditorPane): EditorPane[] {
  return editors.map(editor => updatePaneRecursive(editor, targetId, updater));
}

// ペインをフラット化する関数（外部から使用可能）
export function flattenPanes(panes: EditorPane[]): EditorPane[] {
  const result: EditorPane[] = [];
  
  const traverse = (panes: EditorPane[]) => {
    panes.forEach(pane => {
      if (pane.children && pane.children.length > 0) {
        traverse(pane.children);
      } else {
        result.push(pane);
      }
    });
  };
  
  traverse(panes);
  return result;
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

// ヘルパー関数
function getAllPaneIds(editors: EditorPane[]): string[] {
  const ids: string[] = [];
  const traverse = (panes: EditorPane[]) => {
    panes.forEach(pane => {
      ids.push(pane.id);
      if (pane.children) {
        traverse(pane.children);
      }
    });
  };
  traverse(editors);
  return ids;
}

function hasChildPanes(editors: EditorPane[]): boolean {
  return editors.some(pane => pane.children && pane.children.length > 0);
}

function updatePaneRecursive(pane: EditorPane, targetId: string, updater: (pane: EditorPane) => EditorPane): EditorPane {
  if (pane.id === targetId) {
    return updater(pane);
  }
  
  if (pane.children) {
    return {
      ...pane,
      children: pane.children.map(child => updatePaneRecursive(child, targetId, updater))
    };
  }
  
  return pane;
}

function removePaneRecursive(pane: EditorPane, targetId: string): EditorPane {
  if (pane.children) {
    // 再帰的に子ペインを探索し、targetIdを削除
    const updatedChildren = pane.children
      .map(child => child.id === targetId ? null : removePaneRecursive(child, targetId))
      .filter(Boolean) as EditorPane[];

    // 子ペインが1つだけ残った場合、その子を現在のペインに昇格
    if (updatedChildren.length === 1) {
      const remainingChild = updatedChildren[0];
      // 親ペインのsizeを維持
      return {
        ...remainingChild,
        size: pane.size
      };
    }

    // サイズを再調整
    if (updatedChildren.length > 0) {
      const newSize = 100 / updatedChildren.length;
      return {
        ...pane,
        children: updatedChildren.map(child => ({ ...child, size: newSize }))
      };
    }

    return { ...pane, children: updatedChildren };
  }
  return pane;
}