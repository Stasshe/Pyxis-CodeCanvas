import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import MdPreviewDialog from '@/components/Top/MdPreviewDialog';
import OperationVirtualList from '@/components/Top/OperationWindow/OperationVirtualList';
import { useTranslation } from '@/context/I18nContext';
import type { ThemeColors } from '@/context/ThemeContext';
import { useTheme } from '@/context/ThemeContext';
import { formatKeyComboForDisplay } from '@/hooks/keybindings/useKeyBindings';
import { tabActions } from '@/stores/tabState';
import type { FileItem } from '@/types';
import type { OperationListItem, OperationWindowView } from './types';

import { useFileSearch } from './useFileSearch';

export type { OperationListItem, OperationWindowView } from './types';

function getViewButtonStyle(selected: boolean, colors: ThemeColors): React.CSSProperties {
  let color = colors.mutedFg;
  let background = 'transparent';
  if (selected) {
    color = colors.primary;
    background = colors.accentBg;
  }
  return {
    border: 0,
    borderRadius: 3,
    padding: '4px 8px',
    color,
    background,
    cursor: 'pointer',
  };
}

interface OperationWindowProps {
  onClose: () => void;
  projectFiles: FileItem[];
  onFileSelect?: (file: FileItem, preview?: boolean) => void | Promise<void>; // AI file-selection callback
  aiMode?: boolean; // Select files without opening editor tabs
  targetPaneId?: string | null; // Pane that receives opened files

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
  views?: OperationWindowView[];
  initialViewId?: string;
  showViewSelector?: boolean;
}

