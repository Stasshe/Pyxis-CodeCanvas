// src/context/TabContext.tsx
'use client';
import React, { useEffect, ReactNode } from 'react';
import { useTabStore } from '@/stores/tabStore';

/**
 * TabProvider
 * TabStoreの初期化とセッション管理のみを担当
 *
 * @deprecated useTabContext は削除されました。直接 useTabStore を使用してください。
 */
interface TabProviderProps {
  children: ReactNode;
}

export const TabProvider: React.FC<TabProviderProps> = ({ children }) => {
  const loadSession = useTabStore(state => state.loadSession);
  const saveSession = useTabStore(state => state.saveSession);
  const isLoading = useTabStore(state => state.isLoading);
  const panes = useTabStore(state => state.panes);
  const activePane = useTabStore(state => state.activePane);
  const globalActiveTab = useTabStore(state => state.globalActiveTab);
  const setIsContentRestored = useTabStore(state => state.setIsContentRestored);

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
  useEffect(() => {
    if (isLoading) return; // 初期ロード中は保存しない

    const timer = setTimeout(() => {
      saveSession().catch(console.error);
    }, 1000); // 1秒のデバウンス

    return () => clearTimeout(timer);
  }, [panes, activePane, globalActiveTab, isLoading, saveSession]);

  return <>{children}</>;
};

/**
 * @deprecated useTabContext は削除されました。
 * 直接 useTabStore() を使用してください。
 *
 * 移行例:
 * ```tsx
 * // 旧: const { openTab, closeTab } = useTabContext();
 * // 新: const { openTab, closeTab } = useTabStore();
 * ```
 */
export const useTabContext = () => {
  console.warn('[useTabContext] This hook is deprecated. Use useTabStore() directly.');
  return useTabStore();
};
