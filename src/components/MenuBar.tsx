import { FileText, Search, Settings } from 'lucide-react';
import clsx from 'clsx';
import { MenuTab } from '../types';

interface MenuBarProps {
  activeMenuTab: MenuTab;
  onMenuTabClick: (tab: MenuTab) => void;
}

export default function MenuBar({ activeMenuTab, onMenuTabClick }: MenuBarProps) {
  return (
    <div className="w-12 bg-muted border-r border-border flex flex-col flex-shrink-0">
      <button
        className={clsx(
          'h-12 w-12 flex items-center justify-center hover:bg-accent',
          activeMenuTab === 'files' && 'bg-accent text-primary'
        )}
        onClick={() => onMenuTabClick('files')}
      >
        <FileText size={20} />
      </button>
      <button
        className={clsx(
          'h-12 w-12 flex items-center justify-center hover:bg-accent',
          activeMenuTab === 'search' && 'bg-accent text-primary'
        )}
        onClick={() => onMenuTabClick('search')}
      >
        <Search size={20} />
      </button>
      <button
        className={clsx(
          'h-12 w-12 flex items-center justify-center hover:bg-accent',
          activeMenuTab === 'settings' && 'bg-accent text-primary'
        )}
        onClick={() => onMenuTabClick('settings')}
      >
        <Settings size={20} />
      </button>
    </div>
  );
}
