'use client';

import { File, Folder, GitBranch, History, Terminal, X } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';

import { useTheme } from '@/context/ThemeContext';
import type { SuggestItem } from '@/engine/cmd/terminalSuggestProvider';

interface TerminalSuggestWidgetProps {
  visible: boolean;
  items: SuggestItem[];
  selectedIndex: number;
  position: { x: number; y: number };
  onSelect: (item: SuggestItem) => void;
  onClose: () => void;
  onNavigate: (direction: 'up' | 'down') => void;
}

/**
 * Get icon component for suggest item kind
 */
function getItemIcon(kind: SuggestItem['kind']) {
  switch (kind) {
    case 'command':
      return <Terminal size={14} />;
    case 'file':
      return <File size={14} />;
    case 'directory':
      return <Folder size={14} />;
    case 'history':
      return <History size={14} />;
    case 'git-branch':
      return <GitBranch size={14} />;
    case 'npm-script':
      return <Terminal size={14} />;
    default:
      return <Terminal size={14} />;
  }
}

/**
 * Terminal Suggest Widget - VS Code style autocomplete dropdown
 */
const TerminalSuggestWidget: React.FC<TerminalSuggestWidgetProps> = ({
  visible,
  items,
  selectedIndex,
  position,
  onSelect,
  onClose,
  onNavigate,
}) => {
  const { colors } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedRef.current && containerRef.current) {
      selectedRef.current.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [selectedIndex]);

  // Handle click outside to close
  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (visible) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [visible, handleClickOutside]);

  // Handle touch outside to close
  const handleTouchOutside = useCallback(
    (e: TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (visible) {
      document.addEventListener('touchstart', handleTouchOutside, { passive: true });
      return () => document.removeEventListener('touchstart', handleTouchOutside);
    }
  }, [visible, handleTouchOutside]);

  if (!visible || items.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="absolute z-50 min-w-[200px] max-w-[400px] shadow-lg rounded-md overflow-hidden"
      style={{
        left: position.x,
        bottom: position.y,
        background: colors.cardBg,
        border: `1px solid ${colors.border}`,
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Header with close button - iPad friendly size */}
      <div
        className="flex items-center justify-between px-2 py-1 border-b"
        style={{ borderColor: colors.border }}
      >
        <span className="text-[10px] uppercase tracking-wide" style={{ color: colors.mutedFg }}>
          Suggestions
        </span>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded hover:bg-opacity-20 transition-colors touch-manipulation"
          style={{ color: colors.mutedFg, minWidth: 32, minHeight: 32 }}
          aria-label="Close suggestions"
        >
          <X size={16} />
        </button>
      </div>

      {/* Items list - max 8 visible */}
      <div
        className="overflow-y-auto"
        style={{ maxHeight: 8 * 32 }} // 8 items * 32px each
      >
        {items.map((item, index) => (
          <div
            key={`${item.kind}-${item.label}-${index}`}
            ref={index === selectedIndex ? selectedRef : null}
            className="flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors touch-manipulation"
            style={{
              background: index === selectedIndex ? colors.accentBg : 'transparent',
              color: index === selectedIndex ? colors.accentFg : colors.foreground,
              minHeight: 32,
            }}
            onClick={() => onSelect(item)}
            onTouchEnd={(e) => {
              e.preventDefault();
              onSelect(item);
            }}
          >
            <span
              className="flex-shrink-0"
              style={{
                color: index === selectedIndex ? colors.accentFg : colors.mutedFg,
              }}
            >
              {getItemIcon(item.kind)}
            </span>
            <span className="flex-1 text-xs font-mono truncate">{item.label}</span>
            {item.detail && (
              <span
                className="text-[10px] flex-shrink-0"
                style={{
                  color: index === selectedIndex ? colors.accentFg : colors.mutedFg,
                  opacity: 0.7,
                }}
              >
                {item.detail}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Footer hint */}
      <div
        className="px-2 py-1 border-t text-[10px]"
        style={{ borderColor: colors.border, color: colors.mutedFg }}
      >
        <span className="hidden sm:inline">↑↓ Navigate • Tab/Enter Accept • Esc Close</span>
        <span className="sm:hidden">Tap to select • × to close</span>
      </div>
    </div>
  );
};

export default TerminalSuggestWidget;
