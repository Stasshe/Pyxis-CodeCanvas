import type React from 'react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { parseFileSearchQuery } from '@/components/Top/OperationWindow/fileSearchUtils';
import OperationVirtualList from '@/components/Top/OperationWindow/OperationVirtualList';
import { useTranslation } from '@/context/I18nContext';
import type { ThemeColors } from '@/context/ThemeContext';
import { useTheme } from '@/context/ThemeContext';
import { registerQuickInputShortcut, triggerAction } from '@/hooks/keybindings/useKeyBindings';
import { getCurrentRootPath } from '@/stores/projectStore';
import { tabActions, tabState } from '@/stores/tabState';
import type { FileItem } from '@/types';
import type { OperationHeaderAction, OperationListItem, OperationWindowView } from './types';
import { useFileSearch } from './useFileSearch';

export type { OperationListItem, OperationWindowView } from './types';

interface OperationWindowProps {
  onClose: () => void;
  projectFiles: FileItem[];
  onFileSelect?: (file: FileItem, preview?: boolean) => void | Promise<void>;
  targetPaneId?: string | null;
  items?: OperationListItem[];
  headerActions?: (Pick<OperationHeaderAction, 'icon' | 'label' | 'onClick'> & { id?: string })[];
  listTitle?: string;
  initialView?: 'files' | 'list';
  views?: OperationWindowView[];
  initialViewId?: string;
}

function getInitialViewId(initialViewId?: string, initialView?: 'files' | 'list'): string {
  if (initialViewId) return initialViewId;
  if (initialView === 'list') return 'list';
  return 'files';
}

function moveSelection(index: number, amount: number, length: number): number {
  if (length === 0) return 0;
  const nextIndex = index + amount;
  if (nextIndex < 0) return length - 1;
  if (nextIndex >= length) return 0;
  return nextIndex;
}

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'input:not(:disabled), button:not(:disabled), [tabindex="0"]'
    )
  ).filter(element => element.getClientRects().length > 0);
}

