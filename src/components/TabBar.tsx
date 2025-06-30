import { X, Plus, TerminalSquare } from 'lucide-react';
import clsx from 'clsx';
import { Tab } from '../types';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  isBottomPanelVisible: boolean;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onToggleBottomPanel: () => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  isBottomPanelVisible,
  onTabClick,
  onTabClose,
  onToggleBottomPanel
}: TabBarProps) {
  return (
    <div className="h-10 bg-muted border-b border-border flex items-center relative">
      <div className="flex items-center overflow-x-auto" style={{ paddingRight: '50px' }}>
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={clsx(
              'h-full flex items-center px-3 border-r border-border cursor-pointer min-w-0 flex-shrink-0',
              tab.id === activeTabId ? 'tab-active' : 'tab-inactive'
            )}
            onClick={() => onTabClick(tab.id)}
          >
            <span className="text-sm truncate max-w-32">{tab.name}</span>
            {tab.isDirty && <span className="ml-1 text-xs">●</span>}
            <button
              className="ml-2 p-1 hover:bg-accent rounded"
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.id);
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button className="h-full px-3 hover:bg-accent flex items-center justify-center flex-shrink-0">
          <Plus size={16} />
        </button>
      </div>
      
      {/* Terminal Toggle Button - 絶対位置で右端に固定 */}
      <button
        className={clsx(
          'absolute right-0 top-0 h-10 px-3 hover:bg-accent flex items-center justify-center border-l border-border bg-muted',
          isBottomPanelVisible && 'bg-accent text-primary'
        )}
        onClick={onToggleBottomPanel}
        title="ターミナル表示/非表示"
        style={{ zIndex: 10 }}
      >
        <TerminalSquare size={16} />
      </button>
    </div>
  );
}
