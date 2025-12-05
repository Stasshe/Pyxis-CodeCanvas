'use client';

import React, { useCallback, useEffect, useState, useMemo, memo } from 'react';

import { useTheme } from '@/context/ThemeContext';
import { EditorPane } from '@/engine/tabs/types';
import { useTabStore } from '@/stores/tabStore';

interface PaneNavigatorProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PaneItemProps {
  pane: EditorPane;
  isSelected: boolean;
  isActive: boolean;
  onSelect: (paneId: string) => void;
  onActivate: (paneId: string) => void;
  colors: any;
  index: number;
}

// Compact pane item with big number
const PaneItem = memo(function PaneItem({ pane, isSelected, isActive, onSelect, onActivate, colors, index }: PaneItemProps) {
  const num = index + 1;
  return (
    <div
      className="flex items-center justify-center rounded cursor-pointer select-none h-full"
      style={{
        background: isSelected ? colors.accentBg : isActive ? colors.primary + '30' : colors.mutedBg,
        border: `1px solid ${isSelected ? colors.accentFg : isActive ? colors.primary : colors.border}`,
        minWidth: '36px',
        minHeight: '32px',
      }}
      onClick={(e) => { e.stopPropagation(); onSelect(pane.id); }}
      onDoubleClick={(e) => { e.stopPropagation(); onActivate(pane.id); }}
    >
      <span style={{ fontSize: num <= 9 ? '16px' : '11px', fontWeight: 600, color: isSelected ? colors.accentFg : isActive ? colors.primary : colors.foreground }}>
        {num}
      </span>
    </div>
  );
});

interface RecursivePaneViewProps {
  pane: EditorPane;
  selectedPaneId: string | null;
  activePane: string | null;
  onSelect: (paneId: string) => void;
  onActivate: (paneId: string) => void;
  colors: any;
  leafIndexRef: { current: number };
}

// Recursive pane view - mirrors actual layout
const RecursivePaneView = memo(function RecursivePaneView({ pane, selectedPaneId, activePane, onSelect, onActivate, colors, leafIndexRef }: RecursivePaneViewProps) {
  if (pane.children && pane.children.length > 0) {
    const isVertical = pane.layout === 'vertical';
    return (
      <div className="flex gap-0.5 w-full h-full" style={{ flexDirection: isVertical ? 'row' : 'column' }}>
        {pane.children.map((child) => (
          <div key={child.id} style={{ flex: child.size ? `0 0 ${child.size}%` : 1 }}>
            <RecursivePaneView pane={child} selectedPaneId={selectedPaneId} activePane={activePane} onSelect={onSelect} onActivate={onActivate} colors={colors} leafIndexRef={leafIndexRef} />
          </div>
        ))}
      </div>
    );
  }
  const currentIndex = leafIndexRef.current++;
  return <PaneItem pane={pane} isSelected={pane.id === selectedPaneId} isActive={pane.id === activePane} onSelect={onSelect} onActivate={onActivate} colors={colors} index={currentIndex} />;
});

/**
 * PaneNavigator: 超コンパクトなペイン操作モーダル
 * - 数字キー1-9で直接選択・アクティブ化
 * - 再帰的レイアウト表示
 */
