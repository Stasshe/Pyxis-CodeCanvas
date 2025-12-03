import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { getIconForFile, getIconForFolder, getIconForOpenFolder } from 'vscode-icons-js';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { fileRepository } from '@/engine/core/fileRepository';
import { parseGitignore, isPathIgnored, GitIgnoreRule } from '@/engine/core/gitignore';
import { exportFolderZip } from '@/engine/export/exportFolderZip';
import { exportSingleFile } from '@/engine/export/exportSingleFile';
import { importSingleFile } from '@/engine/import/importSingleFile';
import { useTabStore } from '@/stores/tabStore';
import { FileItem } from '@/types';

// react-dnd用のドラッグタイプ定数
const FILE_TREE_ITEM = 'FILE_TREE_ITEM';

// ドラッグアイテムの型定義
interface DragItem {
  type: string;
  item: FileItem;
}

interface FileTreeProps {
  items: FileItem[];
  level?: number;
  currentProjectName: string;
  currentProjectId?: string;
  onRefresh?: () => void; // [NEW ARCHITECTURE] ファイルツリー再読み込み用
  isFileSelectModal?: boolean;
  // 内部移動用のコールバック（親から渡される）
  onInternalFileDrop?: (draggedItem: FileItem, targetFolderPath: string) => void;
}

// 個別のファイルツリーアイテムコンポーネント（react-dnd対応）
interface FileTreeItemProps {
  item: FileItem;
  level: number;
  isExpanded: boolean;
  isIgnored: boolean;
  hoveredItemId: string | null;
  colors: any;
  currentProjectName: string;
  currentProjectId?: string;
  onRefresh?: () => void;
  onItemClick: (item: FileItem) => void;
  onContextMenu: (e: React.MouseEvent, item: FileItem) => void;
  onTouchStart: (e: React.TouchEvent, item: FileItem) => void;
  onTouchEnd: () => void;
  onTouchMove: () => void;
  setHoveredItemId: (id: string | null) => void;
  handleNativeFileDrop: (e: React.DragEvent<HTMLDivElement>, targetPath?: string) => void;
  handleDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onInternalFileDrop?: (draggedItem: FileItem, targetFolderPath: string) => void;
}

