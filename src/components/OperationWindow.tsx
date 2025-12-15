'use client';

import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getIconForFile } from 'vscode-icons-js';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { isPathIgnored, parseGitignore } from '@/engine/core/gitignore';
import { formatKeyComboForDisplay } from '@/hooks/useKeyBindings';
import { useSettings } from '@/hooks/useSettings';
import { useTabStore } from '@/stores/tabStore';
import type { FileItem } from '@/types';

// FileItem[]を平坦化する関数（tab.tsと同じ実装）
function flattenFileItems(items: FileItem[]): FileItem[] {
  const result: FileItem[] = [];

  function traverse(items: FileItem[]) {
    for (const item of items) {
      result.push(item);
      if (item.children && item.children.length > 0) {
        traverse(item.children);
      }
    }
  }

  traverse(items);
  return result;
}

// --- VSCode-style matching helpers ---
// CamelCase/snake_case boundaries を考慮したスコアリング
function scoreMatch(text: string, query: string): number {
  if (!query) return 100;
  const t = text.toLowerCase();
  const q = query.toLowerCase();

  // 完全一致
  if (t === q) return 100;

  // 前方一致（高スコア）
  if (t.startsWith(q)) return 90;

  // 部分文字列一致
  const idx = t.indexOf(q);
  if (idx !== -1) {
    // 単語の境界で始まる場合はスコアを上げる
    const isBoundary =
      idx === 0 || text[idx - 1] === '/' || text[idx - 1] === '_' || text[idx - 1] === '-';
    return isBoundary ? 85 : 70;
  }

  // CamelCase マッチング (e.g., "ow" matches "OperationWindow")
  const camelIndices: number[] = [];
  let queryIdx = 0;
  for (let i = 0; i < text.length && queryIdx < query.length; i++) {
    if (text[i].toLowerCase() === query[queryIdx].toLowerCase()) {
      const isUpperCase = text[i] === text[i].toUpperCase() && text[i] !== text[i].toLowerCase();
      const isBoundary =
        i === 0 || text[i - 1] === '/' || text[i - 1] === '_' || text[i - 1] === '-';
      if (isUpperCase || isBoundary || queryIdx > 0) {
        camelIndices.push(i);
        queryIdx++;
      }
    }
  }
  if (queryIdx === query.length) return 60;

  return 0; // マッチしない
}

function getIconSrcForFile(name: string) {
  const iconPath = getIconForFile(name) || getIconForFile('');
  if (iconPath && iconPath.endsWith('.svg')) {
    return `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/${iconPath.split('/').pop()}`;
  }
  return `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/file.svg`;
}

export interface OperationListItem {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode | string; // URL string or Component
  onClick?: () => void;
  isActive?: boolean;
  // Editing state
  isEditing?: boolean;
  editValue?: string;
  onEditChange?: (value: string) => void;
  onEditConfirm?: () => void;
  onEditCancel?: () => void;
  // Actions
  actions?: {
    id: string;
    icon: React.ReactNode;
    label: string;
    onClick: (e: React.MouseEvent) => void;
    danger?: boolean;
  }[];
}

interface OperationWindowProps {
  isVisible: boolean;
  onClose: () => void;
  projectFiles: FileItem[];
  onFileSelect?: (file: FileItem, preview?: boolean) => void; // AI用モード用
  aiMode?: boolean; // AI用モード（ファイルをタブで開かない）
  targetPaneId?: string | null; // ファイルを開くペインのID

  // Generic List Props
  items?: OperationListItem[];
  listTitle?: string; // Title for the list view (e.g. "Chat Spaces")
  onSearchList?: (query: string) => void; // Optional: handle search externally or let component filter by label
  headerActions?: {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
  }[];

  initialView?: 'files' | 'list';
}

