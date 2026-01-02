import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useTheme } from '@/context/ThemeContext';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { fileRepository } from '@/engine/core/fileRepository';
import { type GitIgnoreRule, isPathIgnored, parseGitignore } from '@/engine/core/gitignore';
import { importSingleFile } from '@/engine/import/importSingleFile';
import { useTabStore } from '@/stores/tabStore';
import type { FileItem } from '@/types';

import FileTreeContextMenu from './FileTreeContextMenu';
import FileTreeItem from './FileTreeItem';
import type { ContextMenuState, FileTreeProps, FlattenedTreeItem, StickyFolder } from './types';

const ITEM_HEIGHT = 24;

/**
 * Flattens the file tree into a linear array for virtualization.
 * Only includes visible items (children of expanded folders).
 */
function flattenTree(
  items: FileItem[],
  expandedFolders: Set<string>,
  gitignoreRules: GitIgnoreRule[] | null,
  level = 0,
  parentPath = ''
): FlattenedTreeItem[] {
  const result: FlattenedTreeItem[] = [];

  for (const item of items) {
    const isExpanded = item.type === 'folder' && expandedFolders.has(item.id);
    const isIgnored =
      gitignoreRules && gitignoreRules.length > 0
        ? isPathIgnored(gitignoreRules, item.path.replace(/^\/+/, ''), item.type === 'folder')
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
        ...flattenTree(item.children, expandedFolders, gitignoreRules, level + 1, item.path)
      );
    }
  }

  return result;
}

/**
 * Calculates sticky folders based on current scroll position.
 * Returns folders that should be "sticky" at the top of the viewport.
 */
function calculateStickyFolders(
  flattenedItems: FlattenedTreeItem[],
  scrollOffset: number
): StickyFolder[] {
  const stickyFolders: StickyFolder[] = [];
  const itemIndex = Math.floor(scrollOffset / ITEM_HEIGHT);

  if (itemIndex < 0 || itemIndex >= flattenedItems.length) {
    return stickyFolders;
  }

  // Find parent folders for the current visible item
  const currentItem = flattenedItems[itemIndex];
  if (!currentItem) return stickyFolders;

  // Trace back to find parent folders
  const parentPaths = currentItem.parentPath.split('/').filter(Boolean);
  let accPath = '';

  for (let i = 0; i < parentPaths.length; i++) {
    accPath += '/' + parentPaths[i];
    // Find the folder item with this path
    const folderItem = flattenedItems.find(
      f => f.item.type === 'folder' && f.item.path === accPath
    );
    if (folderItem) {
      stickyFolders.push({ item: folderItem.item, level: folderItem.level });
    }
  }

  return stickyFolders;
}