export default function OperationWindow({
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
  views = [],
  initialViewId,
  showViewSelector = false,
}: OperationWindowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mdPreviewPrompt, setMdPreviewPrompt] = useState<null | { file: FileItem }>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [mdDialogSelected, setMdDialogSelected] = useState<0 | 1>(0); // 0: preview, 1: editor
  const getInitialViewId = () => {
    if (initialViewId) return initialViewId;
    if (initialView === 'list') return 'list';
    return 'files';
  };
  const [activeViewId, setActiveViewId] = useState<string>(getInitialViewId);
  let viewMode: 'files' | 'list' = 'list';
  if (activeViewId === 'files') viewMode = 'files';
  const activeView = views.find(view => view.id === activeViewId);
  const isBusy = isActing || activeView?.loading === true;
  const onEnterRef = useRef(activeView?.onEnter);
  onEnterRef.current = activeView?.onEnter;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [portalEl] = useState(() =>
    typeof document !== 'undefined' ? document.createElement('div') : null
  );
  // Split the query on whitespace so every token must match.
  const queryTokens = useMemo(() => searchQuery.trim().split(/\s+/).filter(Boolean), [searchQuery]);
  const ITEM_HEIGHT = 20;

  // Reset state on mount. Visibility is controlled by the parent mounting/unmounting this window.
  useEffect(() => {
    setSearchQuery('');
    setSelectedIndex(0);
    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => window.clearTimeout(timeoutId);
  }, []);

  // Attach a top-level portal element to document.body so the overlay isn't clipped
  useEffect(() => {
    if (!portalEl) return;
    portalEl.className = 'pyxis-operation-window-portal';
    // ensure portal container doesn't interfere with layout
    portalEl.style.position = 'relative';
    portalEl.style.zIndex = '99999';
    document.body.appendChild(portalEl);
    return () => {
      document.body.removeChild(portalEl);
    };
  }, [portalEl]);

  // Open a file either in preview mode or in the editor.
  const actuallyOpenFile = useCallback(
    async (file: FileItem, preview: boolean) => {
      if (onFileSelect) await onFileSelect(file, preview);
      else {
        const defaultEditor = localStorage.getItem('pyxis-defaultEditor');
        const fileWithEditor = { ...file, isCodeMirror: defaultEditor === 'codemirror' };
        const options = targetPaneId
          ? { paneId: targetPaneId, kind: preview ? 'preview' : 'editor' }
          : { kind: preview ? 'preview' : 'editor' };
        await tabActions.openTab(fileWithEditor, options);
      }
      onClose();
    },
    [onFileSelect, onClose, targetPaneId]
  );

  const runAction = useCallback(
    async (action: () => void | Promise<void>) => {
      if (isBusy) return;
      setActionError(null);
      setIsActing(true);
      try {
        await action();
      } catch (error) {
        console.error('[OperationWindow] Action failed', error);
        let message = String(error);
        if (error instanceof Error) message = error.message;
        setActionError(message);
      } finally {
        setIsActing(false);
      }
    },
    [isBusy]
  );

  const openFile = useCallback(
    (file: FileItem, preview: boolean) => runAction(() => actuallyOpenFile(file, preview)),
    [actuallyOpenFile, runAction]
  );

  const activateItem = useCallback(
    (item: OperationListItem) =>
      runAction(() => {
        if (activeView?.onActivate) return activeView.onActivate(item);
        return item.onClick?.();
      }),
    [activeView, runAction]
  );

  const handleFileSelectInOperation = useCallback(
    (file: FileItem) => {
      // AI file selection does not need the Markdown preview prompt.
      if (aiMode) {
        void openFile(file, false);
        return;
      }

      if (file.name.toLowerCase().endsWith('.md')) {
        setMdPreviewPrompt({ file });
        return;
      }
      void openFile(file, false);
    },
    [openFile, aiMode]
  );

  const fileSearch = useFileSearch(projectFiles, queryTokens, viewMode === 'files');
  const filteredFiles = fileSearch.files;

  // Filtering for GENERIC ITEMS (support multi-token AND search)
  const filteredItems: OperationListItem[] = useMemo(() => {
    const sourceItems = activeView?.items ?? items ?? [];
    if (viewMode !== 'list') return [];
    if (!queryTokens || queryTokens.length === 0) return sourceItems;

    const lowerTokens = queryTokens.map(t => t.toLowerCase());

    return sourceItems.filter(item => {
      const label = item.label.toLowerCase();
      const desc = item.description?.toLowerCase() ?? '';
      // require every token to be found in either label or description
      return lowerTokens.every(tok => label.includes(tok) || desc.includes(tok));
    });
  }, [activeView, items, queryTokens, viewMode]);

  const currentListLength = viewMode === 'files' ? filteredFiles.length : filteredItems.length;

  useEffect(() => {
    setSelectedIndex(index => Math.min(index, Math.max(currentListLength - 1, 0)));
  }, [currentListLength]);

  const selectView = (id: string) => {
    if (isBusy || id === activeViewId) return;
    setActiveViewId(id);
    setSearchQuery('');
    setSelectedIndex(0);
    setActionError(null);
  };

  useEffect(() => {
    const onEnter = onEnterRef.current;
    if (!onEnter) return;
    let isCurrent = true;
    setActionError(null);
    setIsActing(true);
    Promise.resolve()
      .then(() => onEnter())
      .catch(error => {
        console.error(`[OperationWindow] Failed to enter ${activeViewId}`, error);
        let message = String(error);
        if (error instanceof Error) message = error.message;
        if (isCurrent) setActionError(message);
      })
      .finally(() => {
        if (isCurrent) setIsActing(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [activeViewId]);

  // Escape closes the window; arrow keys move selection and Enter activates it.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle keyboard input while the Markdown preview prompt is open.
      if (mdPreviewPrompt) {
        if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          setMdDialogSelected(prev => (prev === 0 ? 1 : 0));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (mdDialogSelected === 0) {
            void openFile(mdPreviewPrompt.file, true);
          } else {
            void openFile(mdPreviewPrompt.file, false);
          }
          setMdPreviewPrompt(null);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setMdPreviewPrompt(null);
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      const target = e.target;
      if (
        target instanceof HTMLElement &&
        target !== inputRef.current &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName))
      )
        return;

      // Editing mode in list item?
      // If an item is being edited, we might want to let the input handle keys.
      // But here we are handling global navigation.
      // Ideally, the input in the list item should stop propagation of keys it handles.

      switch (e.key) {
        case 'ArrowUp':
          if (currentListLength === 0) break;
          e.preventDefault();
          setSelectedIndex(prev => (prev > 0 ? prev - 1 : currentListLength - 1));
          break;
        case 'ArrowDown':
          if (currentListLength === 0) break;
          e.preventDefault();
          setSelectedIndex(prev => (prev < currentListLength - 1 ? prev + 1 : 0));
          break;
        case 'Enter':
          // If we are in the search input, or just navigating
          // We need to trigger the action of the selected item
          if (viewMode === 'files' && filteredFiles[selectedIndex]) {
            e.preventDefault();
            handleFileSelectInOperation(filteredFiles[selectedIndex]);
          } else if (viewMode === 'list' && filteredItems[selectedIndex]) {
            e.preventDefault();
            void activateItem(filteredItems[selectedIndex]);
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    filteredFiles,
    filteredItems,
    selectedIndex,
    onClose,
    handleFileSelectInOperation,
    mdPreviewPrompt,
    mdDialogSelected,
    viewMode,
    currentListLength,
    openFile,
    activateItem,
  ]);

  // Reset selection when the query changes.
  useEffect(() => {
    setSelectedIndex(0);
    if (onSearchList && viewMode === 'list' && !activeView) {
      onSearchList(searchQuery);
    }
  }, [searchQuery, viewMode, onSearchList, activeView]);

  const jsx = (
    <>
      <MdPreviewDialog
        prompt={mdPreviewPrompt}
        mdDialogSelected={mdDialogSelected}
        setMdDialogSelected={setMdDialogSelected}
        actuallyOpenFile={openFile}
        setMdPreviewPrompt={setMdPreviewPrompt}
        colors={colors}
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
          padding: '6vh 12px 0',
          zIndex: 2000,
        }}
        onClick={onClose}
      >
        <div
          style={{
            background: colors.cardBg,
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            maxHeight: 'min(88vh, 720px)',
            width: 'min(680px, calc(100vw - 24px))',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ padding: '12px', minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                marginBottom: '8px',
                gap: '8px',
                minWidth: 0,
              }}
            >
              {showViewSelector && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', minWidth: 0 }}>
                  <button
                    type="button"
                    onClick={() => selectView('files')}
                    disabled={isBusy}
                    aria-pressed={viewMode === 'files'}
                    style={getViewButtonStyle(viewMode === 'files', colors)}
                  >
                    Files
                  </button>
                  {views.map(view => (
                    <button
                      type="button"
                      key={view.id}
                      onClick={() => selectView(view.id)}
                      disabled={isBusy}
                      aria-pressed={activeViewId === view.id}
                      style={getViewButtonStyle(activeViewId === view.id, colors)}
                    >
                      {view.title}
                    </button>
                  ))}
                </div>
              )}
              <div
                style={{
                  marginLeft: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  flexWrap: 'wrap',
                  gap: '8px',
                  flex: '1 1 220px',
                  minWidth: 0,
                }}
              >
                {viewMode === 'list' && (activeView?.headerActions ?? headerActions) && (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'flex-end',
                      gap: '4px',
                      minWidth: 0,
                    }}
                  >
                    {(activeView?.headerActions ?? headerActions ?? []).map(action => (
                      <button
                        key={action.label}
                        onClick={() => void runAction(action.onClick)}
                        disabled={isBusy}
                        title={action.label}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: colors.foreground,
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'flex',
                          flexWrap: 'wrap',
                          justifyContent: 'center',
                          gap: '4px',
                          minWidth: 0,
                          alignItems: 'center',
                          borderRadius: '4px',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = colors.mutedBg)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        {action.icon}
                        <span>{action.label}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div
                  style={{
                    fontSize: '12px',
                    color: colors.mutedFg,
                    minWidth: 0,
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {viewMode === 'files'
                    ? `${t('operationWindow.quickOpen') || 'Quick Open'} - ${formatKeyComboForDisplay('Ctrl+P')}`
                    : (activeView?.title ?? listTitle ?? 'List')}
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
                boxSizing: 'border-box',
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

          {viewMode === 'list' && activeView?.breadcrumb && (
            <fieldset disabled={isBusy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              {activeView.breadcrumb}
            </fieldset>
          )}
          {(actionError ?? fileSearch.error ?? activeView?.error) && (
            <div
              role="alert"
              style={{
                padding: '8px 12px',
                color: colors.destructive,
                borderTop: `1px solid ${colors.border}`,
              }}
            >
              {actionError ?? fileSearch.error ?? activeView?.error}
            </div>
          )}

          <OperationVirtualList
            viewMode={viewMode}
            filteredFiles={filteredFiles}
            filteredItems={filteredItems}
            selectedIndex={selectedIndex}
            setSelectedIndex={setSelectedIndex}
            handleFileSelectInOperation={handleFileSelectInOperation}
            ITEM_HEIGHT={ITEM_HEIGHT}
            colors={colors}
            queryTokens={queryTokens}
            onActivateItem={item => void activateItem(item)}
            loading={isBusy}
            emptyMessage={activeView?.emptyMessage}
            disabled={isBusy}
            t={t}
            listRef={listRef}
          />

          {viewMode === 'list' && activeView?.footer && (
            <fieldset disabled={isBusy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              {activeView.footer}
            </fieldset>
          )}

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
