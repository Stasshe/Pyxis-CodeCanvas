// src/context/TabContext.tsx
'use client';
import React, { createContext, useContext, useEffect, ReactNode } from 'react';
import { useTabStore } from '@/stores/tabStore';
import { OpenTabOptions, Tab, EditorPane } from '@/engine/tabs/types';

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

  // 状態取得
  panes: EditorPane[];
  activePane: string | null;
  globalActiveTab: string | null;
  getPane: (paneId: string) => EditorPane | null;
  getTab: (paneId: string, tabId: string) => Tab | null;
  getAllTabs: () => Tab[];
  findTabByPath: (path: string, kind?: string) => { paneId: string; tab: Tab } | null;
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

  // 初期化: デフォルトペインを作成
  useEffect(() => {
    if (store.panes.length === 0) {
      const defaultPane: EditorPane = {
        id: 'pane-1',
        tabs: [],
        activeTabId: '',
      };
      store.addPane(defaultPane);
      store.setActivePane(defaultPane.id);
    }
  }, []);

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
    panes: store.panes,
    activePane: store.activePane,
    globalActiveTab: store.globalActiveTab,
    getPane: store.getPane,
    getTab: store.getTab,
    getAllTabs: store.getAllTabs,
    findTabByPath: store.findTabByPath,
  };

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
};
