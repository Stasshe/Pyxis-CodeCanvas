import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { basename, fsClient, resolvePath } from '@/engine/core/fs';
import { type GitIgnoreRule, isPathIgnored, parseGitignore } from '@/engine/core/gitignore';
import { importSingleFile } from '@/engine/in-ex/importSingleFile';
import { tabActions } from '@/stores/tabState';
import type { FileItem } from '@/types';

import FileTreeContextMenu from './FileTreeContextMenu';
import FileTreeItem from './FileTreeItem';
import { fileTreeErrorMessage, reportFileTreeError } from './fileTreeErrors';
import type { ContextMenuState, FileTreeProps, FlattenedTreeItem } from './types';

const ITEM_HEIGHT = 24;

/**
 * Flattens the file tree into a linear array for virtualization.
 * Only includes visible items (children of expanded folders).
 */
function flattenTree(
  items: FileItem[],
  expandedFolders: Set<string>,
  gitignoreRules: GitIgnoreRule[] | null,
  rootPath: string,
  level = 0,
  parentPath = ''
): FlattenedTreeItem[] {
  const result: FlattenedTreeItem[] = [];

  for (const item of items) {
    const isExpanded = item.type === 'folder' && expandedFolders.has(item.id);
    const isIgnored =
      gitignoreRules && gitignoreRules.length > 0
        ? isPathIgnored(
            gitignoreRules,
            item.path.slice(rootPath.length).replace(/^\/+/, ''),
            item.type === 'folder'
          )
        : false;

    result.push({
      item,
      level,
      isExpanded,
      isIgnored,
      parentPath,
    });

    // Recursively add children if folder is expanded
    if (isExpanded && item.children) {
      result.push(
        ...flattenTree(
          item.children,
          expandedFolders,
          gitignoreRules,
          rootPath,
          level + 1,
          item.path
        )
      );
    }
  }

  return result;
}