export default function PaneNavigator({ isOpen, onClose }: PaneNavigatorProps) {
  const { colors } = useTheme();
  const { panes, activePane, setActivePane, splitPane, removePane } = useTabStore();
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);

  // Flatten panes for navigation
  const flattenedPanes = useMemo(() => {
    const result: EditorPane[] = [];
    const traverse = (list: EditorPane[]) => {
      for (const p of list) {
        if (!p.children || p.children.length === 0) result.push(p);
        if (p.children) traverse(p.children);
      }
    };
    traverse(panes);
    return result;
  }, [panes]);

  // Initialize selection
  useEffect(() => {
    if (isOpen) {
      const active = flattenedPanes.find(p => p.id === activePane);
      setSelectedPaneId(active?.id || flattenedPanes[0]?.id || null);
    } else {
      setSelectedPaneId(null);
    }
  }, [isOpen, activePane, flattenedPanes]);

  const handleSelect = useCallback((id: string) => setSelectedPaneId(id), []);

  const handleActivate = useCallback((id: string) => {
    setActivePane(id);
    const pane = flattenedPanes.find(p => p.id === id);
    if (pane?.activeTabId) {
      useTabStore.getState().activateTab(id, pane.activeTabId);
    }
    onClose();
  }, [setActivePane, flattenedPanes, onClose]);

  const handleSplit = useCallback((dir: 'vertical' | 'horizontal') => {
    if (!selectedPaneId) return;
    splitPane(selectedPaneId, dir);
    requestAnimationFrame(() => {
      const newFlat: EditorPane[] = [];
      const traverse = (list: EditorPane[]) => {
        for (const p of list) {
          if (!p.children || p.children.length === 0) newFlat.push(p);
          if (p.children) traverse(p.children);
        }
      };
      traverse(useTabStore.getState().panes);
      const newPane = newFlat.find(p => !flattenedPanes.some(fp => fp.id === p.id));
      if (newPane) setSelectedPaneId(newPane.id);
    });
  }, [selectedPaneId, splitPane, flattenedPanes]);

  const handleDelete = useCallback(() => {
    if (!selectedPaneId || flattenedPanes.length <= 1) return;
    const idx = flattenedPanes.findIndex(p => p.id === selectedPaneId);
    const nextId = flattenedPanes[idx > 0 ? idx - 1 : 1]?.id || null;
    removePane(selectedPaneId);
    requestAnimationFrame(() => setSelectedPaneId(nextId));
  }, [selectedPaneId, flattenedPanes, removePane]);

  // Keyboard handler with number keys
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      const key = e.key;
      
      // Number keys 1-9 for direct selection
      if (key >= '1' && key <= '9') {
        e.preventDefault();
        e.stopPropagation();
        const idx = parseInt(key) - 1;
        if (idx < flattenedPanes.length) {
          handleActivate(flattenedPanes[idx].id);
        }
        return;
      }
      
      if (['Escape', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'h', 'j', 'k', 'l', 'v', 's', 'd'].includes(key)) {
        e.preventDefault();
        e.stopPropagation();
      }
      const len = flattenedPanes.length;
      const idx = flattenedPanes.findIndex(p => p.id === selectedPaneId);
      switch (key) {
        case 'Escape': onClose(); break;
        case 'Enter': if (selectedPaneId) handleActivate(selectedPaneId); break;
        case 'ArrowLeft': case 'h': case 'ArrowUp': case 'k':
          if (idx > 0) setSelectedPaneId(flattenedPanes[idx - 1].id);
          break;
        case 'ArrowRight': case 'l': case 'ArrowDown': case 'j':
          if (idx < len - 1) setSelectedPaneId(flattenedPanes[idx + 1].id);
          break;
        case 'v': handleSplit('vertical'); break;
        case 's': handleSplit('horizontal'); break;
        case 'd': handleDelete(); break;
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [isOpen, selectedPaneId, flattenedPanes, onClose, handleActivate, handleSplit, handleDelete]);

  if (!isOpen) return null;

  const leafIndexRef = { current: 0 };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div
        className="rounded-lg shadow-lg p-2"
        style={{ background: colors.cardBg, border: `1px solid ${colors.border}`, minWidth: '100px' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Pane Layout */}
        <div className="flex gap-0.5" style={{ minHeight: '40px' }}>
          {panes.map((pane) => (
            <div key={pane.id} style={{ flex: pane.size ? `0 0 ${pane.size}%` : 1 }}>
              <RecursivePaneView
                pane={pane}
                selectedPaneId={selectedPaneId}
                activePane={activePane}
                onSelect={handleSelect}
                onActivate={handleActivate}
                colors={colors}
                leafIndexRef={leafIndexRef}
              />
            </div>
          ))}
        </div>
        {/* Hint */}
        <div className="mt-1 text-[8px] text-center" style={{ color: colors.mutedFg }}>
          1-9 · ←→ · v/s · d
        </div>
      </div>
    </div>
  );
}
