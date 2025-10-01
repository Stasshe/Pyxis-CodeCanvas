import { useTheme } from '@/context/ThemeContext';
import { useState, useEffect, useRef } from 'react';
import { exportSingleFile } from '@/engine/export/exportSingleFile';
import { exportFolderZip } from '@/engine/export/exportFolderZip';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { getIconForFile, getIconForFolder, getIconForOpenFolder } from 'vscode-icons-js';
import { FileItem } from '@/types';
import { UnixCommands } from '@/engine/cmd/unix';
import { isBufferArray } from '@/engine/helper/isBufferArray';
import { importSingleFile } from '@/engine/import/importSingleFile';
import { fileRepository } from '@/engine/core/fileRepository';

interface FileTreeProps {
  items: FileItem[];
  /**
   * ファイルを開く。行・カラム指定でジャンプする場合はline/columnを指定。
   * @param file ファイル情報
   * @param line 行番号(1始まり、省略可)
   * @param column カラム番号(1始まり、省略可)
   */
  onFileOpen: (file: FileItem, line?: number, column?: number) => void;
  onFilePreview?: (file: FileItem) => void;
  onWebPreview?: (file: FileItem) => void;
  level?: number;
  currentProjectName: string;
  currentProjectId?: string;
  onRefresh?: () => void; // [NEW ARCHITECTURE] ファイルツリー再読み込み用
  isFileSelectModal?: boolean;
}