export default function VirtualizedFileTree({
  items,
  currentProjectName,
  currentProjectId,
  onRefresh,
  isFileSelectModal,
  onInternalFileDrop,
}: FileTreeProps) {
  const { colors } = useTheme();
  const { openTab } = useTabStore();
  const parentRef = useRef<HTMLDivElement>(null);

  // State
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isExpandedFoldersRestored, setIsExpandedFoldersRestored] = useState(false);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [gitignoreRules, setGitignoreRules] = useState<GitIgnoreRule[] | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Touch long-press handling
  const longPressTimeout = useRef<NodeJS.Timeout | null>(null);
  const touchPosition = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Flatten tree for virtualization
  const flattenedItems = useMemo(
    () => flattenTree(items, expandedFolders, gitignoreRules),
    [items, expandedFolders, gitignoreRules]
  );

  // Calculate sticky folders
  const stickyFolders = useMemo(
    () => calculateStickyFolders(flattenedItems, scrollOffset),
    [flattenedItems, scrollOffset]
  );

  // Initialize virtualizer
  const virtualizer = useVirtualizer({
    count: flattenedItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 10,
  });

  // Handle scroll for sticky folders
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollOffset(e.currentTarget.scrollTop);
  }, []);

  // Load expanded folders from localStorage
  useEffect(() => {
    if (items.length > 0 && !isExpandedFoldersRestored) {
      const saved = window.localStorage.getItem(`pyxis-expandedFolders-${currentProjectName}`);
      if (saved) {
        try {
          const arr = JSON.parse(saved);
          if (Array.isArray(arr)) {
            const validIds = arr.filter((id: string) =>
              flattenTree(items, new Set(arr), null).some(f => f.item.id === id)
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
  }, [items, currentProjectName, isExpandedFoldersRestored]);

  // Save expanded folders to localStorage
  useEffect(() => {
    if (isExpandedFoldersRestored) {
      window.localStorage.setItem(
        `pyxis-expandedFolders-${currentProjectName}`,
        JSON.stringify(Array.from(expandedFolders))
      );
    }
  }, [expandedFolders, currentProjectName, isExpandedFoldersRestored]);

  // Load .gitignore rules
  useEffect(() => {
    let mounted = true;
    const loadGitignore = async () => {
      if (!currentProjectId) {
        setGitignoreRules(null);
        return;
      }
      try {
        const gitignoreFile = await fileRepository.getFileByPath(currentProjectId, '/.gitignore');
        if (gitignoreFile && gitignoreFile.content) {
          const parsed = parseGitignore(gitignoreFile.content);
          if (mounted) setGitignoreRules(parsed);
        } else {
          if (mounted) setGitignoreRules([]);
        }
      } catch (e) {
        if (mounted) setGitignoreRules([]);
      }
    };
    loadGitignore();
    return () => {
      mounted = false;
    };
  }, [currentProjectId]);

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
    (item: FileItem) => {
      if (item.type === 'folder') {
        toggleFolder(item.id);
      } else {
        const defaultEditor =
          typeof window !== 'undefined' ? localStorage.getItem('pyxis-defaultEditor') : 'monaco';
        const kind = item.isBufferArray ? 'binary' : 'editor';
        openTab({ ...item, isCodeMirror: defaultEditor === 'codemirror' }, { kind });
      }
    },
    [toggleFolder, openTab]
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

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const importPath = targetPath ? `${targetPath}/${file.name}` : `/${file.name}`;
        const absolutePath = `/projects/${currentProjectName}${importPath}`;
        await importSingleFile(file, absolutePath, currentProjectName, currentProjectId);
      }

      if (onRefresh) setTimeout(onRefresh, 100);
    },
    [currentProjectName, currentProjectId, onRefresh]
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
      if (!currentProjectId || !currentProjectName) return;
      if (draggedItem.path === targetFolderPath) return;
      if (targetFolderPath.startsWith(draggedItem.path + '/')) return;

      try {
        const unix = terminalCommandRegistry.getUnixCommands(currentProjectName, currentProjectId);
        const oldPath = `/projects/${currentProjectName}${draggedItem.path}`;
        const newPath = `/projects/${currentProjectName}${targetFolderPath}/`;
        await unix.mv(oldPath, newPath);
        if (onRefresh) setTimeout(onRefresh, 100);
      } catch (error: any) {
        console.error('[FileTree] Failed to move file:', error);
      }
    },
    [currentProjectId, currentProjectName, onRefresh]
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
      {/* Sticky folder headers */}
      {stickyFolders.length > 0 && (
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            background: colors.cardBg,
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          {stickyFolders.map((sf, idx) => (
            <div
              key={sf.item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                padding: '0.15rem 0.2rem',
                marginLeft: `${sf.level * 12}px`,
                height: ITEM_HEIGHT,
                fontSize: '0.875rem',
                color: colors.foreground,
                background: colors.mutedBg,
                cursor: 'pointer',
              }}
              onClick={() => toggleFolder(sf.item.id)}
            >
              <span style={{ fontWeight: 500 }}>{sf.item.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Virtualized list */}
      <div
        ref={parentRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflow: 'auto',
          contain: 'strict',
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
                  hoveredItemId={hoveredItemId}
                  colors={colors}
                  currentProjectName={currentProjectName}
                  currentProjectId={currentProjectId}
                  onRefresh={onRefresh}
                  onItemClick={handleItemClick}
                  onContextMenu={handleContextMenu}
                  onTouchStart={handleTouchStart}
                  onTouchEnd={handleTouchEnd}
                  onTouchMove={handleTouchMove}
                  setHoveredItemId={setHoveredItemId}
                  handleNativeFileDrop={handleNativeFileDrop}
                  handleDragOver={handleDragOver}
                  onInternalFileDrop={internalDropHandler}
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
          currentProjectName={currentProjectName}
          currentProjectId={currentProjectId}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
}
