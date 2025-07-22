import { useTheme } from '../context/ThemeContext';
import { useState, useEffect, useRef } from 'react';
import { exportSingleFile } from '../utils/export/exportSingleFile';
import { exportFolderZip } from '../utils/export/exportFolderZip';
import { ChevronDown, ChevronRight, File, Folder } from 'lucide-react';
import { FileItem } from '../types';
import { UnixCommands } from '@/utils/cmd/unix';

interface FileTreeProps {
  items: FileItem[];
  onFileOpen: (file: FileItem) => void;
  onFilePreview?: (file: FileItem) => void;
  level?: number;
  currentProjectName: string; // プロジェクト情報をオプションで受け取る
  onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean) => Promise<void>;
}
export default function FileTree({ items, onFileOpen, level = 0, onFilePreview, currentProjectName, onFileOperation }: FileTreeProps) {
  const { colors } = useTheme();
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [menuHoveredIdx, setMenuHoveredIdx] = useState<number | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: FileItem | null } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // 初回読み込み時にルートレベルのフォルダを展開
  useEffect(() => {
    if (level === 0) {
      const rootFolders = items.filter((item: FileItem) => item.type === 'folder');
      const expandedIds = new Set<string>(rootFolders.map((folder: FileItem) => folder.id));
      setExpandedFolders(expandedIds);
    }
  }, [items, level]);

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
      onFileOpen(item);
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
    <>
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
                position: 'relative',
                background: hoveredItemId === item.id ? colors.accentBg : 'transparent',
                marginLeft: `${level * 12}px`,
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
              <span style={{ fontSize: '0.875rem', color: colors.foreground, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
            </div>
            {item.type === 'folder' && item.children && isExpanded && (
              <FileTree 
                items={item.children} 
                onFileOpen={onFileOpen} 
                level={level + 1}
                onFilePreview={onFilePreview}
                currentProjectName={currentProjectName}  // プロジェクト情報を渡す
              />
            )}
          </div>
        );
      })}

      {/* コンテキストメニュー（コンパクト化＋エクスポート/インポート追加） */}
      {contextMenu && contextMenu.item && (
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
            {[
              '開く',
              contextMenu.item.type === 'file' && contextMenu.item.name.endsWith('.md') ? 'プレビューを開く' : null,
              'ダウンロード',
              'インポート',
              '削除',
              contextMenu.item.type === 'folder' ? 'フォルダ作成' : null,
              contextMenu.item.type === 'folder' ? 'ファイル作成' : null
            ].filter(Boolean).map((label, idx) => (
              <li
                key={label as string}
                style={{
                  padding: '0.5rem',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  background: menuHoveredIdx === idx ? colors.accentBg : 'transparent',
                  color: colors.foreground,
                  borderTop: idx === 2 ? `1px solid ${colors.border}` : undefined,
                  lineHeight: '1.2', minHeight: '24px'
                }}
                onMouseEnter={() => setMenuHoveredIdx(idx)}
                onMouseLeave={() => setMenuHoveredIdx(null)}
                onTouchStart={() => setMenuHoveredIdx(idx)}
                onTouchEnd={() => setMenuHoveredIdx(null)}
                onClick={async () => {
                  setContextMenu(null);
                  if (label === '開く') {
                    onFileOpen(contextMenu.item!);
                  } else if (label === 'プレビューを開く') {
                    handlePreview(contextMenu.item!);
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
                      const { importSingleFile } = await import('../utils/export/importSingleFile');
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
                        await importSingleFile(file, targetAbsolutePath, unix);
                        if (typeof onFileOperation === 'function') {
                          await onFileOperation(targetPath, 'file', await file.text(), false);
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
                        await onFileOperation(item.path, 'folder', '', false);
                      }
                    }
                  } else if (label === 'ファイル作成') {
                    const item = contextMenu.item;
                    if (item && typeof onFileOperation === 'function') {
                      const fileName = prompt('新しいファイル名を入力してください:');
                      if (fileName) {
                        await onFileOperation(item.path, 'file', '', false);
                      }
                    }
                  }
                }}
              >{label}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
