'use client';

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Columns2,
  Rows2,
  X,
  Trash2,
} from 'lucide-react';
import React, { useCallback, useEffect, useState, useMemo } from 'react';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { EditorPane } from '@/engine/tabs/types';
import { useTabStore } from '@/stores/tabStore';

interface PaneNavigatorProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * PaneNavigator: ペイン操作用のモーダルコンポーネント
 * - 現在のペイン構成を視覚的に表示
 * - ペイン間の移動、分割、削除をキーボードで操作可能
 */
export default function PaneNavigator({ isOpen, onClose }: PaneNavigatorProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { panes, activePane, setActivePane, splitPane, removePane, moveTab } = useTabStore();
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);

  // Flatten panes to get all leaf panes
  const flattenedPanes = useMemo(() => {
    const result: EditorPane[] = [];
    const traverse = (paneList: EditorPane[]) => {
      for (const pane of paneList) {
        if (!pane.children || pane.children.length === 0) {
          result.push(pane);
        }
        if (pane.children) {
          traverse(pane.children);
        }
      }
    };
    traverse(panes);
    return result;
  }, [panes]);

  // Initialize selected pane to active pane
  useEffect(() => {
    if (isOpen && !selectedPaneId) {
      // Find the currently active pane from flattened panes
      const activeLeafPane = flattenedPanes.find(p => p.id === activePane);
      setSelectedPaneId(activeLeafPane?.id || flattenedPanes[0]?.id || null);
    }
  }, [isOpen, activePane, flattenedPanes, selectedPaneId]);

  // Reset selection when closed
  useEffect(() => {
    if (!isOpen) {
      setSelectedPaneId(null);
    }
  }, [isOpen]);

  // Find pane position in layout for navigation
  const getPanePosition = useCallback((paneId: string): { row: number; col: number } | null => {
    // Simple grid position calculation based on pane order
    const index = flattenedPanes.findIndex(p => p.id === paneId);
    if (index === -1) return null;
    
    // Calculate grid layout
    const cols = Math.ceil(Math.sqrt(flattenedPanes.length));
    const row = Math.floor(index / cols);
    const col = index % cols;
    return { row, col };
  }, [flattenedPanes]);

  // Navigate to adjacent pane
  const navigatePane = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    if (!selectedPaneId) return;
    
    const currentIndex = flattenedPanes.findIndex(p => p.id === selectedPaneId);
    if (currentIndex === -1) return;

    const cols = Math.ceil(Math.sqrt(flattenedPanes.length));
    let newIndex = currentIndex;

    switch (direction) {
      case 'left':
        newIndex = Math.max(0, currentIndex - 1);
        break;
      case 'right':
        newIndex = Math.min(flattenedPanes.length - 1, currentIndex + 1);
        break;
      case 'up':
        newIndex = Math.max(0, currentIndex - cols);
        break;
      case 'down':
        newIndex = Math.min(flattenedPanes.length - 1, currentIndex + cols);
        break;
    }

    setSelectedPaneId(flattenedPanes[newIndex].id);
  }, [selectedPaneId, flattenedPanes]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent default for our shortcuts
      const shouldPrevent = ['Escape', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'h', 'v', 'd', 's'].includes(e.key);
      if (shouldPrevent) {
        e.preventDefault();
        e.stopPropagation();
      }

      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'Enter':
          // Activate the selected pane and close
          if (selectedPaneId) {
            setActivePane(selectedPaneId);
            // Also activate the first tab in that pane
            const pane = flattenedPanes.find(p => p.id === selectedPaneId);
            if (pane && pane.activeTabId) {
              useTabStore.getState().activateTab(selectedPaneId, pane.activeTabId);
            }
          }
          onClose();
          break;
        case 'ArrowUp':
        case 'k':
          navigatePane('up');
          break;
        case 'ArrowDown':
        case 'j':
          navigatePane('down');
          break;
        case 'ArrowLeft':
        case 'h':
          navigatePane('left');
          break;
        case 'ArrowRight':
        case 'l':
          navigatePane('right');
          break;
        case 'v':
          // Split vertical
          if (selectedPaneId) {
            splitPane(selectedPaneId, 'vertical');
          }
          break;
        case 's':
          // Split horizontal
          if (selectedPaneId) {
            splitPane(selectedPaneId, 'horizontal');
          }
          break;
        case 'd':
          // Delete pane
          if (selectedPaneId && flattenedPanes.length > 1) {
            removePane(selectedPaneId);
            // Select first remaining pane
            const remaining = flattenedPanes.filter(p => p.id !== selectedPaneId);
            setSelectedPaneId(remaining[0]?.id || null);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isOpen, selectedPaneId, onClose, navigatePane, splitPane, removePane, flattenedPanes, setActivePane]);

  if (!isOpen) return null;

  // Calculate grid layout
  const cols = Math.ceil(Math.sqrt(flattenedPanes.length));
  const rows = Math.ceil(flattenedPanes.length / cols);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-card border border-border rounded-xl shadow-2xl p-6 max-w-3xl w-full mx-4"
        style={{ background: colors.cardBg, borderColor: colors.border }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-primary/10 rounded text-primary">
              <Columns2 size={18} />
            </div>
            <h2 className="text-base font-semibold" style={{ color: colors.foreground }}>
              {t('paneNavigator.title', { defaultValue: 'Pane Navigator' })}
            </h2>
          </div>
          <button
            className="p-1.5 rounded hover:bg-muted transition-colors"
            onClick={onClose}
          >
            <X size={18} style={{ color: colors.mutedFg }} />
          </button>
        </div>

        {/* Pane Grid */}
        <div
          className="grid gap-2 mb-4"
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            minHeight: '200px',
          }}
        >
          {flattenedPanes.map((pane, index) => {
            const isSelected = pane.id === selectedPaneId;
            const isActive = pane.id === activePane;
            const activeTab = pane.tabs.find(tab => tab.id === pane.activeTabId);
            
            return (
              <button
                key={pane.id}
                className="relative p-3 rounded-lg border-2 transition-all text-left flex flex-col"
                style={{
                  background: isSelected ? colors.accentBg : colors.mutedBg,
                  borderColor: isSelected ? colors.accentFg : isActive ? colors.primary : colors.border,
                  boxShadow: isSelected ? `0 0 0 2px ${colors.accentFg}40` : undefined,
                }}
                onClick={() => {
                  setSelectedPaneId(pane.id);
                }}
                onDoubleClick={() => {
                  setActivePane(pane.id);
                  if (pane.activeTabId) {
                    useTabStore.getState().activateTab(pane.id, pane.activeTabId);
                  }
                  onClose();
                }}
              >
                {/* Pane number badge */}
                <span
                  className="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{
                    background: isActive ? colors.primary : colors.mutedBg,
                    color: isActive ? '#fff' : colors.mutedFg,
                  }}
                >
                  {index + 1}
                </span>

                {/* Active tab name */}
                <span
                  className="text-sm font-medium truncate pr-6"
                  style={{ color: colors.foreground }}
                >
                  {activeTab?.name || t('paneNavigator.emptyPane', { defaultValue: 'Empty' })}
                </span>

                {/* Tab count */}
                <span
                  className="text-xs mt-1"
                  style={{ color: colors.mutedFg }}
                >
                  {pane.tabs.length} {pane.tabs.length === 1 
                    ? t('paneNavigator.tab', { defaultValue: 'tab' }) 
                    : t('paneNavigator.tabs', { defaultValue: 'tabs' })}
                </span>
              </button>
            );
          })}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors"
            style={{
              background: colors.mutedBg,
              borderColor: colors.border,
              color: colors.foreground,
            }}
            onClick={() => selectedPaneId && splitPane(selectedPaneId, 'vertical')}
            disabled={!selectedPaneId}
          >
            <Columns2 size={14} />
            <span>{t('paneNavigator.splitVertical', { defaultValue: 'Split Vertical' })}</span>
            <kbd className="ml-1 px-1 bg-background rounded text-[10px] text-muted-foreground">V</kbd>
          </button>

          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors"
            style={{
              background: colors.mutedBg,
              borderColor: colors.border,
              color: colors.foreground,
            }}
            onClick={() => selectedPaneId && splitPane(selectedPaneId, 'horizontal')}
            disabled={!selectedPaneId}
          >
            <Rows2 size={14} />
            <span>{t('paneNavigator.splitHorizontal', { defaultValue: 'Split Horizontal' })}</span>
            <kbd className="ml-1 px-1 bg-background rounded text-[10px] text-muted-foreground">S</kbd>
          </button>

          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors"
            style={{
              background: colors.mutedBg,
              borderColor: colors.border,
              color: flattenedPanes.length > 1 ? colors.red : colors.mutedFg,
            }}
            onClick={() => {
              if (selectedPaneId && flattenedPanes.length > 1) {
                removePane(selectedPaneId);
                const remaining = flattenedPanes.filter(p => p.id !== selectedPaneId);
                setSelectedPaneId(remaining[0]?.id || null);
              }
            }}
            disabled={!selectedPaneId || flattenedPanes.length <= 1}
          >
            <Trash2 size={14} />
            <span>{t('paneNavigator.deletePane', { defaultValue: 'Delete Pane' })}</span>
            <kbd className="ml-1 px-1 bg-background rounded text-[10px] text-muted-foreground">D</kbd>
          </button>
        </div>

        {/* Keyboard hints */}
        <div
          className="flex flex-wrap items-center gap-3 text-xs border-t pt-3"
          style={{ borderColor: colors.border, color: colors.mutedFg }}
        >
          <div className="flex items-center gap-1">
            <ArrowUp size={12} />
            <ArrowDown size={12} />
            <ArrowLeft size={12} />
            <ArrowRight size={12} />
            <span>{t('paneNavigator.navigate', { defaultValue: 'Navigate' })}</span>
          </div>
          <div className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-muted rounded font-mono">Enter</kbd>
            <span>{t('paneNavigator.activate', { defaultValue: 'Activate' })}</span>
          </div>
          <div className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-muted rounded font-mono">Esc</kbd>
            <span>{t('paneNavigator.close', { defaultValue: 'Close' })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
