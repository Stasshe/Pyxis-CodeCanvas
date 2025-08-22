'use client';

import React, { useState, useEffect, useRef } from 'react';
import { FileItem } from '@/types';
import { useTheme } from '@/context/ThemeContext';
import { openFile } from '@/utils/openTab';

// FileItem[]を平坦化する関数（tab.tsと同じ実装）
function flattenFileItems(items: FileItem[]): FileItem[] {
  const result: FileItem[] = [];
  
  function traverse(items: FileItem[]) {
    for (const item of items) {
      result.push(item);
      if (item.children && item.children.length > 0) {
        traverse(item.children);
      }
    }
  }
  
  traverse(items);
  return result;
}

interface OperationWindowProps {
  isVisible: boolean;
  onClose: () => void;
  projectFiles: FileItem[];
  tabs: any[];
  setTabs: (tabs: any[]) => void;
  setActiveTabId: (id: string) => void;
  onFileSelect?: (file: FileItem) => void;
}

export default function OperationWindow({
  isVisible,
  onClose,
  projectFiles,
  tabs,
  setTabs,
  setActiveTabId,
  onFileSelect
}: OperationWindowProps) {
  const { colors } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'file' | 'folder' | 'fuzzy'>('file');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 検索ロジック
  const allFiles = flattenFileItems(projectFiles).filter(file => file.type === 'file' && !file.path.includes('node_modules/'));
  let filteredFiles: FileItem[] = [];
  if (searchMode === 'file') {
    filteredFiles = allFiles.filter(file => file.name.toLowerCase().includes(searchQuery.toLowerCase()));
  } else if (searchMode === 'folder') {
    filteredFiles = allFiles.filter(file => {
      const folders = file.path.split('/').slice(0, -1);
      return folders.some(folder => folder.toLowerCase().includes(searchQuery.toLowerCase()));
    });
  } else if (searchMode === 'fuzzy') {
    // あいまい検索（簡易: 全体パス・ファイル名に部分一致）
    const q = searchQuery.toLowerCase();
    filteredFiles = allFiles.filter(file => file.path.toLowerCase().includes(q) || file.name.toLowerCase().includes(q));
  }

  // 選択されたアイテムにスクロールする関数
  const scrollToSelectedItem = (index: number) => {
    if (!listRef.current) return;
    
    const listElement = listRef.current;
    const itemHeight = 38;
    const containerHeight = listElement.clientHeight;
    const scrollTop = listElement.scrollTop;
    
    const itemTop = index * itemHeight;
    const itemBottom = itemTop + itemHeight;
    
    if (itemTop < scrollTop) {
      // アイテムが上に隠れている場合
      listElement.scrollTop = itemTop;
    } else if (itemBottom > scrollTop + containerHeight) {
      // アイテムが下に隠れている場合
      listElement.scrollTop = itemBottom - containerHeight;
    }
  };

  // ESCキーで閉じる、上下キーで選択、Enterで開く
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isVisible) return;

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => {
            const newIndex = prev > 0 ? prev - 1 : filteredFiles.length - 1;
            setTimeout(() => scrollToSelectedItem(newIndex), 0);
            return newIndex;
          });
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => {
            const newIndex = prev < filteredFiles.length - 1 ? prev + 1 : 0;
            setTimeout(() => scrollToSelectedItem(newIndex), 0);
            return newIndex;
          });
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredFiles[selectedIndex]) {
            openFile(filteredFiles[selectedIndex], tabs, setTabs, setActiveTabId);
            if (onFileSelect) onFileSelect(filteredFiles[selectedIndex]);
            onClose();
          }
          break;
      }
    };

    if (isVisible) {
      document.addEventListener('keydown', handleKeyDown);
      // フォーカスを入力欄に移動
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isVisible, filteredFiles, selectedIndex, tabs, setTabs, setActiveTabId, onClose]);

  // 検索クエリが変更されたときに選択インデックスをリセット
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery, searchMode]);

  // 表示されていない場合は何も表示しない
  if (!isVisible) return null;

  return (
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
        zIndex: 1000,
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
        onClick={(e) => e.stopPropagation()}
      >
        {/* 検索入力欄＋モード切替 */}
        <div style={{ padding: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            ref={inputRef}
            type="text"
            placeholder={searchMode === 'file' ? 'ファイル名を入力...' : searchMode === 'folder' ? 'フォルダ名を入力...' : 'あいまい検索...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
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
          />
          <select value={searchMode} onChange={e => setSearchMode(e.target.value as any)} style={{ padding: '6px', borderRadius: '4px', fontSize: '13px', border: `1px solid ${colors.border}` }}>
            <option value="file">ファイル名</option>
            <option value="folder">フォルダ名</option>
            <option value="fuzzy">あいまい</option>
          </select>
        </div>

        {/* ファイル一覧 */}
        <div
          ref={listRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            minHeight: '200px',
            maxHeight: 'calc(40vh - 80px)',
          }}
        >
          {filteredFiles.length === 0 ? (
            <div
              style={{
                padding: '20px',
                textAlign: 'center',
                color: colors.mutedFg,
              }}
            >
              ファイルが見つかりません
            </div>
          ) : (
            filteredFiles.map((file, index) => {
              // highlight helper
              function highlight(text: string, query: string) {
                if (!query) return text;
                const idx = text.toLowerCase().indexOf(query.toLowerCase());
                if (idx === -1) return text;
                return <>{text.slice(0, idx)}<span style={{ background: colors.accentBg, color: colors.primary }}>{text.slice(idx, idx + query.length)}</span>{text.slice(idx + query.length)}</>;
              }
              // highlight logic for each mode
              let pathElem: React.ReactNode = file.path;
              let nameElem: React.ReactNode = file.name;
              if (searchMode === 'file') {
                nameElem = highlight(file.name, searchQuery);
              } else if (searchMode === 'folder') {
                // highlight folder part in path
                const folders = file.path.split('/').slice(0, -1);
                const folderElems = folders.map((folder, i) => folder.toLowerCase().includes(searchQuery.toLowerCase()) ? <span key={i} style={{ background: colors.accentBg, color: colors.primary }}>{folder}</span> : folder);
                const joinedFolders = folderElems.slice(1).reduce<React.ReactNode[]>((prev, curr, i) => [...prev, <span key={i + 'sep'}>/</span>, curr], [folderElems[0]]);
                pathElem = <>{joinedFolders}{"/"}{file.name}</>;
              } else if (searchMode === 'fuzzy') {
                // highlight in path or name
                if (file.path.toLowerCase().includes(searchQuery.toLowerCase())) {
                  pathElem = highlight(file.path, searchQuery);
                } else {
                  nameElem = highlight(file.name, searchQuery);
                }
              }
              return (
                <div
                  key={file.id}
                  style={{
                    padding: '8px 12px',
                    background: index === selectedIndex ? colors.accentBg : 'transparent',
                    color: index === selectedIndex ? colors.primary : colors.foreground,
                    cursor: 'pointer',
                    borderBottom: `1px solid ${colors.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                  onClick={() => {
                    openFile(file, tabs, setTabs, setActiveTabId);
                    if (onFileSelect) onFileSelect(file);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <span
                    style={{
                      fontSize: '10px',
                      color: colors.mutedFg,
                      fontFamily: 'monospace',
                    }}
                  >
                    {pathElem}
                  </span>
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: '500',
                    }}
                  >
                    {nameElem}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* フッター（ヘルプテキスト） */}
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
          <span>↑↓ で選択, Enter で開く</span>
          <span>ESC で閉じる</span>
        </div>
      </div>
    </div>
  );
}
