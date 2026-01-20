/**
 * Binary Editor Extension
 * 高度なバイナリファイルエディター（Hexエディター）
 * Monaco-likeなスクロール管理と仮想化による高パフォーマンス
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

// ==========================================
// 定数
// ==========================================
const BYTES_PER_ROW = 16;
const ROW_HEIGHT = 22;
const VISIBLE_ROWS_BUFFER = 5;

// ==========================================
// ユーティリティ関数
// ==========================================
function toHex(byte: number): string {
  return byte.toString(16).padStart(2, '0').toUpperCase();
}

function toAscii(byte: number): string {
  if (byte >= 32 && byte <= 126) {
    return String.fromCharCode(byte);
  }
  return '.';
}

function formatAddress(address: number, length: number = 8): string {
  return address.toString(16).padStart(length, '0').toUpperCase();
}

function parseHexInput(value: string): number | null {
  const cleaned = value.replace(/[^0-9a-fA-F]/g, '');
  if (cleaned.length === 0) return null;
  const num = parseInt(cleaned, 16);
  if (isNaN(num) || num < 0 || num > 255) return null;
  return num;
}

// ==========================================
// バイナリエディタータブコンポーネント
// ==========================================
function BinaryEditorTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  const tabData = (tab as any).data || {};
  const [binaryData, setBinaryData] = useState<Uint8Array>(new Uint8Array(0));
  const [selectedOffset, setSelectedOffset] = useState<number | null>(null);
  const [editingOffset, setEditingOffset] = useState<number | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [scrollTop, setScrollTop] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(-1);
  const [isModified, setIsModified] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // ファイルデータの読み込み
  useEffect(() => {
    if (tabData.bufferContent) {
      // ArrayBufferをUint8Arrayに変換
      const buffer = tabData.bufferContent;
      if (buffer instanceof ArrayBuffer) {
        setBinaryData(new Uint8Array(buffer));
      } else if (buffer instanceof Uint8Array) {
        setBinaryData(buffer);
      } else if (typeof buffer === 'string') {
        // Base64文字列の場合
        try {
          const binary = atob(buffer);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          setBinaryData(bytes);
        } catch (e) {
          console.error('Failed to decode base64:', e);
        }
      }
    }
  }, [tabData.bufferContent]);

  // スクロールハンドラー
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop((e.target as HTMLDivElement).scrollTop);
  }, []);

  // 仮想化されたレンダリング計算
  const { visibleRows, totalHeight, startRow, endRow } = useMemo(() => {
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
    
    return { visibleRows: rows, totalHeight, startRow, endRow };
  }, [binaryData.length, scrollTop]);

  // バイトクリックハンドラー
  const handleByteClick = useCallback((offset: number) => {
    setSelectedOffset(offset);
    setEditingOffset(null);
  }, []);

  // バイト編集開始
  const handleByteDoubleClick = useCallback((offset: number) => {
    setEditingOffset(offset);
    setEditValue(toHex(binaryData[offset]));
  }, [binaryData]);

  // 編集確定
  const handleEditConfirm = useCallback(() => {
    if (editingOffset === null) return;
    
    const newValue = parseHexInput(editValue);
    if (newValue !== null) {
      const newData = new Uint8Array(binaryData);
      newData[editingOffset] = newValue;
      setBinaryData(newData);
      setIsModified(true);
    }
    
    setEditingOffset(null);
    setEditValue('');
  }, [editingOffset, editValue, binaryData]);

  // キーボードナビゲーション
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
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
    
    // 選択バイトが見えるようにスクロール
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
  }, [selectedOffset, editingOffset, binaryData, scrollTop, handleEditConfirm]);

  // 検索機能
  const handleSearch = useCallback(() => {
    if (!searchQuery) {
      setSearchResults([]);
      setCurrentSearchIndex(-1);
      return;
    }

    const query = searchQuery.toLowerCase();
    const results: number[] = [];

    // Hex検索（例: "FF 00"）
    if (/^[0-9a-f\s]+$/i.test(query)) {
      const hexBytes = query.replace(/\s/g, '').match(/.{1,2}/g);
      if (hexBytes) {
        const searchBytes = hexBytes.map(h => parseInt(h, 16));
        for (let i = 0; i <= binaryData.length - searchBytes.length; i++) {
          let match = true;
          for (let j = 0; j < searchBytes.length; j++) {
            if (binaryData[i + j] !== searchBytes[j]) {
              match = false;
              break;
            }
          }
          if (match) results.push(i);
        }
      }
    }

    setSearchResults(results);
    setCurrentSearchIndex(results.length > 0 ? 0 : -1);
    
    // 最初の結果にジャンプ
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

  // 行のレンダリング
  const renderRow = useCallback((rowIndex: number) => {
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
                }}
              >
                {isEditing ? (
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value.slice(0, 2))}
                    onBlur={handleEditConfirm}
                    onKeyDown={(e) => {
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
          {/* 空のセルで行を埋める */}
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
                  background: isSelected
                    ? '#264f78'
                    : isResult
                    ? '#4a4a00'
                    : 'transparent',
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
  }, [binaryData, selectedOffset, editingOffset, editValue, searchResults, handleByteClick, handleByteDoubleClick, handleEditConfirm]);

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
          gap: '16px',
          padding: '8px 16px',
          borderBottom: '1px solid #333',
          background: '#252526',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#888', fontSize: '12px' }}>Search (Hex):</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
              e.stopPropagation();
            }}
            placeholder="FF 00 AB..."
            style={{
              width: '150px',
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
              padding: '4px 12px',
              background: '#0e639c',
              border: 'none',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Search
          </button>
          {searchResults.length > 0 && (
            <>
              <span style={{ color: '#888', fontSize: '12px' }}>
                {currentSearchIndex + 1} / {searchResults.length}
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
        </div>
        
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ color: '#888', fontSize: '12px' }}>
            Size: {binaryData.length.toLocaleString()} bytes
          </span>
          {selectedOffset !== null && (
            <span style={{ color: '#888', fontSize: '12px' }}>
              Offset: 0x{formatAddress(selectedOffset)} ({selectedOffset})
            </span>
          )}
          {isModified && (
            <span style={{ color: '#f48771', fontSize: '12px', fontWeight: 'bold' }}>
              Modified
            </span>
          )}
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
        <div style={{ borderLeft: '1px solid #333', paddingLeft: '16px' }}>
          ASCII
        </div>
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
        {/* 仮想化コンテンツ */}
        <div style={{ height: totalHeight, position: 'relative' }}>
          {visibleRows.map((rowIndex) => renderRow(rowIndex))}
        </div>
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
        }}
      >
        <span>Binary Editor</span>
        <span style={{ marginLeft: 'auto' }}>
          {tabData.fileName || 'Unknown file'}
        </span>
      </div>
    </div>
  );
}

