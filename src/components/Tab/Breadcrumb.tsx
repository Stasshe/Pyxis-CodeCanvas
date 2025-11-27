'use client';

import React from 'react';
import { useTabStore } from '@/stores/tabStore';
import { useTheme } from '@/context/ThemeContext';

interface BreadcrumbProps {
  paneId: string;
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({ paneId }) => {
  const { getPane } = useTabStore();
  const { colors } = useTheme();

  const pane = getPane(paneId);
  if (!pane) return null;

  const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId);

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
