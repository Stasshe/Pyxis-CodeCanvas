import React from 'react';
import { Search, Terminal } from 'lucide-react';
import PanelRightIcon from '@/components/Right/PanelRightIcon';

type Props = {
  isOperationWindowVisible: boolean;
  toggleOperationWindow: () => void;
  isBottomPanelVisible: boolean;
  toggleBottomPanel: () => void;
  isRightSidebarVisible: boolean;
  toggleRightSidebar: () => void;
  colors: any;
  currentProjectName?: string;
  gitChangesCount?: number;
};

export default function TopBar({
  isOperationWindowVisible,
  toggleOperationWindow,
  isBottomPanelVisible,
  toggleBottomPanel,
  isRightSidebarVisible,
  toggleRightSidebar,
  colors,
  currentProjectName,
}: Props) {
  return (
    <div
      className="w-full flex justify-end items-center overflow-hidden select-none"
      style={{
        background: colors.background,
        height: '30px',
      }}
    >
      <button
        className="absolute left-1/2 transform -translate-x-1/2 h-6 flex items-center justify-center border rounded transition-colors"
        onClick={toggleOperationWindow}
        title="ファイル検索 (Ctrl+P)"
        style={{
          zIndex: 50,
          background: isOperationWindowVisible ? colors.accentBg : colors.mutedBg,
          color: isOperationWindowVisible ? colors.primary : colors.mutedFg,
          borderColor: colors.border,
          width: '35%',
          minWidth: 180,
          maxWidth: 500,
          paddingLeft: 12,
          paddingRight: 12,
        }}
      >
        <Search
          size={14}
          color={isOperationWindowVisible ? colors.primary : colors.mutedFg}
        />
        <span className="ml-2 truncate">{currentProjectName} [ファイル検索]</span>
      </button>
      <button
        className={`relative right-2 h-6 px-2 flex items-center justify-center border rounded transition-colors`}
        onClick={toggleBottomPanel}
        title="ターミナル表示/非表示"
        style={{
          zIndex: 50,
          background: isBottomPanelVisible ? colors.accentBg : colors.mutedBg,
          color: isBottomPanelVisible ? colors.primary : colors.mutedFg,
          borderColor: colors.border,
        }}
      >
        <Terminal
          size={8}
          color={isBottomPanelVisible ? colors.primary : colors.mutedFg}
        />
      </button>
      <button
        className={`relative right-3 h-6 px-2 flex items-center justify-center border rounded transition-colors ml-1`}
        onClick={toggleRightSidebar}
        title="右パネル表示/非表示"
        style={{
          zIndex: 50,
          background: isRightSidebarVisible ? colors.accentBg : colors.mutedBg,
          color: isRightSidebarVisible ? colors.primary : colors.mutedFg,
          borderColor: colors.border,
        }}
      >
        <PanelRightIcon
          size={16}
          color={isRightSidebarVisible ? colors.primary : colors.mutedFg}
        />
      </button>
    </div>
  );
}