// ==========================================
// サイドバーパネル
// ==========================================
function createBinaryEditorPanel(context: ExtensionContext) {
  return function BinaryEditorPanel({ extensionId, panelId, isActive, state }: any) {
    return (
      <div
        style={{
          padding: '16px',
          color: '#d4d4d4',
          height: '100%',
          background: '#1e1e1e',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <span style={{ fontSize: '20px' }}>01</span>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Binary Editor</h3>
        </div>
        
        <div style={{ color: '#888', fontSize: '12px', lineHeight: 1.6 }}>
          <p style={{ marginBottom: '12px' }}>
            Hex editor for binary files.
          </p>
          <p style={{ marginBottom: '12px' }}>
            Right-click or long-press a binary file in Explorer to open it with Binary Editor.
          </p>
          <div style={{ marginTop: '16px', padding: '12px', background: '#2d2d2d', borderRadius: '4px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Keyboard shortcuts:</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '11px' }}>
              <span>Arrow keys</span><span>Navigate</span>
              <span>Enter</span><span>Edit byte</span>
              <span>Escape</span><span>Cancel edit</span>
            </div>
          </div>
        </div>
      </div>
    );
  };
}

// ==========================================
// 拡張機能のアクティベーション
// ==========================================
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('Binary Editor Extension activated!');

  // タブコンポーネントを登録
  context.tabs.registerTabType(BinaryEditorTabComponent);
  context.logger.info('Binary editor tab component registered');

  // サイドバーパネルを登録
  const BinaryEditorPanelWithContext = createBinaryEditorPanel(context);
  context.sidebar.createPanel({
    id: 'binary-editor-panel',
    title: 'Binary Editor',
    icon: 'Binary',
    component: BinaryEditorPanelWithContext,
  });
  context.logger.info('Binary editor sidebar panel registered');

  // Explorerコンテキストメニューに「Open with Binary Editor」項目を追加
  context.explorerMenu.addMenuItem({
    id: 'open-binary-editor',
    label: 'Open with Binary Editor',
    icon: 'Binary',
    when: 'file',
    binaryOnly: true,
    order: 10,
    handler: async (file, menuContext) => {
      context.logger.info(`Opening file with Binary Editor: ${file.path}`);
      
      // バイナリエディタータブを開く
      context.tabs.createTab({
        id: file.id,
        title: `Binary: ${file.name}`,
        icon: 'Binary',
        closable: true,
        activateAfterCreate: true,
        data: {
          fileName: file.name,
          filePath: file.path,
          bufferContent: file.bufferContent,
          projectName: menuContext.projectName,
          projectId: menuContext.projectId,
        },
      });
    },
  });
  context.logger.info('Binary editor context menu item registered');

  return {};
}

export async function deactivate(): Promise<void> {
  console.log('[Binary Editor] Extension deactivated');
}
