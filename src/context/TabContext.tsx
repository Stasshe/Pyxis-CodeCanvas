// src/context/TabContext.tsx
'use client';
import type React from 'react';
import { type ReactNode, useEffect, useMemo } from 'react';
import { useSnapshot } from 'valtio';

import { tabActions, tabState } from '@/stores/tabState';

/**
 * TabProvider
 * TabStoreの初期化とセッション管理のみを担当
 *
 * @deprecated useTabContext は削除されました。useSnapshot(tabState) と tabActions を直接使用してください。
 */
interface TabProviderProps {
  children: ReactNode;
}

export const TabProvider: React.FC<TabProviderProps> = ({ children }) => {
  const { loadSession, saveSession, setIsContentRestored } = tabActions;
  const { isLoading, panes, activePane, globalActiveTab } = useSnapshot(tabState);

  // IndexedDBからセッションを復元
  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // コンテンツ復元完了イベントのリスナー
  useEffect(() => {
    const handleContentRestored = () => {
      console.log('[TabProvider] Content restoration completed');
      setIsContentRestored(true);
    };

    window.addEventListener('pyxis-content-restored', handleContentRestored);
    return () => {
      window.removeEventListener('pyxis-content-restored', handleContentRestored);
    };
  }, [setIsContentRestored]);

  // TabStore の変更を監視して自動保存
  // panes は大きな構造で中に content が含まれるため、
  // コンテンツ変更（頻繁）による再レンダーで自動保存が走らないよう、
  // 保存トリガーは「構造情報（id/size/children/tabs のメタ情報）」のみを監視する。
  // 派生: panes の「構造情報」を JSON にしてキー化する。
  // これにより content のみの変更では文字列が変わらず、自動保存が発火しない。
  const structuralKey = useMemo(() => {
    const strip = (pList: any[]): any[] =>
      pList.map(p => ({
        id: p.id,
        size: p.size,
        layout: p.layout,
        activeTabId: p.activeTabId,
        tabs:
          p.tabs?.map((t: any) => ({ id: t.id, kind: t.kind, path: t.path, name: t.name })) || [],
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

/**
 * @deprecated useTabContext は削除されました。
 * useSnapshot(tabState) と tabActions を直接使用してください。
 */
export const useTabContext = () => {
  console.warn('[useTabContext] This hook is deprecated. Use useSnapshot(tabState) and tabActions.');
  return { ...useSnapshot(tabState), ...tabActions };
};
