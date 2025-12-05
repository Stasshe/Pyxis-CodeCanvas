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

// Larger pane item with big number
const PaneItem = memo(function PaneItem({ pane, isSelected, isActive, onSelect, onActivate, colors, index }: PaneItemProps) {
  const num = index + 1;
  return (
    <div
      className="flex items-center justify-center rounded-md cursor-pointer select-none"
      style={{
        background: isSelected ? colors.primary : isActive ? colors.primary + '30' : colors.cardBg,
        border: isSelected 
          ? `2px solid ${colors.primary}` 
          : isActive 
            ? `2px solid ${colors.primary}` 
            : `1px solid ${colors.border}`,
        width: '100%',
        height: '100%',
        minWidth: '48px',
        minHeight: '44px',
        boxShadow: isSelected 
          ? `0 0 12px ${colors.primary}60` 
          : isActive 
            ? `0 0 8px ${colors.primary}40` 
            : 'none',
      }}
      onClick={(e) => { e.stopPropagation(); onSelect(pane.id); }}
      onDoubleClick={(e) => { e.stopPropagation(); onActivate(pane.id); }}
    >
      <span style={{ 
        fontSize: num <= 9 ? '20px' : '14px', 
        fontWeight: 700, 
        color: isSelected ? colors.cardBg : isActive ? colors.primary : colors.foreground 
      }}>
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
      <div className="flex gap-1 w-full h-full" style={{ flexDirection: isVertical ? 'row' : 'column' }}>
        {pane.children.map((child) => (
          <div key={child.id} className="flex-1" style={{ minWidth: 0, minHeight: 0 }}>
            <RecursivePaneView pane={child} selectedPaneId={selectedPaneId} activePane={activePane} onSelect={onSelect} onActivate={onActivate} colors={colors} leafIndexRef={leafIndexRef} />
          </div>
        ))}
      </div>
    );
  }
  const currentIndex = leafIndexRef.current++;
  return <PaneItem pane={pane} isSelected={pane.id === selectedPaneId} isActive={pane.id === activePane} onSelect={onSelect} onActivate={onActivate} colors={colors} index={currentIndex} />;
});

// Calculate layout dimensions based on pane structure
function calculateLayoutDimensions(panes: EditorPane[]): { width: number; height: number } {
  const baseSize = 56; // Base size for each pane item
  const gap = 4;
  
  function getDepth(pane: EditorPane, direction: 'horizontal' | 'vertical'): number {
    if (!pane.children || pane.children.length === 0) return 1;
    const childDepths = pane.children.map(c => getDepth(c, direction));
    if (pane.layout === direction) {
      return childDepths.reduce((a, b) => a + b, 0);
    }
    return Math.max(...childDepths);
  }
  
  let maxWidth = 0;
  let maxHeight = 0;
  
  for (const pane of panes) {
    const w = getDepth(pane, 'vertical');
    const h = getDepth(pane, 'horizontal');
    maxWidth += w;
    maxHeight = Math.max(maxHeight, h);
  }
  
  return {
    width: maxWidth * baseSize + (maxWidth - 1) * gap,
    height: maxHeight * baseSize + (maxHeight - 1) * gap
  };
}

/**
 * PaneNavigator: コンパクトなペイン操作モーダル
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
  const { width, height } = calculateLayoutDimensions(panes);

  return (
    <div 
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3"
      style={{ 
        background: `${colors.foreground}15`,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }} 
      onClick={onClose}
    >
      {/* Pane Layout */}
      <div 
        className="flex gap-1"
        style={{ width: `${width}px`, height: `${height}px` }}
        onClick={e => e.stopPropagation()}
      >
        {panes.map((pane) => (
          <div key={pane.id} className="flex-1" style={{ minWidth: 0, minHeight: 0 }}>
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
      {/* Hint - positioned below with gap */}
      <div 
        className="text-[11px] px-3 py-1 rounded-full"
        style={{ 
          color: colors.foreground, 
          background: `${colors.cardBg}90`,
          opacity: 0.9
        }}
        onClick={e => e.stopPropagation()}
      >
        1-9 · hjkl/←→ · v/s · d
      </div>
    </div>
  );
}