function FileTreeItem({
  item,
  level,
  isExpanded,
  isIgnored,
  hoveredItemId,
  colors,
  currentProjectName,
  currentProjectId,
  onRefresh,
  onItemClick,
  onContextMenu,
  onTouchStart,
  onTouchEnd,
  onTouchMove,
  setHoveredItemId,
  handleNativeFileDrop,
  handleDragOver,
  onInternalFileDrop,
}: FileTreeItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dropIndicator, setDropIndicator] = useState<boolean>(false);

  // ドラッグソース
  const [{ isDragging }, drag] = useDrag(
    () => ({
      type: FILE_TREE_ITEM,
      item: { type: FILE_TREE_ITEM, item },
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
      }),
    }),
    [item]
  );

  // ドロップターゲット（フォルダのみ）
  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: FILE_TREE_ITEM,
      canDrop: (dragItem: DragItem) => {
        // フォルダでない場合はドロップ不可
        if (item.type !== 'folder') return false;
        // 自分自身へのドロップは不可
        if (dragItem.item.id === item.id) return false;
        // 自分の子孫へのドロップは不可
        if (item.path.startsWith(dragItem.item.path + '/')) return false;
        // 自分の親フォルダへのドロップも不可（移動しても意味がない）
        const draggedParent = dragItem.item.path.substring(0, dragItem.item.path.lastIndexOf('/')) || '/';
        if (draggedParent === item.path) return false;
        return true;
      },
      drop: (dragItem: DragItem) => {
        console.log('[FileTreeItem] drop called', { dragItem, targetPath: item.path, itemType: item.type, hasHandler: !!onInternalFileDrop });
        if (onInternalFileDrop && item.type === 'folder') {
          onInternalFileDrop(dragItem.item, item.path);
        }
      },
      collect: (monitor) => ({
        isOver: monitor.isOver({ shallow: true }),
        canDrop: monitor.canDrop(),
      }),
    }),
    [item, onInternalFileDrop]
  );

  // ドラッグとドロップのrefを結合
  drag(drop(ref));

  // ドロップインジケーターの更新
  useEffect(() => {
    setDropIndicator(isOver && canDrop);
  }, [isOver, canDrop]);

  return (
    <div
      onDrop={item.type === 'folder' ? e => handleNativeFileDrop(e, item.path) : undefined}
      onDragOver={item.type === 'folder' ? handleDragOver : undefined}
    >
      <div
        ref={ref}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
          padding: '0.15rem 0.2rem',
          cursor: isDragging ? 'grabbing' : 'pointer',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
          position: 'relative',
          background: dropIndicator
            ? colors.accentBg
            : hoveredItemId === item.id
              ? colors.accentBg
              : 'transparent',
          marginLeft: `${level * 12}px`,
          touchAction: 'manipulation',
          opacity: isDragging ? 0.5 : 1,
          border: dropIndicator ? `1px dashed ${colors.primary || '#007acc'}` : '1px solid transparent',
        }}
        onClick={() => onItemClick(item)}
        onContextMenu={e => onContextMenu(e, item)}
        onMouseEnter={() => setHoveredItemId(item.id)}
        onMouseLeave={() => setHoveredItemId(null)}
        onTouchStart={e => {
          onTouchStart(e, item);
          setHoveredItemId(item.id);
        }}
        onTouchEnd={() => {
          onTouchEnd();
          setHoveredItemId(null);
        }}
        onTouchMove={() => {
          onTouchMove();
          setHoveredItemId(null);
        }}
        onTouchCancel={() => {
          onTouchEnd();
          setHoveredItemId(null);
        }}
      >
        {item.type === 'folder' ? (
          <>
            {isExpanded ? (
              <ChevronDown
                size={14}
                color={colors.mutedFg}
              />
            ) : (
              <ChevronRight
                size={14}
                color={colors.mutedFg}
              />
            )}
            <img
              src={(() => {
                const iconPath = isExpanded
                  ? getIconForOpenFolder(item.name) ||
                    getIconForFolder(item.name) ||
                    getIconForFolder('')
                  : getIconForFolder(item.name) || getIconForFolder('');
                if (iconPath && iconPath.endsWith('.svg')) {
                  return `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/${iconPath
                    .split('/')
                    .pop()}`;
                }
                return `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/folder.svg`;
              })()}
              alt="folder"
              style={{
                width: 16,
                height: 16,
                verticalAlign: 'middle',
                opacity: isIgnored ? 0.55 : 1,
              }}
            />
          </>
        ) : (
          <>
            <div className="w-3.5"></div>
            <img
              src={(() => {
                const iconPath = getIconForFile(item.name) || getIconForFile('');
                if (iconPath && iconPath.endsWith('.svg')) {
                  return `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/${iconPath
                    .split('/')
                    .pop()}`;
                }
                return `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/file.svg`;
              })()}
              alt="file"
              style={{
                width: 16,
                height: 16,
                verticalAlign: 'middle',
                opacity: isIgnored ? 0.55 : 1,
              }}
            />
          </>
        )}
        <span
          style={{
            fontSize: '0.875rem',
            color: isIgnored ? colors.mutedFg : colors.foreground,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            userSelect: 'none',
          }}
        >
          {item.name}
        </span>
      </div>
      {item.type === 'folder' && item.children && isExpanded && (
        <FileTree
          items={item.children}
          level={level + 1}
          currentProjectName={currentProjectName}
          currentProjectId={currentProjectId}
          onRefresh={onRefresh}
          onInternalFileDrop={onInternalFileDrop}
        />
      )}
    </div>
  );
}

