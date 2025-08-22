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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 検索ロジック（ファイル名・フォルダ名・パスのいずれかに一致）
  const allFiles = flattenFileItems(projectFiles).filter(file => file.type === 'file' && !file.path.includes('node_modules/'));
  const filteredFiles: FileItem[] = searchQuery
    ? allFiles.filter(file => {
        const q = searchQuery.toLowerCase();
        const folders = file.path.split('/').slice(0, -1);
        return (
          file.name.toLowerCase().includes(q) ||
          folders.some(folder => folder.toLowerCase().includes(q)) ||
          file.path.toLowerCase().includes(q)
        );
      })
    : allFiles;

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
  }, [searchQuery]);

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
        {/* 検索入力欄のみ */}
        <div style={{ padding: '12px' }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="ファイル名・フォルダ名・パス いずれかで検索..."
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
              function highlight(text: string, query: string, isSelected: boolean) {
                if (!query) return text;
                const idx = text.toLowerCase().indexOf(query.toLowerCase());
                if (idx === -1) return text;
                return <>{text.slice(0, idx)}<span style={{ background: isSelected ? colors.primary : colors.accentBg, color: isSelected ? colors.cardBg : colors.primary, fontWeight: isSelected ? 'bold' : 'normal', borderRadius: '2px', padding: '0 2px' }}>{text.slice(idx, idx + query.length)}</span>{text.slice(idx + query.length)}</>;
              }
              // highlight logic: ファイル名・フォルダ名・パスのいずれかに一致した部分をハイライト
              let pathElem: React.ReactNode = file.path;
              let nameElem: React.ReactNode = file.name;
              const q = searchQuery.toLowerCase();
              // highlight file name
              if (file.name.toLowerCase().includes(q)) {
                nameElem = highlight(file.name, searchQuery, index === selectedIndex);
              }
              // highlight folder part in path
              const folders = file.path.split('/').slice(0, -1);
              if (folders.some(folder => folder.toLowerCase().includes(q))) {
                const folderElems = folders.map((folder, i) => folder.toLowerCase().includes(q)
                  ? <span key={i} style={{ background: index === selectedIndex ? colors.primary : colors.accentBg, color: index === selectedIndex ? colors.cardBg : colors.primary, fontWeight: index === selectedIndex ? 'bold' : 'normal', borderRadius: '2px', padding: '0 2px' }}>{folder}</span>
                  : folder);
                const joinedFolders = folderElems.slice(1).reduce<React.ReactNode[]>((prev, curr, i) => [...prev, <span key={i + 'sep'}>/</span>, curr], [folderElems[0]]);
                pathElem = <>{joinedFolders}{"/"}{file.name}</>;
              } else if (file.path.toLowerCase().includes(q)) {
                pathElem = highlight(file.path, searchQuery, index === selectedIndex);
              }
              return (
                <div
                  key={file.id}
                  style={{
                    padding: '8px 12px',
                    background: index === selectedIndex ? colors.primary : 'transparent',
                    color: index === selectedIndex ? colors.cardBg : colors.foreground,
                    cursor: 'pointer',
                    borderBottom: `1px solid ${colors.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    border: index === selectedIndex ? `2px solid ${colors.accentBg}` : undefined,
                    fontWeight: index === selectedIndex ? 'bold' : 'normal',
                    borderRadius: index === selectedIndex ? '6px' : undefined,
                    boxShadow: index === selectedIndex ? '0 0 0 2px rgba(0,0,0,0.08)' : undefined,
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
          <span
            style={{
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
            onClick={onClose}
            tabIndex={0}
            role="button"
            aria-label="ESC で閉じる"
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                onClose();
              }
            }}
          >ESC で閉じる</span>
        </div>
      </div>
    </div>
  );
}
