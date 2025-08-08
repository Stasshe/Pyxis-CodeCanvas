import { useTheme } from '@/context/ThemeContext';
import { useState, useEffect, useRef } from 'react';
import { exportSingleFile } from '@/utils/export/exportSingleFile';
import { exportFolderZip } from '@/utils/export/exportFolderZip';
import { ChevronDown, ChevronRight, File, Folder } from 'lucide-react';
import { FileItem } from '@/types';
import { UnixCommands } from '@/utils/cmd/unix';
import { isBufferArray } from '@/utils/isBufferArray';

interface FileTreeProps {
  items: FileItem[];
  onFileOpen: (file: FileItem) => void;
  onFilePreview?: (file: FileItem) => void;
  level?: number;
  currentProjectName: string;
  onFileOperation?: (
    path: string,
    type: 'file' | 'folder' | 'delete',
    content?: string | ArrayBuffer,
    isNodeRuntime?: boolean,
    isBufferArray?: boolean,
    bufferContent?: ArrayBuffer
  ) => Promise<void>;
  isFileSelectModal?: boolean;
}
export default function FileTree({ items, onFileOpen, level = 0, onFilePreview, currentProjectName, onFileOperation, isFileSelectModal }: FileTreeProps) {
  const { colors } = useTheme();
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [menuHoveredIdx, setMenuHoveredIdx] = useState<number | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isExpandedFoldersRestored, setIsExpandedFoldersRestored] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: FileItem | null } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // expandedFoldersをlocalStorageに保存（初回復元後のみ）
  useEffect(() => {
    if (level === 0 && isExpandedFoldersRestored) {
      const arr = Array.from(expandedFolders);
      window.localStorage.setItem(`pyxis-expandedFolders-${currentProjectName}`, JSON.stringify(arr));
    }
  }, [expandedFolders, level, currentProjectName, isExpandedFoldersRestored]);
  // 初回読み込み時にlocalStorageからexpandedFoldersを復元（itemsが空の場合はスキップ）
  useEffect(() => {
    if (level === 0 && items && items.length > 0 && !isExpandedFoldersRestored) {
      const saved = window.localStorage.getItem(`pyxis-expandedFolders-${currentProjectName}`);
      if (saved) {
        try {
          const arr = JSON.parse(saved);
          if (Array.isArray(arr)) {
            // itemsに存在するidのみセット
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
      // デフォルトエディタ設定をlocalStorageから取得
      const defaultEditor = typeof window !== 'undefined' ? localStorage.getItem('pyxis-defaultEditor') : 'monaco';
      if (defaultEditor === 'codemirror') {
        onFileOpen({ ...item, isCodeMirror: true });
      } else {
        onFileOpen({ ...item, isCodeMirror: false });
      }
    }
  };

  // 右クリック（または長押し）でメニュー表示
  const handleContextMenu = (e: React.MouseEvent, item: FileItem) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  };

  // プレビュー表示（タブで開く）
  const handlePreview = (item: FileItem) => {
    setContextMenu(null);
    if (item.type === 'file' && item.name.endsWith('.md') && onFilePreview) {
      onFilePreview(item);
    }
  };

  // WebPreview handler
  const handleWebPreview = (item: FileItem) => {
    setContextMenu(null);
    if (item.type === 'file' || item.type === 'folder') {
      onFilePreview && onFilePreview(item); // Reuse onFilePreview logic for now
    }
  };

  // タッチ長押し用のタイマー管理
  const longPressTimeout = useRef<NodeJS.Timeout | null>(null);
  const touchPosition = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // 長押し開始
  const handleTouchStart = (e: React.TouchEvent, item: FileItem) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchPosition.current = { x: touch.clientX, y: touch.clientY };
      longPressTimeout.current = setTimeout(() => {
        setContextMenu({ x: touch.clientX, y: touch.clientY, item });
      }, 500); // 500ms長押しで発火
    }
  };
  // 長押しキャンセル
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
      style={level === 0 ? {
        position: 'relative',
        minHeight: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      } : {}}
    >
      {items.map(item => {
        const isExpanded = expandedFolders.has(item.id);
        return (
          <div key={item.id}>
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
              onTouchStart={e => { handleTouchStart(e, item); setHoveredItemId(item.id); }}
              onTouchEnd={() => { handleTouchEnd(); setHoveredItemId(null); }}
              onTouchMove={() => { handleTouchMove(); setHoveredItemId(null); }}
              onTouchCancel={() => { handleTouchEnd(); setHoveredItemId(null); }}
            >
              {item.type === 'folder' ? (
                <>
                  {isExpanded ? (
                    <ChevronDown size={14} color={colors.mutedFg} />
                  ) : (
                    <ChevronRight size={14} color={colors.mutedFg} />
                  )}
                  <Folder size={16} color={colors.primary} />
                </>
              ) : (
                <>
                  <div className="w-3.5"></div>
                  <File size={16} color={colors.mutedFg} />
                </>
              )}
              <span style={{ fontSize: '0.875rem', color: colors.foreground, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', userSelect: 'none' }}>{item.name}</span>
            </div>
            {item.type === 'folder' && item.children && isExpanded && (
              <FileTree 
                items={item.children} 
                onFileOpen={onFileOpen} 
                level={level + 1}
                onFilePreview={onFilePreview}
                currentProjectName={currentProjectName}
                onFileOperation={onFileOperation}
              />
            )}
          </div>
        );
      })}

      {/* 空白領域を追加（最上位レベルのみ） */}
      {(level === 0 && !isFileSelectModal) && (
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
        />
      )}

      {/* コンテキストメニュー（item: null の場合は空白領域用） */}
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
            top: contextMenu.y, left: contextMenu.x, padding: '2px 0'
          }}
        >
          <ul className="py-0">
            {(contextMenu.item == null
              ? [
                  'ファイル作成',
                  'フォルダ作成',
                  'インポート',
                ]
              : [
                  '開く',
                  contextMenu.item.type === 'file' && contextMenu.item.name.endsWith('.md') ? 'プレビューを開く' : null,
                  'CodeMirrorで開く',
                  'ダウンロード',
                  'インポート',
                  '名前変更',
                  '削除',
                  contextMenu.item.type === 'folder' ? 'フォルダ作成' : null,
                  contextMenu.item.type === 'folder' ? 'ファイル作成' : null,
                  'WebPreview' // Add WebPreview option
                ]
            ).filter(Boolean).map((label, idx) => (
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
                  touchAction: 'manipulation'
                }}
                onMouseEnter={() => setMenuHoveredIdx(idx)}
                onMouseLeave={() => setMenuHoveredIdx(null)}
                onTouchStart={() => setMenuHoveredIdx(idx)}
                onTouchEnd={() => setMenuHoveredIdx(null)}
                onClick={async () => {
                  setContextMenu(null);
                  const unix = new UnixCommands(currentProjectName);
                  if (label === 'ファイル作成') {
                    if (typeof onFileOperation === 'function') {
                      const fileName = prompt('新しいファイル名を入力してください:');
                      if (fileName) {
                        const newFilePath = fileName.startsWith('/') ? fileName : '/' + fileName;
                        await onFileOperation(newFilePath, 'file', '', false);
                      }
                    }
                  } else if (label === 'フォルダ作成') {
                    if (typeof onFileOperation === 'function') {
                      const folderName = prompt('新しいフォルダ名を入力してください:');
                      if (folderName) {
                        const newFolderPath = folderName.startsWith('/') ? folderName : '/' + folderName;
                        await onFileOperation(newFolderPath, 'folder', '', false);
                      }
                    }
                  } else if (label === 'インポート') {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.onchange = async (e: any) => {
                      const file = e.target.files[0];
                      if (!file) return;
                      const { importSingleFile } = await import('@/utils/export/importSingleFile');
                      const targetAbsolutePath = `/projects/${currentProjectName}/${file.name}`;
                      const targetPath = `/${file.name}`;
                      let content: string | ArrayBuffer = '';
                      content = await file.arrayBuffer();
                      const isBinary = isBufferArray(content);
                      if (!isBinary) {
                        content = await file.text();
                      }
                      await importSingleFile(file, targetAbsolutePath, unix);
                      if (typeof onFileOperation === 'function') {
                        await onFileOperation(targetPath, 'file', content, false, isBinary, isBinary ? (content as ArrayBuffer) : undefined);
                      }
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
                          const result = await unix.rename(oldPath, newPath);
                          alert(result);
                          if (typeof onFileOperation === 'function') {
                            await onFileOperation(item.path.substring(0, lastSlash + 1) + newName, item.type, item.content ?? '', false);
                            await onFileOperation(item.path, 'delete');
                          }
                        } catch (error: any) {
                          alert('名前変更に失敗しました: ' + error.message);
                        }
                      }
                    }
                  }
                  // ...既存のitemありの処理...
                  if (contextMenu.item) {
                    if (label === '開く') {
                      onFileOpen(contextMenu.item!);
                    } else if (label === 'プレビューを開く') {
                      handlePreview(contextMenu.item!);
                    } else if (label === 'CodeMirrorで開く') {
                      if (contextMenu.item && contextMenu.item.type === 'file') {
                        // CodeMirrorで開く用のフラグをonFileOpenに渡す（実装側でisCodeMirrorをtrueにする必要あり）
                        onFileOpen({ ...contextMenu.item, isCodeMirror: true });
                      }
                    } else if (label === 'ダウンロード') {
                      const item = contextMenu.item;
                      if (item && item.type === 'file') {
                        let content = item.content;
                        if (typeof content !== 'string') {
                          content = 'error fetching content';
                        }
                        exportSingleFile({ name: item.name, content });
                      } else if (item && item.type === 'folder') {
                        await exportFolderZip(item);
                      }
                    } else if (label === 'インポート') {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.onchange = async (e: any) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        const { importSingleFile } = await import('@/utils/export/importSingleFile');
                        const unix = new UnixCommands(currentProjectName);
                        const item = contextMenu.item;
                        let targetPath = '';
                        let targetAbsolutePath = '';
                        if (item) {
                          const dirPath = item.path.substring(0, item.path.lastIndexOf('/'));
                          if ( item.type === 'file') {
                            targetAbsolutePath = `/projects/${currentProjectName}${dirPath}/${file.name}`;
                            targetPath = `${dirPath}/${file.name}`;
                          } else if (item.type === 'folder') {
                            targetAbsolutePath = `/projects/${currentProjectName}${item.path}/${file.name}`;
                            targetPath = `${item.path}/${file.name}`;
                          }
                        }
                        if (targetPath) {
                          let content: string | ArrayBuffer = '';
                          content = await file.arrayBuffer();
                          const isBinary = isBufferArray(content);
                          if (!isBinary) {
                            content = await file.text();
                          }
                          await importSingleFile(file, targetAbsolutePath, unix);
                          if (typeof onFileOperation === 'function') {
                            await onFileOperation(targetPath, 'file', content, false, isBinary, isBinary ? (content as ArrayBuffer) : undefined);
                          }
                        }
                      };
                      input.click();
                    } else if (label === '削除') {
                      const item = contextMenu.item;
                      if (item && typeof onFileOperation === 'function') {
                        await onFileOperation(item.path, 'delete');
                      }
                    } else if (label === 'フォルダ作成') {
                      const item = contextMenu.item;
                      if (item && typeof onFileOperation === 'function') {
                        const folderName = prompt('新しいフォルダ名を入力してください:');
                        if (folderName) {
                          const newFolderPath = item.path.endsWith('/') ? item.path + folderName : item.path + '/' + folderName;
                          await onFileOperation(newFolderPath, 'folder', '', false);
                        }
                      }
                    } else if (label === 'ファイル作成') {
                      const item = contextMenu.item;
                      if (item && typeof onFileOperation === 'function') {
                        const fileName = prompt('新しいファイル名を入力してください:');
                        if (fileName) {
                          const newFilePath = item.path.endsWith('/') ? item.path + fileName : item.path + '/' + fileName;
                          await onFileOperation(newFilePath, 'file', '', false);
                        }
                      }
                    } else if (label === 'WebPreview') {
                      handleWebPreview(contextMenu.item!);
                    }
                  }
                }}
              >{label}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
