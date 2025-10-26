'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from '@/context/I18nContext';
import { FileItem, EditorPane } from '@/types';
import { useTheme } from '@/context/ThemeContext';
import { handleFileSelect } from '@/hooks/fileSelectHandlers';
import { flattenPanes } from '@/hooks/pane';
import { useSettings } from '@/hooks/useSettings';
import { useProject } from '@/engine/core/project';
import { getIconForFile } from 'vscode-icons-js';

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

// --- VSCode-style matching helpers ---
// CamelCase/snake_case boundaries を考慮したスコアリング
function scoreMatch(text: string, query: string): number {
  if (!query) return 100;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  
  // 完全一致
  if (t === q) return 100;
  
  // 前方一致（高スコア）
  if (t.startsWith(q)) return 90;
  
  // 部分文字列一致
  const idx = t.indexOf(q);
  if (idx !== -1) {
    // 単語の境界で始まる場合はスコアを上げる
    const isBoundary = idx === 0 || text[idx - 1] === '/' || text[idx - 1] === '_' || text[idx - 1] === '-';
    return isBoundary ? 85 : 70;
  }
  
  // CamelCase マッチング (e.g., "ow" matches "OperationWindow")
  const camelIndices: number[] = [];
  let queryIdx = 0;
  for (let i = 0; i < text.length && queryIdx < query.length; i++) {
    if (text[i].toLowerCase() === query[queryIdx].toLowerCase()) {
      const isUpperCase = text[i] === text[i].toUpperCase() && text[i] !== text[i].toLowerCase();
      const isBoundary = i === 0 || text[i - 1] === '/' || text[i - 1] === '_' || text[i - 1] === '-';
      if (isUpperCase || isBoundary || queryIdx > 0) {
        camelIndices.push(i);
        queryIdx++;
      }
    }
  }
  if (queryIdx === query.length) return 60;
  
  return 0; // マッチしない
}

function getIconSrcForFile(name: string) {
  const iconPath = getIconForFile(name) || getIconForFile('');
  if (iconPath && iconPath.endsWith('.svg')) {
    return `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/${iconPath.split('/').pop()}`;
  }
  return `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/file.svg`;
}

interface OperationWindowProps {
  isVisible: boolean;
  onClose: () => void;
  projectFiles: FileItem[];
  onFileSelect?: (file: FileItem) => void;
  editors: EditorPane[];
  setEditors: React.Dispatch<React.SetStateAction<EditorPane[]>>;
  setFileSelectState: (state: { open: boolean; paneIdx: number | null }) => void;
  currentPaneIndex?: number | null; // 現在のペインインデックス
  aiMode?: boolean; // AI用モード（ファイルをタブで開かない）
}