export default function OperationWindow({
  onClose,
  projectFiles,
  onFileSelect,
  targetPaneId,
  items,
  headerActions,
  listTitle,
  initialView,
  views = [],
  initialViewId,
}: OperationWindowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActioning, setIsActioning] = useState(false);
  const [isEntering, setIsEntering] = useState(false);
  const actionBusyRef = useRef(false);
  const [activeViewId] = useState(() => getInitialViewId(initialViewId, initialView));
  const activeView = views.find(view => view.id === activeViewId);
  const isFilesView = activeViewId === 'files';
  const isActionBusy = isActioning || activeView?.actionBusy === true;
  const isBusy = isActionBusy || isEntering || activeView?.loading === true;
  const inputValue = activeView?.input?.value ?? searchQuery;
  const parsedQuery = useMemo(() => parseFileSearchQuery(inputValue), [inputValue]);
  let queryTokens = parsedQuery.tokens;
  if (activeView?.input) queryTokens = [];
  const fileSearch = useFileSearch(projectFiles, queryTokens, isFilesView);
  const filteredFiles = fileSearch.files;
  const inputElementId = useId().replaceAll(':', '');
  const listId = `${inputElementId}-listbox`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef(true);
  const [portalEl] = useState(() => {
    if (typeof document === 'undefined') return null;
    return document.createElement('div');
  });
  const sourceItems = activeView?.items ?? items ?? [];
  const filteredItems = useMemo(() => {
    if (isFilesView) return [];
    if (activeView?.input) return sourceItems;
    if (queryTokens.length === 0) return sourceItems;
    const lowerTokens = queryTokens.map(token => token.toLocaleLowerCase());
    return sourceItems.filter(item => {
      const label = item.label.toLocaleLowerCase();
      let description = '';
      if (item.description) description = item.description.toLocaleLowerCase();
      return lowerTokens.every(token => label.includes(token) || description.includes(token));
    });
  }, [activeView?.input, isFilesView, queryTokens, sourceItems]);
  let currentListLength = filteredItems.length;
  if (isFilesView) currentListLength = filteredFiles.length;
  let selectedOptionId: string | undefined;
  if (currentListLength > 0) selectedOptionId = `${listId}-option-${selectedIndex}`;
  const rootPath = getCurrentRootPath();
  const viewHeaderActions = activeView?.headerActions ?? headerActions ?? [];
  let viewMode: 'files' | 'list' = 'list';
  if (isFilesView) viewMode = 'files';

  const [portalMount, setPortalMount] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!portalEl) return;
    portalEl.className = 'pyxis-operation-window-portal';
    document.body.appendChild(portalEl);
    setPortalMount(portalEl);
    return () => {
      document.body.removeChild(portalEl);
    };
  }, [portalEl]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const focusTimeout = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);

    return () => {
      window.clearTimeout(focusTimeout);
      if (!restoreFocusRef.current || !(previousFocus instanceof HTMLElement)) return;
      window.setTimeout(() => {
        const pickerStillOpen = document.querySelector('[data-keybinding-scope="quick-input"]');
        if (!pickerStillOpen && previousFocus.isConnected) previousFocus.focus();
      }, 0);
    };
  }, []);

  useEffect(() => {
    if (!portalMount) return;
    const handleOutsideInteraction = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && dialogRef.current?.contains(target)) return;
      if (actionBusyRef.current || activeView?.actionBusy) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      restoreFocusRef.current = true;
      onClose();
    };
    document.addEventListener('pointerdown', handleOutsideInteraction, true);
    document.addEventListener('click', handleOutsideInteraction, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideInteraction, true);
      document.removeEventListener('click', handleOutsideInteraction, true);
    };
  }, [activeView?.actionBusy, onClose, portalMount]);

  const closePicker = useCallback(() => {
    if (actionBusyRef.current || activeView?.actionBusy) return;
    restoreFocusRef.current = true;
    onClose();
  }, [activeView?.actionBusy, onClose]);

  const runAction = useCallback(
    async (action: () => void | Promise<void>, closeAfterSuccess = false) => {
      if (isBusy || actionBusyRef.current) return;
      setActionError(null);
      actionBusyRef.current = true;
      setIsActioning(true);
      try {
        await action();
        if (closeAfterSuccess) restoreFocusRef.current = false;
      } catch (error) {
        console.error('[OperationWindow] Action failed', error);
        let message = String(error);
        if (error instanceof Error) message = error.message;
        setActionError(message);
        restoreFocusRef.current = true;
      } finally {
        actionBusyRef.current = false;
        setIsActioning(false);
      }
    },
    [isBusy]
  );

  const actuallyOpenFile = useCallback(
    async (file: FileItem, openBeside: boolean) => {
      if (onFileSelect) {
        await onFileSelect(file, false);
        restoreFocusRef.current = false;
        onClose();
        return;
      }

      let fileToOpen = file;
      const editorPreference = localStorage.getItem('pyxis-defaultEditor');
      fileToOpen = { ...fileToOpen, isCodeMirror: editorPreference === 'codemirror' };
      if (openBeside && targetPaneId) {
        await tabActions.splitPaneAndOpenFile(targetPaneId, 'vertical', fileToOpen, 'after');
        const tabId = tabState.globalActiveTab;
        const paneId = tabState.activePane;
        if (
          tabId &&
          paneId &&
          (parsedQuery.line !== undefined || parsedQuery.column !== undefined)
        ) {
          const jump: { jumpToLine?: number; jumpToColumn?: number } = {};
          if (parsedQuery.line !== undefined) jump.jumpToLine = parsedQuery.line;
          if (parsedQuery.column !== undefined) jump.jumpToColumn = parsedQuery.column;
          tabActions.updateTab(paneId, tabId, jump);
        }
        restoreFocusRef.current = false;
        onClose();
        return;
      }
      let kind: 'editor' | 'binary' = 'editor';
      if (file.isBufferArray || file.bufferContent) kind = 'binary';
      const options: {
        paneId?: string;
        kind: 'editor' | 'binary';
        jumpToLine?: number;
        jumpToColumn?: number;
      } = { kind };
      if (targetPaneId) options.paneId = targetPaneId;
      if (parsedQuery.line !== undefined) options.jumpToLine = parsedQuery.line;
      if (parsedQuery.column !== undefined) options.jumpToColumn = parsedQuery.column;
      await tabActions.openTab(fileToOpen, options);
      restoreFocusRef.current = false;
      onClose();
    },
    [onClose, onFileSelect, parsedQuery.column, parsedQuery.line, targetPaneId]
  );

  const openFile = useCallback(
    (file: FileItem, openBeside = false) =>
      runAction(() => actuallyOpenFile(file, openBeside), true),
    [actuallyOpenFile, runAction]
  );

  const activateItem = useCallback(
    (item: OperationListItem) => {
      restoreFocusRef.current = false;
      void runAction(async () => {
        if (activeView?.onActivate) {
          await activeView.onActivate(item);
          return;
        }
        await item.onClick?.();
      }, true);
    },
    [activeView, runAction]
  );

  const confirmInput = useCallback(
    (selectedItem?: OperationListItem) => {
      const input = activeView?.input;
      if (!input) return;
      restoreFocusRef.current = false;
      void runAction(() => input.onConfirm(selectedItem), true);
    },
    [activeView, runAction]
  );

  const handleFileSelect = useCallback(
    (file: FileItem, openBeside = false) => {
      void openFile(file, openBeside);
    },
    [openFile]
  );

  const activateSelected = useCallback(
    (openBeside = false) => {
      if (isFilesView) {
        const file = filteredFiles[selectedIndex];
        if (file) handleFileSelect(file, openBeside);
        return;
      }

      const item = filteredItems[selectedIndex];
      if (activeView?.input) {
        confirmInput(item);
        return;
      }
      if (item) activateItem(item);
    },
    [
      activateItem,
      activeView?.input,
      confirmInput,
      filteredFiles,
      filteredItems,
      handleFileSelect,
      isFilesView,
      selectedIndex,
    ]
  );

  const queryChange = (value: string) => {
    setSelectedIndex(0);
    setActionError(null);
    if (activeView?.input) {
      activeView.input.onChange(value);
      return;
    }
    setSearchQuery(value);
  };

  useEffect(() => {
    if (!portalMount) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    return registerQuickInputShortcut(dialog, action => {
      if (action === 'quickOpen' && isFilesView) {
        setSelectedIndex(index => moveSelection(index, 1, currentListLength));
        inputRef.current?.focus();
        return;
      }
      restoreFocusRef.current = false;
      onClose();
      triggerAction(action);
    });
  }, [currentListLength, isFilesView, onClose, portalMount]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || !dialogRef.current?.contains(target)) return;
      const isQueryInput = target === inputRef.current;
      const isRowEditor = target.matches('[data-operation-edit]');
      if (isRowEditor) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePicker();
        return;
      }

      if (event.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = getFocusableElements(dialog);
        if (focusable.length === 0) return;
        const currentIndex = focusable.indexOf(target);
        let nextIndex = currentIndex + 1;
        if (event.shiftKey) nextIndex = currentIndex - 1;
        if (nextIndex < 0) nextIndex = focusable.length - 1;
        if (nextIndex >= focusable.length) nextIndex = 0;
        event.preventDefault();
        focusable[nextIndex].focus();
        return;
      }

      if (isQueryInput && (event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        activateSelected(isFilesView);
        return;
      }

      const hasNavigationModifier = event.ctrlKey || event.metaKey || event.altKey;
      if (
        isQueryInput &&
        !hasNavigationModifier &&
        (event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        event.preventDefault();
        let direction = 1;
        if (event.key === 'ArrowUp') direction = -1;
        setSelectedIndex(index => moveSelection(index, direction, currentListLength));
        return;
      }

      if (isQueryInput && !hasNavigationModifier && (event.key === 'Home' || event.key === 'End')) {
        event.preventDefault();
        if (event.key === 'Home') setSelectedIndex(0);
        if (event.key === 'End') setSelectedIndex(Math.max(currentListLength - 1, 0));
        return;
      }

      if (
        isQueryInput &&
        !hasNavigationModifier &&
        (event.key === 'PageUp' || event.key === 'PageDown')
      ) {
        event.preventDefault();
        let direction = 10;
        if (event.key === 'PageUp') direction = -10;
        setSelectedIndex(index => {
          if (currentListLength === 0) return 0;
          return Math.min(Math.max(index + direction, 0), currentListLength - 1);
        });
        return;
      }

      if (isQueryInput && event.key === 'Enter') {
        event.preventDefault();
        activateSelected();
      }
    },
    [activateSelected, closePicker, currentListLength, isFilesView]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  useEffect(() => {
    setSelectedIndex(index => Math.min(index, Math.max(currentListLength - 1, 0)));
  }, [currentListLength]);

  const onEnterRef = useRef(activeView?.onEnter);
  onEnterRef.current = activeView?.onEnter;
  useEffect(() => {
    const onEnter = onEnterRef.current;
    if (!onEnter) return;
    let isCurrent = true;
    setActionError(null);
    setIsEntering(true);
    Promise.resolve()
      .then(() => onEnter())
      .catch(error => {
        console.error(`[OperationWindow] Failed to enter ${activeViewId}`, error);
        let message = String(error);
        if (error instanceof Error) message = error.message;
        if (isCurrent) setActionError(message);
      })
      .finally(() => {
        if (isCurrent) setIsEntering(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [activeViewId]);

  const setSelectedFromMouse = (index: number) => setSelectedIndex(index);
  const renderedInput = activeView?.input;
  let inputPlaceholder =
    activeView?.placeholder ?? listTitle ?? t('operationWindow.searchPlaceholder');
  if (renderedInput) inputPlaceholder = renderedInput.placeholder;
  const inputAriaLabel = activeView?.title ?? listTitle ?? t('operationWindow.quickOpen');
  const currentError = actionError ?? fileSearch.error ?? activeView?.error;
  const actionButtons = viewHeaderActions.map(action => {
    let cursor = 'pointer';
    if (isBusy) cursor = 'default';
    return (
      <button
        key={action.id ?? action.label}
        type="button"
        aria-label={action.label}
        title={action.label}
        disabled={isBusy}
        onClick={() => {
          const selectedItem = filteredItems[selectedIndex];
          restoreFocusRef.current = false;
          void runAction(() => action.onClick(selectedItem), true);
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 28,
          height: 28,
          padding: '0 6px',
          color: colors.foreground,
          background: 'transparent',
          border: 0,
          cursor,
        }}
      >
        {action.icon}
        <span style={{ marginLeft: 4, fontSize: 12 }}>{action.label}</span>
      </button>
    );
  });

  const content = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={activeView?.title ?? listTitle ?? t('operationWindow.quickOpen')}
      aria-busy={isBusy}
      data-keybinding-scope="quick-input"
      data-busy={isActionBusy}
      data-quick-input-root="true"
      style={{
        position: 'fixed',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(600px, calc(100vw - 16px))',
        maxHeight: 'calc(100dvh - 16px)',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: colors.cardBg,
        color: colors.foreground,
        border: `1px solid ${colors.border}`,
        borderRadius: 4,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
        zIndex: 2000,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: 6, minWidth: 0 }}>
        <input
          id={inputElementId}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={inputAriaLabel}
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={selectedOptionId}
          autoComplete="off"
          spellCheck={false}
          placeholder={inputPlaceholder}
          value={inputValue}
          disabled={isActionBusy}
          onChange={event => queryChange(event.target.value)}
          onFocus={event => {
            event.currentTarget.style.borderColor = colors.primary;
            event.currentTarget.style.boxShadow = `0 0 0 1px ${colors.primary}`;
          }}
          onBlur={event => {
            event.currentTarget.style.borderColor = colors.border;
            event.currentTarget.style.boxShadow = '';
          }}
          style={{
            flex: 1,
            minWidth: 0,
            height: 30,
            boxSizing: 'border-box',
            padding: '6px 8px',
            color: colors.foreground,
            background: colors.background,
            border: `1px solid ${colors.border}`,
            borderRadius: 2,
            fontSize: 14,
            outline: 'none',
          }}
        />
      </div>

      {(activeView?.showTitle || actionButtons.length > 0) && (
        <div
          style={{
            minHeight: 28,
            display: 'flex',
            alignItems: 'center',
            padding: '0 6px 4px',
            gap: 4,
            flexWrap: 'wrap',
          }}
        >
          {activeView?.showTitle && (
            <span style={{ color: colors.mutedFg, fontSize: 12, padding: '0 4px' }}>
              {activeView.title}
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {actionButtons}
          </div>
        </div>
      )}

      {currentError && (
        <div
          role="alert"
          style={{
            padding: '4px 12px',
            color: colors.destructive,
            fontSize: 12,
            borderTop: `1px solid ${colors.border}`,
          }}
        >
          {currentError}
        </div>
      )}

      <OperationVirtualList
        viewMode={viewMode}
        filteredFiles={filteredFiles}
        filteredItems={filteredItems}
        selectedIndex={selectedIndex}
        setSelectedIndex={setSelectedFromMouse}
        handleFileSelectInOperation={file => handleFileSelect(file)}
        ITEM_HEIGHT={22}
        colors={colors}
        queryTokens={queryTokens}
        onActivateItem={activateItem}
        loading={isBusy}
        emptyMessage={activeView?.emptyMessage}
        disabled={isBusy}
        t={t}
        listId={listId}
        rootPath={rootPath}
        listRef={listRef}
      />

      {activeView?.footer && (
        <fieldset
          disabled={isBusy}
          style={{ border: 0, borderTop: `1px solid ${colors.border}`, padding: 0, margin: 0 }}
        >
          {activeView.footer}
        </fieldset>
      )}
    </div>
  );

  if (portalMount) return createPortal(content, portalMount);
  return content;
}