export default function OperationWindow({
  isVisible,
  onClose,
  projectFiles,
  onFileSelect,
  aiMode = false,
  targetPaneId,
  items,
  listTitle,
  onSearchList,
  headerActions,
  initialView,
}: OperationWindowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mdPreviewPrompt, setMdPreviewPrompt] = useState<null | { file: FileItem }>(null);
  const [mdDialogSelected, setMdDialogSelected] = useState<0 | 1>(0); // 0: プレビュー, 1: 通常エディタ
  const [viewMode, setViewMode] = useState<'files' | 'list'>(() => initialView || 'files');
  const hideModeTabs = Boolean(items && initialView === 'list');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [portalEl] = useState(() =>
    typeof document !== 'undefined' ? document.createElement('div') : null
  );
  const { isExcluded } = useSettings();
  // 固定アイテム高さを定義（スクロール計算と見た目の基準にする）
  const ITEM_HEIGHT = 20; // slightly more compact

  // Reset state when visibility changes
  useEffect(() => {
    if (isVisible) {
      setSearchQuery('');
      setSelectedIndex(0);
      // Focus input
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isVisible]);

  // Attach a top-level portal element to document.body so the overlay isn't clipped
  useEffect(() => {
    if (!portalEl) return;
    portalEl.className = 'pyxis-operation-window-portal';
    // ensure portal container doesn't interfere with layout
    portalEl.style.position = 'relative';
    portalEl.style.zIndex = '99999';
    document.body.appendChild(portalEl);
    return () => {
      try {
        document.body.removeChild(portalEl);
      } catch (e) {
        // ignore
      }
    };
  }, [portalEl]);

  // ファイル選択ハンドラ
  const handleFileSelectInOperation = (file: FileItem) => {
    // AIモードの場合は.mdの確認ダイアログは不要なので直接処理する
    if (aiMode) {
      actuallyOpenFile(file, false);
      return;
    }

    if (file.name.toLowerCase().endsWith('.md')) {
      setMdPreviewPrompt({ file });
      return;
    }
    actuallyOpenFile(file, false);
  };

  // 実際にファイルを開く処理（mdプレビューかどうかを指定）
  // NOTE: Tab system removed — delegate to `onFileSelect(file, preview)` if available.
  const actuallyOpenFile = (file: FileItem, preview: boolean) => {
    if (onFileSelect) {
      try {
        onFileSelect(file, preview);
      } catch (e) {
        console.warn('[OperationWindow] onFileSelect threw:', e);
      }
      onClose();
      return;
    }

    // Fallback: try to open via tab store if available (back-compat)
    try {
      const defaultEditor =
        typeof window !== 'undefined' ? localStorage.getItem('pyxis-defaultEditor') : 'monaco';
      const fileWithEditor = { ...file, isCodeMirror: defaultEditor === 'codemirror' };
      const options = targetPaneId
        ? { paneId: targetPaneId, kind: preview ? 'preview' : 'editor' }
        : { kind: preview ? 'preview' : 'editor' };

      const store = useTabStore.getState ? useTabStore.getState() : null;
      if (store && typeof store.openTab === 'function') {
        store.openTab(fileWithEditor, options as any);
        onClose();
        return;
      }
    } catch (e) {
      console.warn('[OperationWindow] tab fallback failed:', e);
    }

    // No handler available — simply close and warn.
    console.warn('[OperationWindow] No file open handler available (tabs removed).');
    onClose();
  };

  // 設定から除外パターンを取得
  const gitignoreRules = useMemo(() => {
    try {
      const flat = flattenFileItems(projectFiles);
      const git = flat.find(f => f.name === '.gitignore' || f.path === '.gitignore');
      if (!git || !git.content) return [] as any[];
      return parseGitignore(git.content);
    } catch (err) {
      return [] as any[];
    }
  }, [projectFiles]);

  const allFiles = flattenFileItems(projectFiles).filter(file => {
    if (file.type !== 'file') return false;
    if (typeof isExcluded === 'function' && isExcluded(file.path)) return false;
    if (gitignoreRules && gitignoreRules.length > 0) {
      try {
        if (isPathIgnored(gitignoreRules, file.path, false)) return false;
      } catch (e) {
        // ignore errors
      }
    }
    return true;
  });

  // Enhanced VSCode-style filtering + scoring for FILES
  const filteredFiles: FileItem[] = useMemo(() => {
    if (viewMode !== 'files') return [];
    if (!searchQuery) return allFiles;
    const q = searchQuery.trim();
    const scored: Array<{ file: FileItem; score: number }> = [];

    for (const file of allFiles) {
      const fileName = file.name;
      const fileNameNoExt = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
      const pathParts = file.path.split('/');

      const nameScore = scoreMatch(fileName, q);
      const nameNoExtScore = scoreMatch(fileNameNoExt, q);
      const pathScore = scoreMatch(file.path, q);
      const partScores = pathParts.map(part => scoreMatch(part, q));
      const bestPartScore = Math.max(...partScores, 0);

      const best = Math.max(nameScore, nameNoExtScore, pathScore, bestPartScore);

      if (best > 0) {
        scored.push({ file, score: best });
      }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.file.name.localeCompare(b.file.name);
    });

    return scored.map(s => s.file);
  }, [allFiles, searchQuery, viewMode]);

  // Filtering for GENERIC ITEMS
  const filteredItems: OperationListItem[] = useMemo(() => {
    if (viewMode !== 'list' || !items) return [];
    if (!searchQuery) return items;
    const q = searchQuery.toLowerCase();

    // Simple filtering for items
    return items.filter(
      item =>
        item.label.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q))
    );
  }, [items, searchQuery, viewMode]);

  const currentListLength = viewMode === 'files' ? filteredFiles.length : filteredItems.length;

  // 選択されたアイテムにスクロールする関数
  const scrollToSelectedItem = (index: number) => {
    if (!listRef.current) return;

    const listElement = listRef.current;
    const itemHeight = ITEM_HEIGHT;
    const containerHeight = listElement.clientHeight;
    const scrollTop = listElement.scrollTop;

    const itemTop = index * itemHeight;
    const itemBottom = itemTop + itemHeight;

    if (itemTop < scrollTop) {
      listElement.scrollTop = itemTop;
    } else if (itemBottom > scrollTop + containerHeight) {
      listElement.scrollTop = itemBottom - containerHeight;
    }
  };

  // ESCキーで閉じる、上下キーで選択、Enterで開く
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isVisible) return;

      // mdプレビュー選択ダイアログが表示中
      if (mdPreviewPrompt) {
        if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          setMdDialogSelected(prev => (prev === 0 ? 1 : 0));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (mdDialogSelected === 0) {
            actuallyOpenFile(mdPreviewPrompt.file, true);
          } else {
            actuallyOpenFile(mdPreviewPrompt.file, false);
          }
          setMdPreviewPrompt(null);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setMdPreviewPrompt(null);
        }
        return;
      }

      // Editing mode in list item?
      // If an item is being edited, we might want to let the input handle keys.
      // But here we are handling global navigation.
      // Ideally, the input in the list item should stop propagation of keys it handles.

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => {
            const newIndex = prev > 0 ? prev - 1 : currentListLength - 1;
            setTimeout(() => scrollToSelectedItem(newIndex), 0);
            return newIndex;
          });
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => {
            const newIndex = prev < currentListLength - 1 ? prev + 1 : 0;
            setTimeout(() => scrollToSelectedItem(newIndex), 0);
            return newIndex;
          });
          break;
        case 'Enter':
          // If we are in the search input, or just navigating
          // We need to trigger the action of the selected item
          if (viewMode === 'files' && filteredFiles[selectedIndex]) {
            e.preventDefault();
            handleFileSelectInOperation(filteredFiles[selectedIndex]);
          } else if (viewMode === 'list' && filteredItems[selectedIndex]) {
            e.preventDefault();
            filteredItems[selectedIndex].onClick?.();
          }
          break;
      }
    };

    if (isVisible) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    isVisible,
    filteredFiles,
    filteredItems,
    selectedIndex,
    onClose,
    handleFileSelectInOperation,
    mdPreviewPrompt,
    mdDialogSelected,
    viewMode,
    currentListLength,
  ]);

  // 検索クエリが変更されたときに選択インデックスをリセット
  useEffect(() => {
    setSelectedIndex(0);
    if (onSearchList && viewMode === 'list') {
      onSearchList(searchQuery);
    }
  }, [searchQuery, viewMode]);

  // VSCode風のハイライト関数
  function highlightMatch(text: string, query: string, isSelected: boolean) {
    if (!query) return <>{text}</>;

    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const idx = lowerText.indexOf(lowerQuery);

    if (idx === -1) return <>{text}</>;

    return (
      <>
        {text.slice(0, idx)}
        <span
          style={{
            background: isSelected ? 'rgba(255,255,255,0.3)' : colors.accentBg,
            color: isSelected ? colors.cardBg : colors.primary,
            fontWeight: 'bold',
            borderRadius: '2px',
            padding: '0 1px',
          }}
        >
          {text.slice(idx, idx + query.length)}
        </span>
        {text.slice(idx + query.length)}
      </>
    );
  }

  if (!isVisible) return null;

  const jsx = (
    <>
      {/* mdプレビュー選択ダイアログ */}
      {mdPreviewPrompt && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 3000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setMdPreviewPrompt(null)}
        >
          <div
            style={{
              background: colors.cardBg,
              border: `1px solid ${colors.border}`,
              borderRadius: '8px',
              padding: '32px 24px',
              minWidth: '320px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '18px',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div
              style={{
                fontSize: '16px',
                fontWeight: 'bold',
                marginBottom: '8px',
                color: colors.foreground,
              }}
            >
              {t('operationWindow.mdPreviewPrompt')}
            </div>
            <div style={{ color: colors.mutedFg, fontSize: '13px', marginBottom: '12px' }}>
              {mdPreviewPrompt.file.name}
            </div>
            <div style={{ display: 'flex', gap: '16px' }}>
              <button
                style={{
                  padding: '8px 18px',
                  background: mdDialogSelected === 0 ? colors.primary : colors.background,
                  color: mdDialogSelected === 0 ? colors.cardBg : colors.foreground,
                  border:
                    mdDialogSelected === 0
                      ? `2px solid ${colors.accentBg}`
                      : `1px solid ${colors.border}`,
                  borderRadius: '4px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  outline: mdDialogSelected === 0 ? '2px solid ' + colors.primary : undefined,
                }}
                tabIndex={0}
                autoFocus={mdDialogSelected === 0}
                onClick={() => {
                  actuallyOpenFile(mdPreviewPrompt.file, true);
                  setMdPreviewPrompt(null);
                }}
              >
                {t('operationWindow.openInPreview')}
              </button>
              <button
                style={{
                  padding: '8px 18px',
                  background: mdDialogSelected === 1 ? colors.primary : colors.background,
                  color: mdDialogSelected === 1 ? colors.cardBg : colors.foreground,
                  border:
                    mdDialogSelected === 1
                      ? `2px solid ${colors.accentBg}`
                      : `1px solid ${colors.border}`,
                  borderRadius: '4px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  outline: mdDialogSelected === 1 ? '2px solid ' + colors.primary : undefined,
                }}
                tabIndex={0}
                autoFocus={mdDialogSelected === 1}
                onClick={() => {
                  actuallyOpenFile(mdPreviewPrompt.file, false);
                  setMdPreviewPrompt(null);
                }}
              >
                {t('operationWindow.openInEditor')}
              </button>
            </div>
            <div style={{ fontSize: '12px', color: colors.mutedFg, marginTop: '8px' }}>
              {t('operationWindow.mdPreviewDialogHelp')}
            </div>
          </div>
        </div>
      )}

      {/* Main Window Overlay */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: '100px',
          zIndex: 2000,
        }}
        onClick={onClose}
      >
        <div
          style={{
            background: colors.cardBg,
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            width: '600px',
            maxHeight: '40vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ padding: '12px' }}>
            <div
              style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', gap: '12px' }}
            >
              <div
                style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                {viewMode === 'list' && headerActions && (
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {headerActions.map((action, i) => (
                      <button
                        key={i}
                        onClick={action.onClick}
                        title={action.label}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: colors.foreground,
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          borderRadius: '4px',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = colors.mutedBg)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        {action.icon}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: '12px', color: colors.mutedFg }}>
                  {viewMode === 'files'
                    ? `${t('operationWindow.quickOpen') || 'Quick Open'} - ${formatKeyComboForDisplay('Ctrl+P')}`
                    : listTitle || 'List'}
                </div>
              </div>
            </div>

            <input
              ref={inputRef}
              type="text"
              placeholder={t('operationWindow.searchPlaceholder')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: colors.background,
                border: `1px solid ${colors.border}`,
                borderRadius: '4px',
                color: colors.foreground,
                fontSize: '14px',
                outline: 'none',
              }}
              onKeyDown={e => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault(); // Prevent cursor moving in input
                }
              }}
            />
          </div>

          {/* List Content */}
          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              minHeight: '200px',
              maxHeight: 'calc(40vh - 80px)',
            }}
          >
            {viewMode === 'files' ? (
              // FILES VIEW
              filteredFiles.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: colors.mutedFg }}>
                  {t('operationWindow.noFilesFound')}
                </div>
              ) : (
                filteredFiles.map((file, index) => {
                  const isSelected = index === selectedIndex;
                  const pathParts = file.path.split('/');
                  const dirPath = pathParts.slice(0, -1).join('/');

                  return (
                    <div
                      key={file.id}
                      style={{
                        height: ITEM_HEIGHT,
                        boxSizing: 'border-box',
                        padding: '2px 12px',
                        background: isSelected ? colors.primary : 'transparent',
                        color: isSelected ? colors.cardBg : colors.foreground,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        borderLeft: isSelected
                          ? `3px solid ${colors.accentBg}`
                          : '3px solid transparent',
                      }}
                      onClick={() => handleFileSelectInOperation(file)}
                      onMouseEnter={() => setSelectedIndex(index)}
                    >
                      <img
                        src={getIconSrcForFile(file.name)}
                        alt="icon"
                        style={{ width: 16, height: 16, flex: '0 0 16px' }}
                      />
                      <span
                        style={{
                          fontSize: '13px',
                          fontWeight: isSelected ? '600' : '400',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          minWidth: '120px',
                          maxWidth: '200px',
                        }}
                      >
                        {highlightMatch(file.name, searchQuery, isSelected)}
                      </span>
                      {dirPath && (
                        <span
                          style={{
                            fontSize: '11px',
                            color: isSelected ? 'rgba(255,255,255,0.8)' : colors.mutedFg,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            marginLeft: 'auto',
                            fontFamily: 'monospace',
                            textAlign: 'right',
                          }}
                        >
                          {highlightMatch(dirPath, searchQuery, isSelected)}
                        </span>
                      )}
                    </div>
                  );
                })
              )
            ) : // GENERIC LIST VIEW
            filteredItems.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: colors.mutedFg }}>
                {t('operationWindow.noItemsFound') || 'No items found'}
              </div>
            ) : (
              filteredItems.map((item, index) => {
                const isSelected = index === selectedIndex;

                return (
                  <div
                    key={item.id}
                    className="group"
                    style={{
                      height: ITEM_HEIGHT,
                      boxSizing: 'border-box',
                      padding: '2px 12px',
                      background: isSelected ? colors.primary : 'transparent',
                      color: isSelected ? colors.cardBg : colors.foreground,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      borderLeft: isSelected
                        ? `3px solid ${colors.accentBg}`
                        : '3px solid transparent',
                      position: 'relative',
                    }}
                    onClick={() => !item.isEditing && item.onClick?.()}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    {/* Icon */}
                    {item.icon && (
                      <div
                        style={{
                          width: 16,
                          height: 16,
                          flex: '0 0 16px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {typeof item.icon === 'string' ? (
                          <img src={item.icon} alt="" style={{ width: '100%', height: '100%' }} />
                        ) : (
                          item.icon
                        )}
                      </div>
                    )}

                    {/* Content */}
                    {item.isEditing ? (
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type="text"
                          value={item.editValue ?? item.label}
                          onChange={e => item.onEditChange?.(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.stopPropagation();
                              item.onEditConfirm?.();
                            } else if (e.key === 'Escape') {
                              e.stopPropagation();
                              item.onEditCancel?.();
                            }
                          }}
                          onClick={e => e.stopPropagation()}
                          autoFocus
                          style={{
                            flex: 1,
                            height: '18px',
                            fontSize: '13px',
                            padding: '0 4px',
                            border: `1px solid ${colors.accent}`,
                            background: colors.background,
                            color: colors.foreground,
                            borderRadius: '2px',
                            outline: 'none',
                          }}
                        />
                      </div>
                    ) : (
                      <>
                        <span
                          style={{
                            fontSize: '13px',
                            fontWeight: isSelected || item.isActive ? '600' : '400',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            flex: 1,
                          }}
                        >
                          {highlightMatch(item.label, searchQuery, isSelected)}
                        </span>
                        {item.description && (
                          <span
                            style={{
                              fontSize: '11px',
                              color: isSelected ? 'rgba(255,255,255,0.8)' : colors.mutedFg,
                              marginLeft: '8px',
                            }}
                          >
                            {highlightMatch(item.description, searchQuery, isSelected)}
                          </span>
                        )}
                      </>
                    )}

                    {/* Actions (hover or selected) */}
                    {!item.isEditing && item.actions && item.actions.length > 0 && (
                      <div
                        style={{
                          display: isSelected ? 'flex' : 'none',
                          gap: '4px',
                          marginLeft: 'auto',
                        }}
                      >
                        {item.actions.map(action => (
                          <button
                            key={action.id}
                            onClick={e => {
                              e.stopPropagation();
                              action.onClick(e);
                            }}
                            title={action.label}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: action.danger
                                ? isSelected
                                  ? '#ffcccc'
                                  : colors.destructive
                                : isSelected
                                  ? 'white'
                                  : colors.foreground,
                              cursor: 'pointer',
                              padding: '2px',
                              display: 'flex',
                              alignItems: 'center',
                              borderRadius: '3px',
                            }}
                            onMouseEnter={e =>
                              (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')
                            }
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            {action.icon}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: '8px 12px',
              borderTop: `1px solid ${colors.border}`,
              background: colors.mutedBg,
              fontSize: '12px',
              color: colors.mutedFg,
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>{t('operationWindow.footerHelp')}</span>
            <span
              style={{
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
              onClick={onClose}
              tabIndex={0}
              role="button"
            >
              {t('operationWindow.closeByEsc')}
            </span>
          </div>
        </div>
      </div>
    </>
  );

  // Render into portal element if available so the overlay will sit above main content
  if (portalEl) {
    return createPortal(jsx, portalEl);
  }

  return jsx;
}