export default function OperationWindow({
  isVisible,
  onClose,
  projectFiles,
  onFileSelect,
  editors,
  setEditors,
  setFileSelectState,
  currentPaneIndex,
  aiMode = false,
}: OperationWindowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mdPreviewPrompt, setMdPreviewPrompt] = useState<null | { file: FileItem }>(null);
  const [mdDialogSelected, setMdDialogSelected] = useState<0 | 1>(0); // 0: プレビュー, 1: 通常エディタ
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // 固定アイテム高さを定義（スクロール計算と見た目の基準にする）
  const ITEM_HEIGHT = 22; // VSCodeに合わせてよりコンパクトに

  // ファイル選択ハンドラ
  const handleFileSelectInOperation = (file: FileItem) => {
    // AIモードの場合は.mdの確認ダイアログは不要なので直接処理する
    if (aiMode) {
      actuallyOpenFile(file, false);
      return;
    }

    if (file.name.toLowerCase().endsWith('.md')) {
      setMdPreviewPrompt({ file });
      return;
    }
    actuallyOpenFile(file, false);
  };

  // 実際にファイルを開く処理（mdプレビューかどうかを指定）
  const actuallyOpenFile = (file: FileItem, preview: boolean) => {
    if (aiMode) {
      if (onFileSelect) {
        onFileSelect(file);
      }
      onClose();
      return;
    }
    const flatPanes = flattenPanes(editors);
    if (flatPanes.length === 0) return;
    const paneIdx = currentPaneIndex ?? 0;
    if (preview) {
      // mdプレビューで開く
      import('@/hooks/fileSelectHandlers').then(mod => {
        mod.handleFilePreview({
          file,
          fileSelectState: { open: true, paneIdx },
          currentProject: null,
          projectFiles,
          editors,
          setEditors,
        });
      });
    } else {
      handleFileSelect({
        file,
        fileSelectState: { open: true, paneIdx },
        currentProject: null,
        projectFiles,
        editors,
        setEditors,
      });
    }
    onClose();
  };

  // 設定から除外パターンを取得
  const { currentProject } = useProject();
  const { isExcluded } = useSettings(currentProject?.id);
  // 除外判定はuseSettingsから取得
  // 検索ロジック（ファイル名・フォルダ名・パスのいずれかに一致）
  const allFiles = flattenFileItems(projectFiles).filter(
    file => file.type === 'file' && !(typeof isExcluded === 'function' && isExcluded(file.path))
  );
  
  // Enhanced VSCode-style filtering + scoring
  const filteredFiles: FileItem[] = (() => {
    if (!searchQuery) return allFiles;
    const q = searchQuery.trim();
    const scored: Array<{ file: FileItem; score: number; matchedPart: string }> = [];
    
    for (const file of allFiles) {
      const fileName = file.name;
      const fileNameNoExt = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
      const pathParts = file.path.split('/');
      
      // ファイル名のスコア（最優先）
      const nameScore = scoreMatch(fileName, q);
      // 拡張子なしファイル名のスコア
      const nameNoExtScore = scoreMatch(fileNameNoExt, q);
      // パス全体のスコア
      const pathScore = scoreMatch(file.path, q);
      // 各パス要素のスコア
      const partScores = pathParts.map(part => scoreMatch(part, q));
      const bestPartScore = Math.max(...partScores, 0);
      
      const best = Math.max(nameScore, nameNoExtScore, pathScore, bestPartScore);
      
      // スコアが0より大きい（何らかのマッチがある）場合のみ含める
      if (best > 0) {
        scored.push({ 
          file, 
          score: best,
          matchedPart: nameScore >= bestPartScore ? 'name' : 'path'
        });
      }
    }
    
    // スコア降順、同スコアなら名前の辞書順
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.file.name.localeCompare(b.file.name);
    });
    
    return scored.map(s => s.file);
  })();

  // 選択されたアイテムにスクロールする関数
  const scrollToSelectedItem = (index: number) => {
    if (!listRef.current) return;

    const listElement = listRef.current;
    const itemHeight = ITEM_HEIGHT;
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

  // ESCキーで閉じる、上下キーで選択、Enterで開く、Tabでmdプレビューダイアログのボタン切り替え
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isVisible) return;

      // mdプレビュー選択ダイアログが表示中
      if (mdPreviewPrompt) {
        if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          setMdDialogSelected(prev => (prev === 0 ? 1 : 0));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (mdDialogSelected === 0) {
            actuallyOpenFile(mdPreviewPrompt.file, true);
          } else {
            actuallyOpenFile(mdPreviewPrompt.file, false);
          }
          setMdPreviewPrompt(null);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setMdPreviewPrompt(null);
        }
        return;
      }

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
            handleFileSelectInOperation(filteredFiles[selectedIndex]);
          }
          break;
      }
    };

    if (isVisible) {
      document.addEventListener('keydown', handleKeyDown);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    isVisible,
    filteredFiles,
    selectedIndex,
    onClose,
    editors,
    setEditors,
    setFileSelectState,
    handleFileSelectInOperation,
    mdPreviewPrompt,
    mdDialogSelected,
  ]);

  // 検索クエリが変更されたときに選択インデックスをリセット
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  // 表示されていない場合は何も表示しない
  if (!isVisible) return null;

  return (
    <>
      {/* mdプレビュー選択ダイアログを最前面に移動 */}
      {mdPreviewPrompt && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 3000, // より高いz-index
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setMdPreviewPrompt(null)}
        >
          <div
            style={{
              background: colors.cardBg,
              border: `1px solid ${colors.border}`,
              borderRadius: '8px',
              padding: '32px 24px',
              minWidth: '320px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '18px',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div
              style={{
                fontSize: '16px',
                fontWeight: 'bold',
                marginBottom: '8px',
                color: colors.foreground,
              }}
            >
              {t('operationWindow.mdPreviewPrompt')}
            </div>
            <div style={{ color: colors.mutedFg, fontSize: '13px', marginBottom: '12px' }}>
              {mdPreviewPrompt.file.name}
            </div>
            <div style={{ display: 'flex', gap: '16px' }}>
              <button
                style={{
                  padding: '8px 18px',
                  background: mdDialogSelected === 0 ? colors.primary : colors.background,
                  color: mdDialogSelected === 0 ? colors.cardBg : colors.foreground,
                  border:
                    mdDialogSelected === 0
                      ? `2px solid ${colors.accentBg}`
                      : `1px solid ${colors.border}`,
                  borderRadius: '4px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  outline: mdDialogSelected === 0 ? '2px solid ' + colors.primary : undefined,
                }}
                tabIndex={0}
                autoFocus={mdDialogSelected === 0}
                onClick={() => {
                  actuallyOpenFile(mdPreviewPrompt.file, true);
                  setMdPreviewPrompt(null);
                }}
              >
                {t('operationWindow.openInPreview')}
              </button>
              <button
                style={{
                  padding: '8px 18px',
                  background: mdDialogSelected === 1 ? colors.primary : colors.background,
                  color: mdDialogSelected === 1 ? colors.cardBg : colors.foreground,
                  border:
                    mdDialogSelected === 1
                      ? `2px solid ${colors.accentBg}`
                      : `1px solid ${colors.border}`,
                  borderRadius: '4px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  outline: mdDialogSelected === 1 ? '2px solid ' + colors.primary : undefined,
                }}
                tabIndex={0}
                autoFocus={mdDialogSelected === 1}
                onClick={() => {
                  actuallyOpenFile(mdPreviewPrompt.file, false);
                  setMdPreviewPrompt(null);
                }}
              >
                {t('operationWindow.openInEditor')}
              </button>
            </div>
            <div style={{ fontSize: '12px', color: colors.mutedFg, marginTop: '8px' }}>
              {t('operationWindow.mdPreviewDialogHelp')}
            </div>
          </div>
        </div>
      )}
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
          zIndex: 2000,
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
          onClick={e => e.stopPropagation()}
        >
          {/* 検索入力欄のみ */}
          <div style={{ padding: '12px' }}>
            <input
              ref={inputRef}
              type="text"
              placeholder={t('operationWindow.searchPlaceholder')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
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
                {t('operationWindow.noFilesFound')}
              </div>
            ) : (
              filteredFiles.map((file, index) => {
                // VSCode風のハイライト関数（一致部分を正確に検出）
                function highlightMatch(text: string, query: string, isSelected: boolean) {
                  if (!query) return <>{text}</>;
                  
                  const lowerText = text.toLowerCase();
                  const lowerQuery = query.toLowerCase();
                  const idx = lowerText.indexOf(lowerQuery);
                  
                  if (idx === -1) return <>{text}</>;
                  
                  return (
                    <>
                      {text.slice(0, idx)}
                      <span
                        style={{
                          background: isSelected ? 'rgba(255,255,255,0.3)' : colors.accentBg,
                          color: isSelected ? colors.cardBg : colors.primary,
                          fontWeight: 'bold',
                          borderRadius: '2px',
                          padding: '0 1px',
                        }}
                      >
                        {text.slice(idx, idx + query.length)}
                      </span>
                      {text.slice(idx + query.length)}
                    </>
                  );
                }
                
                const isSelected = index === selectedIndex;
                const pathParts = file.path.split('/');
                const dirPath = pathParts.slice(0, -1).join('/');
                
                return (
                  <div
                    key={file.id}
                    style={{
                      height: ITEM_HEIGHT,
                      boxSizing: 'border-box',
                      padding: '2px 12px',
                      background: isSelected ? colors.primary : 'transparent',
                      color: isSelected ? colors.cardBg : colors.foreground,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      borderLeft: isSelected ? `3px solid ${colors.accentBg}` : '3px solid transparent',
                      transition: 'background 0.1s ease',
                    }}
                    onClick={() => {
                      handleFileSelectInOperation(file);
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    {/* ファイルアイコン */}
                    <img
                      src={getIconSrcForFile(file.name)}
                      alt="icon"
                      style={{
                        width: 16,
                        height: 16,
                        flex: '0 0 16px',
                      }}
                    />
                    
                    {/* ファイル名（左寄せ） */}
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: isSelected ? '600' : '400',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        minWidth: '120px',
                        maxWidth: '200px',
                      }}
                    >
                      {highlightMatch(file.name, searchQuery, isSelected)}
                    </span>
                    
                    {/* パス（右側に配置、右寄せ） */}
                    {dirPath && (
                      <span
                        style={{
                          fontSize: '11px',
                          color: isSelected ? 'rgba(255,255,255,0.8)' : colors.mutedFg,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          marginLeft: 'auto',
                          fontFamily: 'monospace',
                          textAlign: 'right',
                        }}
                      >
                        {highlightMatch(dirPath, searchQuery, isSelected)}
                      </span>
                    )}
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
            <span>{t('operationWindow.footerHelp')}</span>
            <span
              style={{
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
              onClick={onClose}
              tabIndex={0}
              role="button"
              aria-label={t('operationWindow.closeByEsc')}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  onClose();
                }
              }}
            >
              {t('operationWindow.closeByEsc')}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