export default function VirtualizedFileTree({
  items,
  rootPath,
  onRefresh,
  isFileSelectModal,
  onInternalFileDrop,
}: FileTreeProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { openTab } = tabActions;
  const parentRef = useRef<HTMLDivElement>(null);
  const rootPathRef = useRef(rootPath);
  rootPathRef.current = rootPath;

  // State
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isExpandedFoldersRestored, setIsExpandedFoldersRestored] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [gitignoreRules, setGitignoreRules] = useState<GitIgnoreRule[] | null>(null);
  const contextMenuRootPath = useRef(rootPath);

  useEffect(() => {
    if (contextMenuRootPath.current === rootPath) return;
    contextMenuRootPath.current = rootPath;
    setContextMenu(null);
  }, [rootPath]);

  // Touch long-press handling
  const longPressTimeout = useRef<NodeJS.Timeout | null>(null);
  const touchPosition = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Detect touch device once at this level (avoid per-item listeners in FileTreeItem)
  const [isTouchDevice, setIsTouchDevice] = useState<boolean>(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const check = () => {
      setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
    };
    check();
  }, []);

  // Flatten tree for virtualization
  const flattenedItems = useMemo(
    () => flattenTree(items, expandedFolders, gitignoreRules, rootPath),
    [items, expandedFolders, gitignoreRules, rootPath]
  );

  // Initialize virtualizer with fixed size for smoother scrolling
  const virtualizer = useVirtualizer({
    count: flattenedItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 5, // Reduced overscan for better performance
  });

  // Load expanded folders from localStorage
  useEffect(() => {
    if (items.length > 0 && !isExpandedFoldersRestored) {
      const saved = window.localStorage.getItem(`pyxis-expandedFolders-${rootPath}`);
      if (saved) {
        try {
          const arr = JSON.parse(saved);
          if (Array.isArray(arr)) {
            const validIds = arr.filter((id: string) =>
              flattenTree(items, new Set(arr), null, rootPath).some(f => f.item.id === id)
            );
            setExpandedFolders(new Set(validIds));
            setIsExpandedFoldersRestored(true);
            return;
          }
        } catch {}
      }
      // Default: expand root folders
      const rootFolders = items.filter(item => item.type === 'folder');
      setExpandedFolders(new Set(rootFolders.map(f => f.id)));
      setIsExpandedFoldersRestored(true);
    }
  }, [items, rootPath, isExpandedFoldersRestored]);

  // Save expanded folders to localStorage
  useEffect(() => {
    if (isExpandedFoldersRestored) {
      window.localStorage.setItem(
        `pyxis-expandedFolders-${rootPath}`,
        JSON.stringify(Array.from(expandedFolders))
      );
    }
  }, [expandedFolders, rootPath, isExpandedFoldersRestored]);

  // Load .gitignore rules
  useEffect(() => {
    let mounted = true;
    const loadGitignore = async () => {
      try {
        const gitignorePath = resolvePath(rootPath, '.gitignore');
        if (await fsClient.exists(gitignorePath)) {
          const parsed = parseGitignore(await fsClient.readText(gitignorePath));
          if (mounted) setGitignoreRules(parsed);
        } else {
          if (mounted) setGitignoreRules([]);
        }
      } catch (e) {
        console.warn('[VirtualizedFileTree.tsx] caught non-fatal error', e);
        if (mounted) setGitignoreRules([]);
      }
    };
    loadGitignore();
    return () => {
      mounted = false;
    };
  }, [rootPath]);

  // Toggle folder expansion
  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) {
        newSet.delete(folderId);
      } else {
        newSet.add(folderId);
      }
      return newSet;
    });
  }, []);

  // Handle item click
  const handleItemClick = useCallback(
    async (item: FileItem) => {
      if (item.type === 'folder') {
        toggleFolder(item.id);
      } else {
        const defaultEditor =
          typeof window !== 'undefined' ? localStorage.getItem('pyxis-defaultEditor') : 'monaco';
        const kind = item.isBufferArray ? 'binary' : 'editor';
        await openTab({ ...item, isCodeMirror: defaultEditor === 'codemirror' }, { kind });
      }
    },
    [toggleFolder]
  );

  // Handle context menu
  const handleContextMenu = useCallback((e: React.MouseEvent, item: FileItem) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  }, []);

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent, item: FileItem) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchPosition.current = { x: touch.clientX, y: touch.clientY };
      longPressTimeout.current = setTimeout(() => {
        setContextMenu({ x: touch.clientX, y: touch.clientY, item });
      }, 500);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimeout.current) {
      clearTimeout(longPressTimeout.current);
      longPressTimeout.current = null;
    }
  }, []);

  const handleTouchMove = useCallback(() => {
    if (longPressTimeout.current) {
      clearTimeout(longPressTimeout.current);
      longPressTimeout.current = null;
    }
  }, []);

  // Native file drop handler
  const handleNativeFileDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>, targetPath?: string) => {
      const hasFiles = e.dataTransfer.files && e.dataTransfer.files.length > 0;
      const hasItems = e.dataTransfer.items && e.dataTransfer.items.length > 0;
      const hasNativeFiles =
        hasItems && Array.from(e.dataTransfer.items).some(item => item.kind === 'file');

      if (!hasFiles && !hasNativeFiles) return;

      e.preventDefault();
      e.stopPropagation();

      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;

      const dropRootPath = rootPath;
      try {
        const destinationDirectory = targetPath ?? dropRootPath;
        if (!isPathWithinRoot(destinationDirectory, dropRootPath)) {
          throw new Error(t('fileTree.alert.workspaceChanged'));
        }
        for (const file of Array.from(files)) {
          if (rootPathRef.current !== dropRootPath) {
            throw new Error(t('fileTree.alert.workspaceChanged'));
          }
          const absolutePath = resolvePath(destinationDirectory, file.name);
          if (rootPathRef.current !== dropRootPath) {
            throw new Error(t('fileTree.alert.workspaceChanged'));
          }
          await importSingleFile(
            file,
            absolutePath,
            t('fileTree.alert.destinationExists', { params: { path: absolutePath } }),
            () => rootPathRef.current === dropRootPath,
            t('fileTree.alert.workspaceChanged')
          );
        }
        if (onRefresh) setTimeout(onRefresh, 100);
      } catch (error) {
        reportFileTreeError(
          t('fileTree.alert.operationFailed', {
            params: {
              action: t('fileTree.action.import'),
              error: fileTreeErrorMessage(error, path =>
                t('fileTree.alert.destinationExists', { params: { path } })
              ),
            },
          })
        );
      }
    },
    [rootPath, onRefresh, t]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const hasNativeFiles = e.dataTransfer.types.includes('Files');
    if (hasNativeFiles) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  // Internal file drop handler (drag-and-drop between items)
  const internalDropHandler = useCallback(
    async (draggedItem: FileItem, targetFolderPath: string) => {
      const operationRootPath = rootPath;
      if (draggedItem.path === targetFolderPath) return;
      if (targetFolderPath.startsWith(`${draggedItem.path}/`)) return;

      try {
        if (
          rootPathRef.current !== operationRootPath ||
          !isPathWithinRoot(draggedItem.path, operationRootPath) ||
          !isPathWithinRoot(targetFolderPath, operationRootPath)
        ) {
          throw new Error(t('fileTree.alert.workspaceChanged'));
        }
        const newPath = resolvePath(targetFolderPath, basename(draggedItem.path));
        if (await fsClient.exists(newPath)) {
          throw new Error(t('fileTree.alert.destinationExists', { params: { path: newPath } }));
        }
        if (
          rootPathRef.current !== operationRootPath ||
          !isPathWithinRoot(draggedItem.path, operationRootPath) ||
          !isPathWithinRoot(targetFolderPath, operationRootPath)
        ) {
          throw new Error(t('fileTree.alert.workspaceChanged'));
        }
        await fsClient.rename(draggedItem.path, newPath, { overwrite: false });
        if (onRefresh) setTimeout(onRefresh, 100);
      } catch (error) {
        reportFileTreeError(
          t('fileTree.alert.operationFailed', {
            params: {
              action: t('fileTree.action.move'),
              error: fileTreeErrorMessage(error, path =>
                t('fileTree.alert.destinationExists', { params: { path } })
              ),
            },
          })
        );
      }
    },
    [onRefresh, rootPath, t]
  );

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      style={{
        position: 'relative',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
      onDrop={e => handleNativeFileDrop(e)}
      onDragOver={handleDragOver}
    >
      {/* Virtualized list - uses native scrolling without scroll event handlers */}
      <div
        ref={parentRef}
        style={{
          flex: 1,
          overflow: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualItems.map(virtualItem => {
            const flatItem = flattenedItems[virtualItem.index];
            if (!flatItem) return null;

            return (
              <div
                key={flatItem.item.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <FileTreeItem
                  item={flatItem.item}
                  level={flatItem.level}
                  isExpanded={flatItem.isExpanded}
                  isIgnored={flatItem.isIgnored}
                  colors={colors}
                  rootPath={rootPath}
                  onRefresh={onRefresh}
                  onItemClick={handleItemClick}
                  onContextMenu={handleContextMenu}
                  onTouchStart={handleTouchStart}
                  onTouchEnd={handleTouchEnd}
                  onTouchMove={handleTouchMove}
                  handleNativeFileDrop={handleNativeFileDrop}
                  handleDragOver={handleDragOver}
                  onInternalFileDrop={internalDropHandler}
                  isTouchDevice={isTouchDevice}
                />
              </div>
            );
          })}
        </div>

        {/* Empty area for context menu on blank space */}
        {!isFileSelectModal && (
          <div
            style={{
              minHeight: '300px',
              cursor: 'default',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              MozUserSelect: 'none',
              msUserSelect: 'none',
              userSelect: 'none',
            }}
            onClick={() => setContextMenu(null)}
            onContextMenu={e => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, item: null });
            }}
            onTouchStart={e => {
              if (e.touches.length === 1) {
                const touch = e.touches[0];
                touchPosition.current = { x: touch.clientX, y: touch.clientY };
                longPressTimeout.current = setTimeout(() => {
                  setContextMenu({ x: touch.clientX, y: touch.clientY, item: null });
                }, 500);
              }
            }}
            onTouchEnd={handleTouchEnd}
            onDrop={handleNativeFileDrop}
            onDragOver={handleDragOver}
          />
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <FileTreeContextMenu
          contextMenu={contextMenu}
          setContextMenu={setContextMenu}
          rootPath={rootPath}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
}

function isPathWithinRoot(path: string, rootPath: string): boolean {
  return path === rootPath || path.startsWith(`${rootPath.replace(/\/$/, '')}/`);
}
