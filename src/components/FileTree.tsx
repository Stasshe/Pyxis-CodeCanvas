import { useState, useEffect, useRef } from 'react';
import { exportSingleFile } from '../utils/export/exportSingleFile';
import { exportFolderZip } from '../utils/export/exportFolderZip';
import { ChevronDown, ChevronRight, File, Folder } from 'lucide-react';
import { FileItem } from '../types';

interface FileTreeProps {
  items: FileItem[];
  onFileOpen: (file: FileItem) => void;
  onFilePreview?: (file: FileItem) => void;
  level?: number;
}
export default function FileTree({ items, onFileOpen, level = 0, onFilePreview }: FileTreeProps) {
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
              className="flex items-center gap-1 px-2 py-1 hover:bg-accent cursor-pointer select-none relative"
              onClick={() => handleItemClick(item)}
              onContextMenu={e => handleContextMenu(e, item)}
              onTouchStart={e => handleTouchStart(e, item)}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchMove}
              onTouchCancel={handleTouchEnd}
              style={{ marginLeft: `${level * 16}px` }}
            >
              {item.type === 'folder' ? (
                <>
                  {isExpanded ? (
                    <ChevronDown size={14} className="text-muted-foreground" />
                  ) : (
                    <ChevronRight size={14} className="text-muted-foreground" />
                  )}
                  <Folder size={16} className="text-blue-400" />
                </>
              ) : (
                <>
                  <div className="w-3.5"></div>
                  <File size={16} className="text-gray-400" />
                </>
              )}
              <span className="text-sm truncate">{item.name}</span>
            </div>
            {item.type === 'folder' && item.children && isExpanded && (
              <FileTree 
                items={item.children} 
                onFileOpen={onFileOpen} 
                level={level + 1}
                onFilePreview={onFilePreview}
              />
            )}
          </div>
        );
      })}

      {/* コンテキストメニュー（コンパクト化＋エクスポート/インポート追加） */}
      {contextMenu && contextMenu.item && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-card border border-border rounded shadow-lg min-w-[120px]"
          style={{ top: contextMenu.y, left: contextMenu.x, padding: '2px 0' }}
        >
          <ul className="py-0">
            <li
              className="px-2 py-1 hover:bg-accent cursor-pointer text-xs"
              style={{ lineHeight: '1.2', minHeight: '24px' }}
              onClick={() => { onFileOpen(contextMenu.item!); setContextMenu(null); }}
            >開く</li>
            {contextMenu.item.type === 'file' && contextMenu.item.name.endsWith('.md') && (
              <li
                className="px-2 py-1 hover:bg-accent cursor-pointer text-xs"
                style={{ lineHeight: '1.2', minHeight: '24px' }}
                onClick={() => handlePreview(contextMenu.item!)}
              >プレビューを開く</li>
            )}
            <li
              className="px-2 py-1 hover:bg-accent cursor-pointer text-xs border-t border-border"
              style={{ lineHeight: '1.2', minHeight: '24px' }}
              onClick={async () => {
                setContextMenu(null);
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
              }}
            >ダウンロード</li>
            <li
              className="px-2 py-1 hover:bg-accent cursor-pointer text-xs"
              style={{ lineHeight: '1.2', minHeight: '24px' }}
              onClick={() => { setContextMenu(null); alert('インポート機能は未実装です'); }}
            >インポート</li>
          </ul>
        </div>
      )}

  {/* Markdownプレビューモーダルは廃止（タブで表示） */}
    </>
  );
}
