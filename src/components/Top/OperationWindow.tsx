'use client';

import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { flattenFileItems, scoreMatch } from '@/components/Top/OperationUtils';
import OperationList from '@/components/Top/OperationList';
import MdPreviewDialog from '@/components/Top/MdPreviewDialog';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { isPathIgnored, parseGitignore } from '@/engine/core/gitignore';
import { formatKeyComboForDisplay } from '@/hooks/useKeyBindings';
import { useSettings } from '@/hooks/useSettings';
import { useTabStore } from '@/stores/tabStore';
import type { FileItem } from '@/types';

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
  // 検索クエリをスペースで分割してトークンにする（スペースは区切り）
  const queryTokens = useMemo(() => searchQuery.trim().split(/\s+/).filter(Boolean), [searchQuery]);
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
  const actuallyOpenFile = async (file: FileItem, preview: boolean) => {
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
        await store.openTab(fileWithEditor, options as any);
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

  // Enhanced VSCode-style filtering + scoring for FILES (support multi-token search where space is a separator)
  const filteredFiles: FileItem[] = useMemo(() => {
    if (viewMode !== 'files') return [];
    if (!queryTokens || queryTokens.length === 0) return allFiles;

    const scored: Array<{ file: FileItem; score: number }> = [];

    for (const file of allFiles) {
      let totalScore = 0;
      let matchedAll = true;

      for (const token of queryTokens) {
        const fileName = file.name;
        const fileNameNoExt = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
        const pathParts = file.path.split('/');

        const nameScore = scoreMatch(fileName, token);
        const nameNoExtScore = scoreMatch(fileNameNoExt, token);
        const pathScore = scoreMatch(file.path, token);
        const partScores = pathParts.map(part => scoreMatch(part, token));
        const bestPartScore = Math.max(...partScores, 0);

        const best = Math.max(nameScore, nameNoExtScore, pathScore, bestPartScore);

        if (best <= 0) {
          matchedAll = false;
          break;
        }

        totalScore += best;
      }

      if (matchedAll) {
        // average score across tokens for stable sorting
        scored.push({ file, score: totalScore / queryTokens.length });
      }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.file.name.localeCompare(b.file.name);
    });

    return scored.map(s => s.file);
  }, [allFiles, queryTokens, viewMode]);

  // Filtering for GENERIC ITEMS (support multi-token AND search)
  const filteredItems: OperationListItem[] = useMemo(() => {
    if (viewMode !== 'list' || !items) return [];
    if (!queryTokens || queryTokens.length === 0) return items;

    const lowerTokens = queryTokens.map(t => t.toLowerCase());

    return items.filter(item => {
      const label = item.label.toLowerCase();
      const desc = item.description?.toLowerCase() ?? '';
      // require every token to be found in either label or description
      return lowerTokens.every(tok => label.includes(tok) || desc.includes(tok));
    });
  }, [items, queryTokens, viewMode]);

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

    // highlight helper moved to '@/components/OperationWindow.helpers'
  if (!isVisible) return null;

  const jsx = (
    <>
      <MdPreviewDialog
        prompt={mdPreviewPrompt}
        mdDialogSelected={mdDialogSelected}
        setMdDialogSelected={setMdDialogSelected}
        actuallyOpenFile={actuallyOpenFile}
        setMdPreviewPrompt={setMdPreviewPrompt}
        colors={colors}
        t={t}
      />

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

          <OperationList
            viewMode={viewMode}
            filteredFiles={filteredFiles}
            filteredItems={filteredItems}
            selectedIndex={selectedIndex}
            setSelectedIndex={setSelectedIndex}
            handleFileSelectInOperation={handleFileSelectInOperation}
            ITEM_HEIGHT={ITEM_HEIGHT}
            colors={colors}
            queryTokens={queryTokens}
            t={t}
          />
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
