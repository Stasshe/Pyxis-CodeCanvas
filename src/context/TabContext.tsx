// src/context/TabContext.tsx
'use client';
import React, { createContext, useContext, useEffect, ReactNode, useState } from 'react';
import { useTabStore } from '@/stores/tabStore';
import { OpenTabOptions, Tab, EditorPane } from '@/engine/tabs/types';
import { sessionStorage } from '@/stores/sessionStorage';

interface TabContextValue {
  // タブ操作
  openTab: (file: any, options?: OpenTabOptions) => void;
  closeTab: (paneId: string, tabId: string) => void;
  activateTab: (paneId: string, tabId: string) => void;
  updateTab: (paneId: string, tabId: string, updates: Partial<Tab>) => void;
  moveTab: (fromPaneId: string, toPaneId: string, tabId: string) => void;

  // ペイン操作
  setPanes: (panes: EditorPane[]) => void;
  addPane: (pane: EditorPane) => void;
  removePane: (paneId: string) => void;
  updatePane: (paneId: string, updates: Partial<EditorPane>) => void;
  setActivePane: (paneId: string | null) => void;
  splitPane: (paneId: string, direction: 'horizontal' | 'vertical') => void;
  resizePane: (paneId: string, newSize: number) => void;

  // 状態取得
  panes: EditorPane[];
  activePane: string | null;
  globalActiveTab: string | null;
  getPane: (paneId: string) => EditorPane | null;
  getTab: (paneId: string, tabId: string) => Tab | null;
  getAllTabs: () => Tab[];
  findTabByPath: (path: string, kind?: string) => { paneId: string; tab: Tab } | null;

  // セッション管理
  isLoading: boolean;
  isRestored: boolean;
  saveSession: () => Promise<void>;
}

const TabContext = createContext<TabContextValue | null>(null);

export const useTabContext = () => {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error('useTabContext must be used within TabProvider');
  }
  return context;
};

interface TabProviderProps {
  children: ReactNode;
}

export const TabProvider: React.FC<TabProviderProps> = ({ children }) => {
  const store = useTabStore();
  const [isLoading, setIsLoading] = useState(true);

  // IndexedDBからセッションを復元
  useEffect(() => {
    const restoreSession = async () => {
      try {
        console.log('[TabContext] Loading session from IndexedDB...');
        const session = await sessionStorage.load();

        // TabStoreに状態を復元
        store.setPanes(session.tabs.panes);
        if (session.tabs.activePane) {
          store.setActivePane(session.tabs.activePane);
        }

        console.log('[TabContext] Session restored successfully');
      } catch (error) {
        console.error('[TabContext] Failed to restore session:', error);
      } finally {
        setIsLoading(false);
      }
    };

    restoreSession();
  }, []);

  // セッション保存関数
  const saveSession = async () => {
    const session = {
      version: 1,
      lastSaved: Date.now(),
      tabs: {
        panes: store.panes,
        activePane: store.activePane,
        globalActiveTab: store.globalActiveTab,
      },
      ui: {
        // UIStateはpage.tsxから渡される想定（後で統合）
        leftSidebarWidth: 240,
        rightSidebarWidth: 240,
        bottomPanelHeight: 200,
        isLeftSidebarVisible: true,
        isRightSidebarVisible: true,
        isBottomPanelVisible: true,
      },
    };
    await sessionStorage.save(session);
  };

  // TabStore の変更を監視して自動保存
  useEffect(() => {
    if (isLoading) return; // 初期ロード中は保存しない

    const timer = setTimeout(() => {
      saveSession().catch(console.error);
    }, 1000); // 1秒のデバウンス

    return () => clearTimeout(timer);
  }, [store.panes, store.activePane, store.globalActiveTab, isLoading]);

  const value: TabContextValue = {
    openTab: store.openTab,
    closeTab: store.closeTab,
    activateTab: store.activateTab,
    updateTab: store.updateTab,
    moveTab: store.moveTab,
    setPanes: store.setPanes,
    addPane: store.addPane,
    removePane: store.removePane,
    updatePane: store.updatePane,
    setActivePane: store.setActivePane,
    splitPane: store.splitPane,
    resizePane: store.resizePane,
    panes: store.panes,
    activePane: store.activePane,
    globalActiveTab: store.globalActiveTab,
    getPane: store.getPane,
    getTab: store.getTab,
    getAllTabs: store.getAllTabs,
    findTabByPath: store.findTabByPath,
    isLoading,
    isRestored: !isLoading, // isLoadingの逆がisRestored
    saveSession,
  };

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
};