export default function FileTree({
  items,
  level = 0,
  currentProjectName,
  currentProjectId,
  onRefresh,
  isFileSelectModal,
  onInternalFileDrop,
}: FileTreeProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { openTab } = useTabStore();
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [menuHoveredIdx, setMenuHoveredIdx] = useState<number | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isExpandedFoldersRestored, setIsExpandedFoldersRestored] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: FileItem | null;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [gitignoreRules, setGitignoreRules] = useState<GitIgnoreRule[] | null>(null);

  // ドラッグ&ドロップ用(フォルダ対応)
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>, targetPath?: string) => {
    e.preventDefault();
    e.stopPropagation();
    const items = e.dataTransfer.items;

    if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
      // フォルダD&D対応: FileSystem API を使って再帰的に処理
      const ensureFoldersExist = async (projectId: string | undefined, folderPath: string) => {
        if (!projectId) return;
        const parts = folderPath.split('/').filter(Boolean);
        let acc = '';
        for (const part of parts) {
          acc += '/' + part;
          try {
            // ignore errors (already existsなど)
            // createFile は folder を作るために利用
            await fileRepository.createFile(projectId, acc, '', 'folder');
          } catch (err) {
            // noop
          }
        }
      };

      const traverseFileTree = async (entry: any, basePath: string) => {
        if (entry.isFile) {
          await new Promise<void>((res, rej) => {
            entry.file(async (file: File) => {
              try {
                const importPath = `${basePath}${file.name}`.replace(/\\/g, '/');
                const absolutePath = `/projects/${currentProjectName}${importPath}`;
                const lastSlash = importPath.lastIndexOf('/');
                if (lastSlash > 0) {
                  const folderPath = importPath.substring(0, lastSlash);
                  await ensureFoldersExist(currentProjectId, folderPath);
                }
                await importSingleFile(file, absolutePath, currentProjectName, currentProjectId);
                res();
              } catch (err) {
                rej(err);
              }
            });
          });
        } else if (entry.isDirectory) {
          const dirPath = `${basePath}${entry.name}/`;
          await ensureFoldersExist(currentProjectId, dirPath);
          const dirReader = entry.createReader();

          // readEntries は配列を返すが、ブラウザによっては複数回呼ぶ必要があるためループで取得
          let entries: any[] = await new Promise<any[]>(res => dirReader.readEntries(res));
          while (entries && entries.length > 0) {
            for (const e of entries) {
              await traverseFileTree(e, dirPath);
            }
            entries = await new Promise<any[]>(res => dirReader.readEntries(res));
          }
        }
      };

      const traverseAll = async () => {
        for (let i = 0; i < items.length; i++) {
          const entry = items[i].webkitGetAsEntry();
          if (entry) {
            const startPath = targetPath ? `${targetPath}/` : '/';
            await traverseFileTree(entry, startPath);
          }
        }
      };

      await traverseAll();
      // [NEW ARCHITECTURE] ファイルツリー再読み込み
      if (onRefresh) {
        setTimeout(onRefresh, 100);
      }
    } else {
      // 通常のファイルD&D
      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const importPath = targetPath ? `${targetPath}/${file.name}` : `/${file.name}`;
        const absolutePath = `/projects/${currentProjectName}${importPath}`;
        await importSingleFile(file, absolutePath, currentProjectName, currentProjectId);
      }

      // [NEW ARCHITECTURE] ファイルツリー再読み込み
      if (onRefresh) {
        setTimeout(onRefresh, 100);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // expandedFoldersをlocalStorageに保存(初回復元後のみ)
  useEffect(() => {
    if (level === 0 && isExpandedFoldersRestored) {
      const arr = Array.from(expandedFolders);
      window.localStorage.setItem(
        `pyxis-expandedFolders-${currentProjectName}`,
        JSON.stringify(arr)
      );
    }
  }, [expandedFolders, level, currentProjectName, isExpandedFoldersRestored]);

  // .gitignore を読み込んでルールを解析する
  // NOTE: FileTree は UI コンポーネントなのでコマンドキャッシュを使わず、
  // 単一ファイル取得 API (getFileByPath) を使って効率的に読み込む。
  useEffect(() => {
    let mounted = true;
    const loadGitignore = async () => {
      if (!currentProjectId) {
        setGitignoreRules(null);
        return;
      }
      try {
        // 単一ファイル取得を使って .gitignore を読み込む（全件取得は避ける）
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

    // only reload when project changes; avoid reloading on every items change to reduce overhead
    loadGitignore();

    return () => {
      mounted = false;
    };
  }, [currentProjectId]);

  // 初回読み込み時にlocalStorageからexpandedFoldersを復元(itemsが空の場合はスキップ)
  useEffect(() => {
    if (level === 0 && items && items.length > 0 && !isExpandedFoldersRestored) {
      const saved = window.localStorage.getItem(`pyxis-expandedFolders-${currentProjectName}`);
      if (saved) {
        try {
          const arr = JSON.parse(saved);
          if (Array.isArray(arr)) {
            const validIds = arr.filter((id: string) => items.some(item => item.id === id));
            setExpandedFolders(new Set(validIds));
            setIsExpandedFoldersRestored(true);
            return;
          }
        } catch {}
      }
      // なければ従来通りルートフォルダ展開
      const rootFolders = items.filter((item: FileItem) => item.type === 'folder');
      const expandedIds = new Set<string>(rootFolders.map((folder: FileItem) => folder.id));
      setExpandedFolders(expandedIds);
      setIsExpandedFoldersRestored(true);
    }
  }, [items, level, currentProjectName, isExpandedFoldersRestored]);

  // コンテキストメニュー外クリックで閉じる
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    if (contextMenu) {
      document.addEventListener('mousedown', handleClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleClick);
    };
  }, [contextMenu]);

  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) {
        newSet.delete(folderId);
      } else {
        newSet.add(folderId);
      }
      return newSet;
    });
  };

  const handleItemClick = (item: FileItem) => {
    if (item.type === 'folder') {
      toggleFolder(item.id);
    } else {
      const defaultEditor =
        typeof window !== 'undefined' ? localStorage.getItem('pyxis-defaultEditor') : 'monaco';
      // バイナリファイルは binary タブで開く
      const kind = item.isBufferArray ? 'binary' : 'editor';
      openTab({ ...item, isCodeMirror: defaultEditor === 'codemirror' }, { kind });
    }
  };

  const handleContextMenu = (e: React.MouseEvent, item: FileItem) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  };

  const handlePreview = (item: FileItem) => {
    setContextMenu(null);
    if (item.type === 'file' && item.name.endsWith('.md')) {
      openTab(item, { kind: 'preview' });
    }
  };

  const handleWebPreview = (item: FileItem) => {
    setContextMenu(null);
    if (item.type === 'file' || item.type === 'folder') {
      console.log('[FileTree] Opening webPreview for item:', {
        name: item.name,
        path: item.path,
        type: item.type,
        projectName: currentProjectName,
      });
      openTab(item, { kind: 'webPreview', projectName: currentProjectName });
    }
  };

  // タッチ長押し用のタイマー管理
  const longPressTimeout = useRef<NodeJS.Timeout | null>(null);
  const touchPosition = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleTouchStart = (e: React.TouchEvent, item: FileItem) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchPosition.current = { x: touch.clientX, y: touch.clientY };
      longPressTimeout.current = setTimeout(() => {
        setContextMenu({ x: touch.clientX, y: touch.clientY, item });
      }, 500);
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimeout.current) {
      clearTimeout(longPressTimeout.current);
      longPressTimeout.current = null;
    }
  };

  const handleTouchMove = () => {
    if (longPressTimeout.current) {
      clearTimeout(longPressTimeout.current);
      longPressTimeout.current = null;
    }
  };

  // react-dnd: ファイル/フォルダをドロップターゲットに移動する
  // propsから渡されている場合はそれを使用、そうでなければ自前のハンドラーを使用
  const internalDropHandler = onInternalFileDrop ?? (async (draggedItem: FileItem, targetFolderPath: string) => {
    console.log('[FileTree] internalDropHandler called', { draggedItem, targetFolderPath, currentProjectId, currentProjectName });
    
    if (!currentProjectId) {
      console.warn('[FileTree] No currentProjectId, cannot move file');
      return;
    }
    
    // 自分自身への移動は無視
    if (draggedItem.path === targetFolderPath) {
      console.log('[FileTree] Same path, ignoring move');
      return;
    }
    
    // ドラッグしたアイテムを自分の子フォルダに移動しようとしている場合は無視
    if (targetFolderPath.startsWith(draggedItem.path + '/')) {
      console.log('[FileTree] Cannot move to child folder');
      return;
    }
    
    try {
      const unix = terminalCommandRegistry.getUnixCommands(
        currentProjectName,
        currentProjectId
      );
      
      const oldPath = `/projects/${currentProjectName}${draggedItem.path}`;
      const newPath = `/projects/${currentProjectName}${targetFolderPath}/`;
      
      console.log('[FileTree] Moving file/folder:', { oldPath, newPath });
      
      // mvコマンドを使用（ファイルもフォルダも正しく移動できる）
      const result = await unix.mv(oldPath, newPath);
      console.log('[FileTree] Move result:', result);
      
      if (onRefresh) {
        console.log('[FileTree] Refreshing file tree');
        setTimeout(onRefresh, 100);
      }
    } catch (error: any) {
      console.error('[FileTree] Failed to move file:', error);
    }
  });

  return (
    <div
      style={
        level === 0
          ? {
              position: 'relative',
              minHeight: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
            }
          : {}
      }
      onDrop={level === 0 ? e => handleDrop(e) : undefined}
      onDragOver={level === 0 ? handleDragOver : undefined}
    >
      {items.map(item => {
        const isExpanded = expandedFolders.has(item.id);
        const isIgnored =
          gitignoreRules && gitignoreRules.length > 0
            ? isPathIgnored(gitignoreRules, item.path.replace(/^\/+/, ''), item.type === 'folder')
            : false;
        return (
          <FileTreeItem
            key={item.id}
            item={item}
            level={level}
            isExpanded={isExpanded}
            isIgnored={isIgnored}
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
            handleNativeFileDrop={handleDrop}
            handleDragOver={handleDragOver}
            onInternalFileDrop={internalDropHandler}
          />
        );
      })}

      {/* 空白領域を追加(最上位レベルのみ) */}
      {level === 0 && !isFileSelectModal && (
        <div
          style={{
            flex: 1,
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
          onTouchEnd={() => {
            if (longPressTimeout.current) {
              clearTimeout(longPressTimeout.current);
              longPressTimeout.current = null;
            }
          }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        />
      )}

      {/* コンテキストメニュー(item: null の場合は空白領域用) */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{
            position: 'fixed',
            zIndex: 50,
            background: colors.cardBg,
            border: `1px solid ${colors.border}`,
            borderRadius: '0.5rem',
            minWidth: '120px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            top: contextMenu.y,
            left: contextMenu.x,
            padding: '2px 0',
          }}
        >
          <ul className="py-0">
            {/* build menu items with keys to avoid comparing translated strings */}
            {(() => {
              const menuItems: Array<{ key: string; label: string }> =
                contextMenu && contextMenu.item == null
                  ? [
                        { key: 'createFile', label: t('fileTree.menu.createFile') },
                        { key: 'createFolder', label: t('fileTree.menu.createFolder') },
                        { key: 'importFiles', label: t('fileTree.menu.importFiles') },
                        { key: 'importFolder', label: t('fileTree.menu.importFolder') },
                      ]
                  : ([
                      contextMenu && contextMenu.item && contextMenu.item.type === 'file'
                        ? { key: 'open', label: t('fileTree.menu.open') }
                        : null,
                      contextMenu &&
                      contextMenu.item &&
                      contextMenu.item.type === 'file' &&
                      contextMenu.item.name.endsWith('.md')
                        ? { key: 'openPreview', label: t('fileTree.menu.openPreview') }
                        : null,
                      contextMenu && contextMenu.item && contextMenu.item.type === 'file'
                        ? { key: 'openCodeMirror', label: t('fileTree.menu.openCodeMirror') }
                        : null,
                      { key: 'download', label: t('fileTree.menu.download') },
                      { key: 'importFiles', label: t('fileTree.menu.importFiles') },
                      { key: 'importFolder', label: t('fileTree.menu.importFolder') },
                      { key: 'rename', label: t('fileTree.menu.rename') },
                      { key: 'delete', label: t('fileTree.menu.delete') },
                      contextMenu && contextMenu.item && contextMenu.item.type === 'folder'
                        ? { key: 'createFolder', label: t('fileTree.menu.createFolder') }
                        : null,
                      contextMenu && contextMenu.item && contextMenu.item.type === 'folder'
                        ? { key: 'createFile', label: t('fileTree.menu.createFile') }
                        : null,
                      { key: 'webPreview', label: t('fileTree.menu.webPreview') },
                    ].filter(Boolean) as Array<{ key: string; label: string }>);

              const handleMenuAction = async (key: string, menuItem: FileItem | null) => {
                setContextMenu(null);
                const unix = terminalCommandRegistry.getUnixCommands(
                  currentProjectName,
                  currentProjectId || ''
                );

                if (key === 'createFile') {
                  const fileName = prompt(t('fileTree.prompt.newFileName'));
                  if (fileName && currentProjectId) {
                    const newFilePath = fileName.startsWith('/') ? fileName : '/' + fileName;
                    await fileRepository.createFile(currentProjectId, newFilePath, '', 'file');
                    if (onRefresh) setTimeout(onRefresh, 100);
                  }
                  return;
                }

                if (key === 'createFolder') {
                  const folderName = prompt(t('fileTree.prompt.newFolderName'));
                  if (folderName && currentProjectId) {
                    const newFolderPath = folderName.startsWith('/')
                      ? folderName
                      : '/' + folderName;
                    await fileRepository.createFile(currentProjectId, newFolderPath, '', 'folder');
                    if (onRefresh) setTimeout(onRefresh, 100);
                  }
                  return;
                }

                if (key === 'importFiles' && !menuItem) {
                  const input = document.createElement('input');
                  input.type = 'file';
                  // select multiple files only (no directory picker)
                  input.multiple = true;
                  input.onchange = async (e: any) => {
                    const files: FileList = e.target.files;
                    if (!files || files.length === 0) return;

                    const ensureFoldersExistLocal = async (
                      projectId: string | undefined,
                      folderPath: string
                    ) => {
                      if (!projectId) return;
                      const parts = folderPath.split('/').filter(Boolean);
                      let acc = '';
                      for (const part of parts) {
                        acc += '/' + part;
                        try {
                          await fileRepository.createFile(projectId, acc, '', 'folder');
                        } catch (err) {
                          // ignore
                        }
                      }
                    };

                    for (let i = 0; i < files.length; i++) {
                      const file = files[i];
                      const targetPath = '/' + file.name;
                      const targetAbsolutePath = `/projects/${currentProjectName}${targetPath}`;
                      // ensure parent folders exist (root-level so usually none)
                      const lastSlash = targetPath.lastIndexOf('/');
                      if (lastSlash > 0) {
                        const folderPath = targetPath.substring(0, lastSlash);
                        await ensureFoldersExistLocal(currentProjectId, folderPath);
                      }
                      await importSingleFile(file, targetAbsolutePath, currentProjectName, currentProjectId);
                    }
                    if (onRefresh) setTimeout(onRefresh, 100);
                  };
                  input.click();
                  return;
                }

                if (key === 'importFolder' && !menuItem) {
                  const input = document.createElement('input');
                  input.type = 'file';
                  // allow selecting a folder (and its files)
                  input.multiple = true;
                  input.setAttribute('webkitdirectory', '');
                  input.setAttribute('directory', '');
                  input.onchange = async (e: any) => {
                    const files: FileList = e.target.files;
                    if (!files || files.length === 0) return;

                    const ensureFoldersExistLocal = async (
                      projectId: string | undefined,
                      folderPath: string
                    ) => {
                      if (!projectId) return;
                      const parts = folderPath.split('/').filter(Boolean);
                      let acc = '';
                      for (const part of parts) {
                        acc += '/' + part;
                        try {
                          await fileRepository.createFile(projectId, acc, '', 'folder');
                        } catch (err) {
                          // ignore
                        }
                      }
                    };

                    for (let i = 0; i < files.length; i++) {
                      const file = files[i];
                      const relative = (file as any).webkitRelativePath || file.name;
                      const relPathParts = relative.split('/').filter(Boolean);
                      const targetPath = '/' + relPathParts.join('/');
                      const targetAbsolutePath = `/projects/${currentProjectName}${targetPath}`;
                      // ensure parent folders exist
                      const lastSlash = targetPath.lastIndexOf('/');
                      if (lastSlash > 0) {
                        const folderPath = targetPath.substring(0, lastSlash);
                        await ensureFoldersExistLocal(currentProjectId, folderPath);
                      }
                      await importSingleFile(
                        file,
                        targetAbsolutePath,
                        currentProjectName,
                        currentProjectId
                      );
                    }
                    if (onRefresh) setTimeout(onRefresh, 100);
                  };
                  input.click();
                  return;
                }

                // actions for existing item
                if (!menuItem) return;

                if (key === 'open') {
                  // バイナリファイルは binary、そうでなければ editor
                  const kind =
                    menuItem && (menuItem as FileItem).isBufferArray ? 'binary' : 'editor';
                  openTab(menuItem, { kind });
                } else if (key === 'openPreview') {
                  handlePreview(menuItem);
                } else if (key === 'openCodeMirror') {
                  if (menuItem && menuItem.type === 'file') {
                    // CodeMirrorはテキスト向け。バイナリの場合は binary で開く。
                    if ((menuItem as FileItem).isBufferArray) {
                      openTab(menuItem, { kind: 'binary' });
                    } else {
                      openTab({ ...menuItem, isCodeMirror: true }, { kind: 'editor' });
                    }
                  }
                } else if (key === 'download') {
                  const item = menuItem;
                  if (item.type === 'file') {
                    let content = item.content;
                    if (typeof content !== 'string') content = 'error fetching content';
                    exportSingleFile({
                      name: item.name,
                      content,
                      isBufferArray: item.isBufferArray,
                      bufferContent: item.bufferContent,
                    });
                  } else if (item.type === 'folder') {
                    await exportFolderZip(item);
                  }
                } else if (key === 'importFiles') {
                  // import files into a target (menuItem must exist)
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.multiple = true;
                  input.onchange = async (e: any) => {
                    const files: FileList = e.target.files;
                    if (!files || files.length === 0) return;
                    let baseTargetDir = '';
                    if (menuItem) {
                      if (menuItem.type === 'file')
                        baseTargetDir =
                          menuItem.path.substring(0, menuItem.path.lastIndexOf('/')) || '/';
                      else if (menuItem.type === 'folder') baseTargetDir = menuItem.path || '/';
                    }
                    const ensureFoldersExistLocal = async (
                      projectId: string | undefined,
                      folderPath: string
                    ) => {
                      if (!projectId) return;
                      const parts = folderPath.split('/').filter(Boolean);
                      let acc = '';
                      for (const part of parts) {
                        acc += '/' + part;
                        try {
                          await fileRepository.createFile(projectId, acc, '', 'folder');
                        } catch (err) {
                          // ignore
                        }
                      }
                    };
                    for (let i = 0; i < files.length; i++) {
                      const file = files[i];
                      const relPath = file.name;
                      const normalizedBase = baseTargetDir.endsWith('/')
                        ? baseTargetDir.slice(0, -1)
                        : baseTargetDir;
                      const targetAbsolutePath =
                        `/projects/${currentProjectName}${normalizedBase}/${relPath}`.replace(
                          '//',
                          '/'
                        );
                      // ensure parent folders exist
                      const fullRelPath = `${normalizedBase}/${relPath}`.replace('//', '/');
                      const lastSlash = fullRelPath.lastIndexOf('/');
                      if (lastSlash > 0) {
                        const folderPath = fullRelPath.substring(0, lastSlash);
                        await ensureFoldersExistLocal(currentProjectId, folderPath);
                      }
                      await importSingleFile(
                        file,
                        targetAbsolutePath,
                        currentProjectName,
                        currentProjectId
                      );
                    }
                    if (onRefresh) setTimeout(onRefresh, 100);
                  };
                  input.click();
                } else if (key === 'importFolder') {
                  // import a folder (preserve nested structure) into the target
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.multiple = true;
                  input.setAttribute('webkitdirectory', '');
                  input.setAttribute('directory', '');
                  input.onchange = async (e: any) => {
                    const files: FileList = e.target.files;
                    if (!files || files.length === 0) return;
                    let baseTargetDir = '';
                    if (menuItem) {
                      if (menuItem.type === 'file')
                        baseTargetDir =
                          menuItem.path.substring(0, menuItem.path.lastIndexOf('/')) || '/';
                      else if (menuItem.type === 'folder') baseTargetDir = menuItem.path || '/';
                    }
                    const ensureFoldersExistLocal = async (
                      projectId: string | undefined,
                      folderPath: string
                    ) => {
                      if (!projectId) return;
                      const parts = folderPath.split('/').filter(Boolean);
                      let acc = '';
                      for (const part of parts) {
                        acc += '/' + part;
                        try {
                          await fileRepository.createFile(projectId, acc, '', 'folder');
                        } catch (err) {
                          // ignore
                        }
                      }
                    };
                    for (let i = 0; i < files.length; i++) {
                      const file = files[i];
                      const relative = (file as any).webkitRelativePath || file.name;
                      const relParts = relative.split('/').filter(Boolean);
                      const relPath = relParts.join('/');
                      const normalizedBase = baseTargetDir.endsWith('/')
                        ? baseTargetDir.slice(0, -1)
                        : baseTargetDir;
                      const targetAbsolutePath =
                        `/projects/${currentProjectName}${normalizedBase}/${relPath}`.replace(
                          '//',
                          '/'
                        );
                      // ensure parent folders exist
                      const fullRelPath = `${normalizedBase}/${relPath}`.replace('//', '/');
                      const lastSlash = fullRelPath.lastIndexOf('/');
                      if (lastSlash > 0) {
                        const folderPath = fullRelPath.substring(0, lastSlash);
                        await ensureFoldersExistLocal(currentProjectId, folderPath);
                      }
                      await importSingleFile(
                        file,
                        targetAbsolutePath,
                        currentProjectName,
                        currentProjectId
                      );
                    }
                    if (onRefresh) setTimeout(onRefresh, 100);
                  };
                  input.click();
                } else if (key === 'rename') {
                  const item = menuItem;
                  const newName = prompt(t('fileTree.prompt.rename'), item.name);
                  if (newName && newName !== item.name) {
                    try {
                      const lastSlash = item.path.lastIndexOf('/');
                      const oldPath = `/projects/${currentProjectName}${item.path}`;
                      const newPath = `/projects/${currentProjectName}${item.path.substring(0, lastSlash + 1)}${newName}`;
                      await unix.rename(oldPath, newPath);
                      if (onRefresh) setTimeout(onRefresh, 100);
                    } catch (error: any) {
                      alert(t('fileTree.alert.renameFailed', { params: { error: error.message } }));
                    }
                  }
                } else if (key === 'delete') {
                  const item = menuItem;
                  if (item && currentProjectId) {
                    await fileRepository.deleteFile(item.id);
                    if (onRefresh) setTimeout(onRefresh, 100);
                  }
                } else if (key === 'webPreview') {
                  handleWebPreview(menuItem);
                } else if (key === 'createFolder' && menuItem) {
                  const folderName = prompt(t('fileTree.prompt.newFolderName'));
                  if (folderName && currentProjectId) {
                    const newFolderPath = menuItem.path.endsWith('/')
                      ? menuItem.path + folderName
                      : menuItem.path + '/' + folderName;
                    await fileRepository.createFile(currentProjectId, newFolderPath, '', 'folder');
                    if (onRefresh) setTimeout(onRefresh, 100);
                  }
                } else if (key === 'createFile' && menuItem) {
                  const fileName = prompt(t('fileTree.prompt.newFileName'));
                  if (fileName && currentProjectId) {
                    const newFilePath = menuItem.path.endsWith('/')
                      ? menuItem.path + fileName
                      : menuItem.path + '/' + fileName;
                    await fileRepository.createFile(currentProjectId, newFilePath, '', 'file');
                    if (onRefresh) setTimeout(onRefresh, 100);
                  }
                }
              };

              return menuItems.map((mi, idx) => (
                <li
                  key={mi.key}
                  style={{
                    padding: '0.5rem',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    background: menuHoveredIdx === idx ? colors.accentBg : 'transparent',
                    color: colors.foreground,
                    borderTop: idx === 2 ? `1px solid ${colors.border}` : undefined,
                    lineHeight: '1.2',
                    minHeight: '24px',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    WebkitTouchCallout: 'none',
                    MozUserSelect: 'none',
                    msUserSelect: 'none',
                    touchAction: 'manipulation',
                  }}
                  onMouseEnter={() => setMenuHoveredIdx(idx)}
                  onMouseLeave={() => setMenuHoveredIdx(null)}
                  onTouchStart={() => setMenuHoveredIdx(idx)}
                  onTouchEnd={() => setMenuHoveredIdx(null)}
                  onClick={() =>
                    void handleMenuAction(mi.key, contextMenu ? contextMenu.item : null)
                  }
                >
                  {mi.label}
                </li>
              ));
            })()}
          </ul>
        </div>
      )}
    </div>
  );
}
