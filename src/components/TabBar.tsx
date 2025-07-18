import { X, Plus, TerminalSquare } from 'lucide-react';
import clsx from 'clsx';
import { Tab } from '../types';
import { useTheme } from '../context/ThemeContext';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  isBottomPanelVisible: boolean;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onToggleBottomPanel: () => void;
  extraButtons?: React.ReactNode;
  onAddTab?: () => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  isBottomPanelVisible,
  onTabClick,
  onTabClose,
  onToggleBottomPanel,
  extraButtons,
  onAddTab
}: TabBarProps) {
  const { colors } = useTheme();
  return (
    <div
      className="h-10 border-b flex items-center relative bg-muted border-border"
      style={{
        background: colors.mutedBg,
        borderColor: colors.border,
      }}
    >
      {/* 左端にextraButtonsを追加 */}
      {extraButtons && (
        <div className="flex items-center h-full pl-2 pr-1 gap-1">
          {extraButtons}
        </div>
      )}
      <div className="flex items-center overflow-x-auto flex-1">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={clsx(
              'h-full flex items-center px-3 border-r cursor-pointer min-w-0 flex-shrink-0',
              tab.id === activeTabId ? 'tab-active' : 'tab-inactive'
            )}
            style={{
              borderRight: `1px solid ${colors.border}`,
              background: tab.id === activeTabId ? colors.cardBg : 'transparent',
              color: tab.id === activeTabId ? colors.foreground : colors.mutedFg,
            }}
            onClick={() => onTabClick(tab.id)}
          >
            <span className="text-sm truncate max-w-32">{tab.name}</span>
            {tab.isDirty && <span className="ml-1 text-xs" style={{ color: colors.red }}>●</span>}
            <button
              className="ml-2 p-1 rounded hover:bg-accent"
              style={{ background: undefined }}
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.id);
              }}
            >
              <X size={12} color={colors.mutedFg} />
            </button>
          </div>
        ))}
        <button
          className="h-full px-3 flex items-center justify-center flex-shrink-0 hover:bg-accent"
          style={{ background: undefined }}
          onClick={onAddTab}
        >
          <Plus size={16} color={colors.accentFg} />
        </button>
      </div>
    </div>
  );
}
