'use client';
import type React from 'react';
import { type ReactNode, useEffect, useMemo } from 'react';
import { useSnapshot } from 'valtio';

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
  const { isLoading, panes, activePane, globalActiveTab } = useSnapshot(tabState);

  // IndexedDBからセッションを復元
  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // コンテンツ復元完了イベントのリスナー
  useEffect(() => {
    const handleContentRestored = () => {
      console.log('[TabSessionManager] Content restoration completed');
      setIsContentRestored(true);
    };

    window.addEventListener('pyxis-content-restored', handleContentRestored);
    return () => window.removeEventListener('pyxis-content-restored', handleContentRestored);
  }, [setIsContentRestored]);

  // Tab 構造の変化のみを監視してセッションを保存 （content の頻繁な変化は無視）
  const structuralKey = useMemo(() => {
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
        tabs:
          p.tabs?.map((t: Tab) => ({ id: t.id, kind: t.kind, path: t.path, name: t.name })) || [],
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
  }, [panes]);

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
