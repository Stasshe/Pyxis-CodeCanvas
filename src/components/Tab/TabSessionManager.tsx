'use client';
import type React from 'react';
import { type ReactNode, useEffect, useState, useRef } from 'react';
import { useSnapshot, snapshot } from 'valtio';
import { subscribeKey } from 'valtio/utils';

import type { EditorPane, Tab } from '@/engine/tabs/types';
import { tabActions, tabState } from '@/stores/tabState';

/**
 * TabSessionManager
 * - セッションの初期化 / 自動保存
 * - コンテンツ復元完了イベントのリスナー登録
 *
 * 以前の `TabProvider` にあった副作用をここに移植しました。
 * これにより、コンテキストの公開（useTabContext）は廃止され、
 * タブ状態は `useSnapshot(tabState)` と `tabActions` を直接使用してください。
 */
interface Props {
  children?: ReactNode;
}

export const TabSessionManager: React.FC<Props> = ({ children }) => {
  const { loadSession, saveSession, setIsContentRestored } = tabActions;
  const isLoading = useSnapshot(tabState).isLoading;
  const activePane = useSnapshot(tabState).activePane;
  const globalActiveTab = useSnapshot(tabState).globalActiveTab;

  // IndexedDBからセッションを復元
  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // Track a structural key derived from panes without re-rendering on frequent content updates
  const computeStructuralKey = (panes: readonly EditorPane[]) => {
    type StrippedPane = {
      id: string;
      size?: number;
      layout?: string;
      activeTabId: string;
      tabs: Array<{ id: string; kind: string; path?: string; name?: string }>;
      children?: StrippedPane[];
    };

    const strip = (pList: readonly EditorPane[]): StrippedPane[] =>
      pList.map(p => ({
        id: p.id,
        size: p.size,
        layout: p.layout,
        activeTabId: p.activeTabId,
        tabs: p.tabs?.map((t: Tab) => ({ id: t.id, kind: t.kind, path: t.path, name: t.name })) || [],
        children: p.children ? strip(p.children) : undefined,
      }));

    try {
      return JSON.stringify(strip(panes));
    } catch (e) {
      try {
        return JSON.stringify(panes);
      } catch (_) {
        return String(panes);
      }
    }
  };

  const [structuralKey, setStructuralKey] = useState(() => computeStructuralKey(snapshot(tabState).panes));
  const structuralKeyRef = useRef(structuralKey);

  useEffect(() => {
    // Subscribe to panes updates but only update local state when the structural key actually changes
    const unsub = subscribeKey(tabState, 'panes', () => {
      const newKey = computeStructuralKey(snapshot(tabState).panes);
      if (newKey !== structuralKeyRef.current) {
        structuralKeyRef.current = newKey;
        setStructuralKey(newKey);
      }
    });
    return unsub;
  }, []);

  // コンテンツ復元完了イベントのリスナー
  useEffect(() => {
    const handleContentRestored = () => {
      console.log('[TabSessionManager] Content restoration completed');
      setIsContentRestored(true);
    };

    window.addEventListener('pyxis-content-restored', handleContentRestored);
    return () => window.removeEventListener('pyxis-content-restored', handleContentRestored);
  }, [setIsContentRestored]);



  useEffect(() => {
    if (isLoading) return; // 初期ロード中は保存しない

    const timer = setTimeout(() => {
      saveSession().catch(console.error);
    }, 1000);

    return () => clearTimeout(timer);
  }, [structuralKey, activePane, globalActiveTab, isLoading, saveSession]);

  return <>{children}</>;
};

export default TabSessionManager;
