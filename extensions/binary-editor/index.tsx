/**
 * Binary Editor Extension
 * 高度なバイナリファイルエディター（Hexエディター）
 * Monaco-likeなスクロール管理と仮想化による高パフォーマンス
 */

// biome-ignore lint/style/useImportType: Extension builds use the classic JSX runtime.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ExtensionActivation, ExtensionContext } from '../_shared/types';
import {
  BYTES_PER_ROW,
  findByteSequences,
  formatAddress,
  parseHexInput,
  parseHexString,
  ROW_HEIGHT,
  replaceByteSequence,
  replaceByteSequences,
  toAscii,
  toHex,
  VISIBLE_ROWS_BUFFER,
} from './binaryUtils';
import { useBinaryEditorDocument } from './useBinaryEditorDocument';

// グローバルコンテキスト参照（拡張機能はコンポーネント外からコンテキストにアクセスする必要があるため）
let globalContext: ExtensionContext | null = null;

// ==========================================
// バイナリエディタータブコンポーネント
// ==========================================
interface BinaryEditorTabData {
  filePath?: string;
  fileName?: string;
}

interface BinaryEditorTab {
  id: string;
  data?: BinaryEditorTabData;
}

function BinaryEditorTabComponent({ tab, isActive }: { tab: BinaryEditorTab; isActive: boolean }) {
  const tabData = tab.data ?? {};
  const editorDocument = useBinaryEditorDocument(globalContext, tab.id, tabData.filePath);
  const binaryData = editorDocument.bytes;
  const [selectedOffset, setSelectedOffset] = useState<number | null>(null);
  const [editingOffset, setEditingOffset] = useState<number | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [scrollTop, setScrollTop] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(-1);
  const [showReplace, setShowReplace] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleSave = editorDocument.save;

  useEffect(() => {
    const context = globalContext;
    if (!isActive || !context) return;
    let cancelled = false;
    let unregister = () => {};
    const register = async () => {
      const keybindings = await context.getSystemModule('keybindings');
      if (cancelled) return;
      unregister = keybindings.registerAction('saveFile', () => {
        if (window.document.querySelector('[data-keybinding-scope="quick-input"]')) return;
        void handleSave();
      });
    };
    void register();
    return () => {
      cancelled = true;
      unregister();
    };
  }, [handleSave, isActive]);

  // スクロールハンドラー
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop((e.target as HTMLDivElement).scrollTop);
  }, []);

  // 仮想化されたレンダリング計算
  const { visibleRows, totalHeight } = useMemo(() => {
    const totalRows = Math.ceil(binaryData.length / BYTES_PER_ROW);
    const totalHeight = totalRows * ROW_HEIGHT;

    const containerHeight = containerRef.current?.clientHeight || 600;
    const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VISIBLE_ROWS_BUFFER);
    const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT) + VISIBLE_ROWS_BUFFER * 2;
    const endRow = Math.min(totalRows, startRow + visibleCount);

    const rows: number[] = [];
    for (let i = startRow; i < endRow; i++) {
      rows.push(i);
    }

    return { visibleRows: rows, totalHeight };
  }, [binaryData.length, scrollTop]);

  // バイトクリックハンドラー
  const handleByteClick = useCallback((offset: number) => {
    setSelectedOffset(offset);
    setEditingOffset(null);
  }, []);

  // バイト編集開始
  const handleByteDoubleClick = useCallback(
    (offset: number) => {
      setEditingOffset(offset);
      setEditValue(toHex(binaryData[offset]));
    },
    [binaryData]
  );

  // 編集確定
  const handleEditConfirm = useCallback(() => {
    if (editingOffset === null) return;

    const newValue = parseHexInput(editValue);
    if (newValue !== null) {
      const newData = new Uint8Array(binaryData);
      newData[editingOffset] = newValue;
      editorDocument.setBytes(newData);
    }

    setEditingOffset(null);
    setEditValue('');
  }, [editingOffset, editValue, binaryData, editorDocument.setBytes]);

  // キーボードナビゲーション
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editingOffset !== null) {
        if (e.key === 'Enter') {
          handleEditConfirm();
        } else if (e.key === 'Escape') {
          setEditingOffset(null);
          setEditValue('');
        }
        return;
      }

      if (selectedOffset === null) return;

      let newOffset = selectedOffset;

      switch (e.key) {
        case 'ArrowRight':
          newOffset = Math.min(binaryData.length - 1, selectedOffset + 1);
          break;
        case 'ArrowLeft':
          newOffset = Math.max(0, selectedOffset - 1);
          break;
        case 'ArrowDown':
          newOffset = Math.min(binaryData.length - 1, selectedOffset + BYTES_PER_ROW);
          break;
        case 'ArrowUp':
          newOffset = Math.max(0, selectedOffset - BYTES_PER_ROW);
          break;
        case 'Enter':
          setEditingOffset(selectedOffset);
          setEditValue(toHex(binaryData[selectedOffset]));
          e.preventDefault();
          return;
        default:
          return;
      }

      setSelectedOffset(newOffset);

      const rowIndex = Math.floor(newOffset / BYTES_PER_ROW);
      const targetScrollTop = rowIndex * ROW_HEIGHT;
      const containerHeight = containerRef.current?.clientHeight || 600;

      if (scrollContainerRef.current) {
        if (targetScrollTop < scrollTop) {
          scrollContainerRef.current.scrollTop = targetScrollTop;
        } else if (targetScrollTop + ROW_HEIGHT > scrollTop + containerHeight) {
          scrollContainerRef.current.scrollTop = targetScrollTop - containerHeight + ROW_HEIGHT;
        }
      }

      e.preventDefault();
    },
    [selectedOffset, editingOffset, binaryData, scrollTop, handleEditConfirm]
  );

  // 検索機能
  const handleSearch = useCallback(() => {
    if (!searchQuery) {
      setSearchResults([]);
      setCurrentSearchIndex(-1);
      return;
    }

    const searchBytes = parseHexString(searchQuery);
    if (!searchBytes || searchBytes.length === 0) {
      setSearchResults([]);
      setCurrentSearchIndex(-1);
      return;
    }

    const results = findByteSequences(binaryData, searchBytes);

    setSearchResults(results);
    setCurrentSearchIndex(results.length > 0 ? 0 : -1);

    if (results.length > 0) {
      const offset = results[0];
      setSelectedOffset(offset);
      const rowIndex = Math.floor(offset / BYTES_PER_ROW);
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = rowIndex * ROW_HEIGHT;
      }
    }
  }, [searchQuery, binaryData]);

  // 次の検索結果へ
  const goToNextResult = useCallback(() => {
    if (searchResults.length === 0) return;
    const nextIndex = (currentSearchIndex + 1) % searchResults.length;
    setCurrentSearchIndex(nextIndex);
    const offset = searchResults[nextIndex];
    setSelectedOffset(offset);
    const rowIndex = Math.floor(offset / BYTES_PER_ROW);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = rowIndex * ROW_HEIGHT;
    }
  }, [searchResults, currentSearchIndex]);

  // 置換機能
  const handleReplace = useCallback(() => {
    if (currentSearchIndex < 0 || searchResults.length === 0) return;

    const replaceBytes = parseHexString(replaceQuery);
    if (!replaceBytes) return;

    const searchBytes = parseHexString(searchQuery);
    if (!searchBytes) return;

    const offset = searchResults[currentSearchIndex];
    editorDocument.setBytes(
      replaceByteSequence(binaryData, offset, searchBytes.length, replaceBytes)
    );
    // 検索結果をクリア（次回検索で再計算）
    setSearchResults([]);
    setCurrentSearchIndex(-1);
  }, [
    currentSearchIndex,
    searchResults,
    replaceQuery,
    searchQuery,
    binaryData,
    editorDocument.setBytes,
  ]);

  // 全置換
  const handleReplaceAll = useCallback(() => {
    const searchBytes = parseHexString(searchQuery);
    const replaceBytes = parseHexString(replaceQuery);
    if (!searchBytes || !replaceBytes || searchResults.length === 0) return;

    editorDocument.setBytes(
      replaceByteSequences(binaryData, searchResults, searchBytes.length, replaceBytes)
    );
    setSearchResults([]);
    setCurrentSearchIndex(-1);
  }, [searchQuery, replaceQuery, searchResults, binaryData, editorDocument.setBytes]);

  // 行のレンダリング
  const renderRow = useCallback(
    (rowIndex: number) => {
      const startOffset = rowIndex * BYTES_PER_ROW;
      const rowBytes: number[] = [];

      for (let i = 0; i < BYTES_PER_ROW; i++) {
        const offset = startOffset + i;
        if (offset < binaryData.length) {
          rowBytes.push(binaryData[offset]);
        }
      }

      const isSearchResult = (offset: number) => searchResults.includes(offset);

      return (
        <div
          key={rowIndex}
          style={{
            display: 'flex',
            alignItems: 'center',
            height: ROW_HEIGHT,
            fontFamily: 'monospace',
            fontSize: '13px',
            position: 'absolute',
            top: rowIndex * ROW_HEIGHT,
            left: 0,
            right: 0,
          }}
        >
          {/* アドレスカラム */}
          <div
            style={{
              width: '80px',
              color: '#888',
              paddingLeft: '8px',
              flexShrink: 0,
              userSelect: 'none',
            }}
          >
            {formatAddress(startOffset)}
          </div>

          {/* Hexカラム */}
          <div
            style={{
              display: 'flex',
              gap: '4px',
              paddingLeft: '16px',
              paddingRight: '16px',
              flexShrink: 0,
            }}
          >
            {rowBytes.map((byte, i) => {
              const offset = startOffset + i;
              const isSelected = selectedOffset === offset;
              const isEditing = editingOffset === offset;
              const isResult = isSearchResult(offset);

              return (
                <div
                  key={i}
                  onClick={() => handleByteClick(offset)}
                  onDoubleClick={() => handleByteDoubleClick(offset)}
                  style={{
                    width: '24px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: isEditing
                      ? '#0e639c'
                      : isSelected
                        ? '#264f78'
                        : isResult
                          ? '#4a4a00'
                          : 'transparent',
                    color: isSelected || isEditing ? '#fff' : '#d4d4d4',
                    borderRadius: '2px',
                    marginLeft: i === 8 ? '8px' : '0',
                    userSelect: 'text',
                  }}
                >
                  {isEditing ? (
                    <input
                      type="text"
                      value={editValue}
                      onChange={e => setEditValue(e.target.value.slice(0, 2))}
                      onBlur={handleEditConfirm}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleEditConfirm();
                        if (e.key === 'Escape') {
                          setEditingOffset(null);
                          setEditValue('');
                        }
                        e.stopPropagation();
                      }}
                      autoFocus
                      style={{
                        width: '100%',
                        background: 'transparent',
                        border: 'none',
                        color: '#fff',
                        textAlign: 'center',
                        fontFamily: 'monospace',
                        fontSize: '13px',
                        outline: 'none',
                        padding: 0,
                      }}
                    />
                  ) : (
                    toHex(byte)
                  )}
                </div>
              );
            })}
            {Array.from({ length: BYTES_PER_ROW - rowBytes.length }).map((_, i) => (
              <div
                key={`empty-${i}`}
                style={{
                  width: '24px',
                  marginLeft: rowBytes.length + i === 8 ? '8px' : '0',
                }}
              />
            ))}
          </div>

          {/* ASCIIカラム */}
          <div
            style={{
              display: 'flex',
              borderLeft: '1px solid #333',
              paddingLeft: '16px',
              userSelect: 'none',
            }}
          >
            {rowBytes.map((byte, i) => {
              const offset = startOffset + i;
              const isSelected = selectedOffset === offset;
              const isResult = isSearchResult(offset);

              return (
                <div
                  key={i}
                  onClick={() => handleByteClick(offset)}
                  style={{
                    width: '10px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: isSelected ? '#264f78' : isResult ? '#4a4a00' : 'transparent',
                    color: byte >= 32 && byte <= 126 ? '#d4d4d4' : '#666',
                  }}
                >
                  {toAscii(byte)}
                </div>
              );
            })}
          </div>
        </div>
      );
    },
    [
      binaryData,
      selectedOffset,
      editingOffset,
      editValue,
      searchResults,
      handleByteClick,
      handleByteDoubleClick,
      handleEditConfirm,
    ]
  );

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#1e1e1e',
        color: '#d4d4d4',
        outline: 'none',
      }}
    >
      {/* ツールバー */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          borderBottom: '1px solid #333',
          background: '#252526',
          flexWrap: 'wrap',
        }}
      >
        {/* 検索 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ color: '#888', fontSize: '12px' }}>Find:</span>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSearch();
              e.stopPropagation();
            }}
            placeholder="FF 00..."
            style={{
              width: '100px',
              padding: '4px 8px',
              background: '#3c3c3c',
              border: '1px solid #555',
              borderRadius: '4px',
              color: '#d4d4d4',
              fontSize: '12px',
              fontFamily: 'monospace',
            }}
          />
          <button
            onClick={handleSearch}
            style={{
              padding: '4px 8px',
              background: '#0e639c',
              border: 'none',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Find
          </button>
          {searchResults.length > 0 && (
            <>
              <span style={{ color: '#888', fontSize: '12px' }}>
                {currentSearchIndex + 1}/{searchResults.length}
              </span>
              <button
                onClick={goToNextResult}
                style={{
                  padding: '4px 8px',
                  background: '#333',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#d4d4d4',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                Next
              </button>
            </>
          )}
          <button
            onClick={() => setShowReplace(!showReplace)}
            style={{
              padding: '4px 8px',
              background: showReplace ? '#0e639c' : '#333',
              border: 'none',
              borderRadius: '4px',
              color: '#d4d4d4',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Replace
          </button>
        </div>

        {/* 置換（展開時のみ） */}
        {showReplace && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ color: '#888', fontSize: '12px' }}>With:</span>
            <input
              type="text"
              value={replaceQuery}
              onChange={e => setReplaceQuery(e.target.value)}
              placeholder="00 FF..."
              style={{
                width: '100px',
                padding: '4px 8px',
                background: '#3c3c3c',
                border: '1px solid #555',
                borderRadius: '4px',
                color: '#d4d4d4',
                fontSize: '12px',
                fontFamily: 'monospace',
              }}
            />
            <button
              onClick={handleReplace}
              disabled={currentSearchIndex < 0}
              style={{
                padding: '4px 8px',
                background: currentSearchIndex >= 0 ? '#0e639c' : '#333',
                border: 'none',
                borderRadius: '4px',
                color: currentSearchIndex >= 0 ? '#fff' : '#666',
                fontSize: '12px',
                cursor: currentSearchIndex >= 0 ? 'pointer' : 'default',
              }}
            >
              Replace
            </button>
            <button
              onClick={handleReplaceAll}
              disabled={searchResults.length === 0}
              style={{
                padding: '4px 8px',
                background: searchResults.length > 0 ? '#0e639c' : '#333',
                border: 'none',
                borderRadius: '4px',
                color: searchResults.length > 0 ? '#fff' : '#666',
                fontSize: '12px',
                cursor: searchResults.length > 0 ? 'pointer' : 'default',
              }}
            >
              Replace All
            </button>
          </div>
        )}

        {/* ステータス & 保存 */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#888', fontSize: '12px' }}>
            {binaryData.length.toLocaleString()} bytes
          </span>
          {selectedOffset !== null && (
            <span style={{ color: '#888', fontSize: '12px' }}>
              @ 0x{formatAddress(selectedOffset)}
            </span>
          )}
          {editorDocument.isModified && (
            <span style={{ color: '#f48771', fontSize: '12px', fontWeight: 'bold' }}>Modified</span>
          )}
          <button
            onClick={handleSave}
            disabled={
              !editorDocument.isModified || editorDocument.isSaving || !editorDocument.isLoaded
            }
            style={{
              padding: '4px 12px',
              background:
                editorDocument.isModified && !editorDocument.isSaving ? '#0e639c' : '#333',
              border: 'none',
              borderRadius: '4px',
              color: editorDocument.isModified && !editorDocument.isSaving ? '#fff' : '#666',
              fontSize: '12px',
              cursor: editorDocument.isModified && !editorDocument.isSaving ? 'pointer' : 'default',
            }}
          >
            {editorDocument.isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* ヘッダー行 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: '24px',
          borderBottom: '1px solid #333',
          background: '#2d2d2d',
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#888',
          userSelect: 'none',
        }}
      >
        <div style={{ width: '80px', paddingLeft: '8px' }}>Offset</div>
        <div style={{ paddingLeft: '16px' }}>
          {Array.from({ length: BYTES_PER_ROW }).map((_, i) => (
            <span
              key={i}
              style={{
                display: 'inline-block',
                width: '24px',
                textAlign: 'center',
                marginRight: '4px',
                marginLeft: i === 8 ? '8px' : '0',
              }}
            >
              {toHex(i)}
            </span>
          ))}
        </div>
        <div style={{ borderLeft: '1px solid #333', paddingLeft: '16px' }}>ASCII</div>
      </div>

      {/* スクロール可能なコンテンツ領域 */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflow: 'auto',
          position: 'relative',
        }}
      >
        {editorDocument.isLoaded && (
          <div style={{ height: totalHeight, position: 'relative' }}>
            {visibleRows.map(rowIndex => renderRow(rowIndex))}
          </div>
        )}
        {!editorDocument.isLoaded && (
          <div style={{ padding: '16px', color: editorDocument.error ? '#f48771' : '#888' }}>
            {editorDocument.error || 'Loading file...'}
          </div>
        )}
      </div>

      {/* ステータスバー */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '4px 16px',
          borderTop: '1px solid #333',
          background: '#007acc',
          color: '#fff',
          fontSize: '11px',
          userSelect: 'none',
        }}
      >
        <span>Binary Editor</span>
        <span style={{ marginLeft: 'auto' }}>{tabData.fileName || 'Unknown file'}</span>
      </div>
    </div>
  );
}

// ==========================================
// 拡張機能のアクティベーション
// ==========================================
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('Binary Editor Extension activated!');

  // グローバルコンテキストを保存
  globalContext = context;

  // タブコンポーネントを登録
  context.tabs.registerTabType(BinaryEditorTabComponent);
  context.logger.info('Binary editor tab component registered');

  // Explorerコンテキストメニューに「Open with Binary Editor」項目を追加
  context.explorerMenu.addMenuItem({
    id: 'open-binary-editor',
    label: 'Open with Binary Editor',
    icon: 'Binary',
    when: 'file',
    order: 10,
    handler: async file => {
      context.logger.info(`Opening file with Binary Editor: ${file.path}`);

      context.tabs.createTab({
        id: file.id,
        title: `Binary: ${file.name}`,
        icon: 'Binary',
        closable: true,
        activateAfterCreate: true,
        data: {
          fileName: file.name,
          filePath: file.path,
        },
      });
    },
  });
  context.logger.info('Binary editor context menu item registered');

  return {};
}

export async function deactivate(): Promise<void> {
  globalContext = null;
  console.log('[Binary Editor] Extension deactivated');
}