export default function FileTree({
  items,
  onFileOpen,
  level = 0,
  onFilePreview,
  onWebPreview,
  currentProjectName,
  currentProjectId,
  onRefresh,
  isFileSelectModal,
}: FileTreeProps) {
  const { colors } = useTheme();
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

  // ドラッグ&ドロップ用(フォルダ対応)
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>, targetPath?: string) => {
    e.preventDefault();
    e.stopPropagation();
    const items = e.dataTransfer.items;

    if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
      // フォルダD&D対応
      const traverseFileTree = async (item: any, path: string) => {
        return new Promise<void>(resolve => {
          if (item.isFile) {
            item.file(async (file: File) => {
              const unix = new UnixCommands(currentProjectName, currentProjectId);
              const importPath = `${path}${file.name}`;
              const absolutePath = `/projects/${currentProjectName}${importPath}`;
              await importSingleFile(file, absolutePath, unix);
              resolve();
            });
          } else if (item.isDirectory) {
            const dirReader = item.createReader();
            dirReader.readEntries(async (entries: any[]) => {
              for (const entry of entries) {
                await traverseFileTree(entry, `${path}${item.name}/`);
              }
              resolve();
            });
          } else {
            resolve();
          }
        });
      };

      const traverseAll = async () => {
        for (let i = 0; i < items.length; i++) {
          const entry = items[i].webkitGetAsEntry();
          if (entry) {
            await traverseFileTree(entry, targetPath ? `${targetPath}/` : '/');
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
        const unix = new UnixCommands(currentProjectName, currentProjectId);
        const importPath = targetPath ? `${targetPath}/${file.name}` : `/${file.name}`;
        const absolutePath = `/projects/${currentProjectName}${importPath}`;
        await importSingleFile(file, absolutePath, unix);
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
      if (defaultEditor === 'codemirror') {
        onFileOpen({ ...item, isCodeMirror: true });
      } else {
        onFileOpen({ ...item, isCodeMirror: false });
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent, item: FileItem) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  };

  const handlePreview = (item: FileItem) => {
    setContextMenu(null);
    if (item.type === 'file' && item.name.endsWith('.md') && onFilePreview) {
      onFilePreview(item);
    }
  };

  const handleWebPreview = (item: FileItem) => {
    setContextMenu(null);
    if (item.type === 'file' || item.type === 'folder') {
      onWebPreview && onWebPreview(item);
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
        return (
          <div
            key={item.id}
            onDrop={item.type === 'folder' ? e => handleDrop(e, item.path) : undefined}
            onDragOver={item.type === 'folder' ? handleDragOver : undefined}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                padding: '0.15rem 0.2rem',
                cursor: 'pointer',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitTouchCallout: 'none',
                MozUserSelect: 'none',
                msUserSelect: 'none',
                position: 'relative',
                background: hoveredItemId === item.id ? colors.accentBg : 'transparent',
                marginLeft: `${level * 12}px`,
                touchAction: 'manipulation',
              }}
              onClick={() => handleItemClick(item)}
              onContextMenu={e => handleContextMenu(e, item)}
              onMouseEnter={() => setHoveredItemId(item.id)}
              onMouseLeave={() => setHoveredItemId(null)}
              onTouchStart={e => {
                handleTouchStart(e, item);
                setHoveredItemId(item.id);
              }}
              onTouchEnd={() => {
                handleTouchEnd();
                setHoveredItemId(null);
              }}
              onTouchMove={() => {
                handleTouchMove();
                setHoveredItemId(null);
              }}
              onTouchCancel={() => {
                handleTouchEnd();
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
                        return `/vscode-icons/${iconPath.split('/').pop()}`;
                      }
                      return '/vscode-icons/folder.svg';
                    })()}
                    alt="folder"
                    style={{ width: 16, height: 16, verticalAlign: 'middle' }}
                  />
                </>
              ) : (
                <>
                  <div className="w-3.5"></div>
                  <img
                    src={(() => {
                      const iconPath = getIconForFile(item.name) || getIconForFile('');
                      if (iconPath && iconPath.endsWith('.svg')) {
                        return `/vscode-icons/${iconPath.split('/').pop()}`;
                      }
                      return '/vscode-icons/file.svg';
                    })()}
                    alt="file"
                    style={{ width: 16, height: 16, verticalAlign: 'middle' }}
                  />
                </>
              )}
              <span
                style={{
                  fontSize: '0.875rem',
                  color: colors.foreground,
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
                onFileOpen={onFileOpen}
                level={level + 1}
                onFilePreview={onFilePreview}
                onWebPreview={onWebPreview}
                currentProjectName={currentProjectName}
                currentProjectId={currentProjectId}
                onRefresh={onRefresh}
              />
            )}
          </div>
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
            {(contextMenu.item == null
              ? ['ファイル作成', 'フォルダ作成', 'インポート']
              : [
                  '開く',
                  contextMenu.item.type === 'file' && contextMenu.item.name.endsWith('.md')
                    ? 'プレビューを開く'
                    : null,
                  'CodeMirrorで開く',
                  'ダウンロード',
                  'インポート',
                  '名前変更',
                  '削除',
                  contextMenu.item.type === 'folder' ? 'フォルダ作成' : null,
                  contextMenu.item.type === 'folder' ? 'ファイル作成' : null,
                  'WebPreview',
                ]
            )
              .filter(Boolean)
              .map((label, idx) => (
                <li
                  key={idx}
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
                  onClick={async () => {
                    setContextMenu(null);
                    const unix = new UnixCommands(currentProjectName, currentProjectId);
                    if (label === 'ファイル作成') {
                      const fileName = prompt('新しいファイル名を入力してください:');
                      if (fileName && currentProjectId) {
                        const newFilePath = fileName.startsWith('/') ? fileName : '/' + fileName;
                        await fileRepository.createFile(currentProjectId, newFilePath, '', 'file');
                        if (onRefresh) setTimeout(onRefresh, 100);
                      }
                    } else if (label === 'フォルダ作成') {
                      const folderName = prompt('新しいフォルダ名を入力してください:');
                      if (folderName && currentProjectId) {
                        const newFolderPath = folderName.startsWith('/')
                          ? folderName
                          : '/' + folderName;
                        await fileRepository.createFile(
                          currentProjectId,
                          newFolderPath,
                          '',
                          'folder'
                        );
                        if (onRefresh) setTimeout(onRefresh, 100);
                      }
                    } else if (label === 'インポート') {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.onchange = async (e: any) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        const targetAbsolutePath = `/projects/${currentProjectName}/${file.name}`;
                        await importSingleFile(file, targetAbsolutePath, unix);
                        if (onRefresh) setTimeout(onRefresh, 100);
                      };
                      input.click();
                    } else if (label === '名前変更') {
                      const item = contextMenu.item;
                      if (item) {
                        const newName = prompt('新しい名前を入力してください:', item.name);
                        if (newName && newName !== item.name) {
                          try {
                            const lastSlash = item.path.lastIndexOf('/');
                            const oldPath = `/projects/${currentProjectName}${item.path}`;
                            const newPath = `/projects/${currentProjectName}${item.path.substring(0, lastSlash + 1)}${newName}`;
                            await unix.rename(oldPath, newPath);
                            if (onRefresh) setTimeout(onRefresh, 100);
                          } catch (error: any) {
                            alert('名前変更に失敗しました: ' + error.message);
                          }
                        }
                      }
                    }

                    // 既存のitemありの処理
                    if (contextMenu.item) {
                      if (label === '開く') {
                        onFileOpen(contextMenu.item!);
                      } else if (label === 'プレビューを開く') {
                        handlePreview(contextMenu.item!);
                      } else if (label === 'CodeMirrorで開く') {
                        if (contextMenu.item && contextMenu.item.type === 'file') {
                          onFileOpen({ ...contextMenu.item, isCodeMirror: true });
                        }
                      } else if (label === 'ダウンロード') {
                        const item = contextMenu.item;
                        if (item && item.type === 'file') {
                          let content = item.content;
                          if (typeof content !== 'string') {
                            content = 'error fetching content';
                          }
                          exportSingleFile({
                            name: item.name,
                            content,
                            isBufferArray: item.isBufferArray,
                            bufferContent: item.bufferContent,
                          });
                        } else if (item && item.type === 'folder') {
                          await exportFolderZip(item);
                        }
                      } else if (label === 'インポート') {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.onchange = async (e: any) => {
                          const file = e.target.files[0];
                          if (!file) return;
                          const unix = new UnixCommands(currentProjectName, currentProjectId);
                          const item = contextMenu.item;
                          let targetAbsolutePath = '';
                          if (item) {
                            const dirPath = item.path.substring(0, item.path.lastIndexOf('/'));
                            if (item.type === 'file') {
                              targetAbsolutePath = `/projects/${currentProjectName}${dirPath}/${file.name}`;
                            } else if (item.type === 'folder') {
                              targetAbsolutePath = `/projects/${currentProjectName}${item.path}/${file.name}`;
                            }
                          }
                          if (targetAbsolutePath) {
                            await importSingleFile(file, targetAbsolutePath, unix);
                            if (onRefresh) setTimeout(onRefresh, 100);
                          }
                        };
                        input.click();
                      } else if (label === '削除') {
                        const item = contextMenu.item;
                        if (item && currentProjectId) {
                          // [NEW ARCHITECTURE] fileRepository.deleteFile経由で削除
                          await fileRepository.deleteFile(item.id);
                          if (onRefresh) setTimeout(onRefresh, 100);
                        }
                      } else if (label === 'フォルダ作成') {
                        const item = contextMenu.item;
                        if (item && currentProjectId) {
                          const folderName = prompt('新しいフォルダ名を入力してください:');
                          if (folderName) {
                            const newFolderPath = item.path.endsWith('/')
                              ? item.path + folderName
                              : item.path + '/' + folderName;
                            await fileRepository.createFile(
                              currentProjectId,
                              newFolderPath,
                              '',
                              'folder'
                            );
                            if (onRefresh) setTimeout(onRefresh, 100);
                          }
                        }
                      } else if (label === 'ファイル作成') {
                        const item = contextMenu.item;
                        if (item && currentProjectId) {
                          const fileName = prompt('新しいファイル名を入力してください:');
                          if (fileName) {
                            const newFilePath = item.path.endsWith('/')
                              ? item.path + fileName
                              : item.path + '/' + fileName;
                            await fileRepository.createFile(
                              currentProjectId,
                              newFilePath,
                              '',
                              'file'
                            );
                            if (onRefresh) setTimeout(onRefresh, 100);
                          }
                        }
                      } else if (label === 'WebPreview') {
                        handleWebPreview(contextMenu.item!);
                      }
                    }
                  }}
                >
                  {label}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
