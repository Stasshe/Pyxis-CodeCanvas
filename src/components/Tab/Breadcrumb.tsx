'use client';

import { useTheme } from '@/context/ThemeContext';
import { tabActions, tabState } from '@/stores/tabState';
import type React from 'react';
import { useSnapshot } from 'valtio';

interface BreadcrumbProps {
  paneId: string;
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({ paneId }) => {
  // Subscribe to only what we need (active tab's path/name)
  const pane = useSnapshot(tabState).panes.find(p => p.id === paneId);
  const { colors } = useTheme();
  if (!pane) return null;

  const activeTab = pane.tabs.find(t => t.id === pane.activeTabId);

  if (!activeTab) return null;

  // pathがない場合（welcomeタブなど）は表示しない、あるいは名前を表示する
  const displayPath = activeTab.path || activeTab.name;

  return (
    <div
      className="w-full px-4 py-0.5 text-xs flex items-center select-none border-b"
      style={{
        backgroundColor: colors.background, // エディタ背景と同じか、少し変えるか
        color: colors.mutedFg,
        borderColor: colors.border,
        height: '14px', // VS Codeのように少し小さめに
      }}
    >
      <span className="truncate">{displayPath}</span>
    </div>
  );
};
