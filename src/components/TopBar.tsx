import React from 'react';
import { useTranslation } from '@/context/I18nContext';
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
  const { t } = useTranslation();
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
        title={t('topBar.searchTitle')}
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
        <span className="ml-2 truncate">
          {currentProjectName} [{t('topBar.searchLabel')}]
        </span>
      </button>
      <button
        className={`relative right-2 h-6 px-2 flex items-center justify-center border rounded transition-colors`}
        onClick={toggleBottomPanel}
        title={t('topBar.toggleTerminal')}
        style={{
          zIndex: 50,
          background: colors.accentBg,
          color: colors.primary,
          borderColor: colors.border,
        }}
      >
        <Terminal
          size={14}
          color={colors.primary}
          strokeWidth={2.2}
        />
      </button>
      <button
        className={`relative right-3 h-6 px-2 flex items-center justify-center border rounded transition-colors ml-1`}
        onClick={toggleRightSidebar}
        title={t('topBar.toggleRightPanel')}
        style={{
          zIndex: 50,
          background: colors.accentBg,
          color: colors.primary,
          borderColor: colors.border,
        }}
      >
        <PanelRightIcon
          size={18}
          color={colors.primary}
          strokeWidth={2.2}
        />
      </button>
    </div>
  );
}
