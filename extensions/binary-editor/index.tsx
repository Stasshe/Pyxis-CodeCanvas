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

function parseHexString(hex: string): number[] | null {
  const cleaned = hex.replace(/\s/g, '');
  if (!/^[0-9a-fA-F]*$/.test(cleaned)) return null;
  if (cleaned.length === 0 || cleaned.length % 2 !== 0) return null;
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes.push(parseInt(cleaned.substring(i, i + 2), 16));
  }
  return bytes;
}

// グローバルコンテキスト参照（拡張機能はコンポーネント外からコンテキストにアクセスする必要があるため）
let globalContext: ExtensionContext | null = null;

// ==========================================
// バイナリエディタータブコンポーネント
// ==========================================
function BinaryEditorTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  const tabData = (tab as any).data || {};
  const [binaryData, setBinaryData] = useState<Uint8Array>(new Uint8Array(0));
  const [originalData, setOriginalData] = useState<Uint8Array>(new Uint8Array(0));
  const [selectedOffset, setSelectedOffset] = useState<number | null>(null);
  const [editingOffset, setEditingOffset] = useState<number | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [scrollTop, setScrollTop] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(-1);
  const [isModified, setIsModified] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // ファイルデータの読み込み
  useEffect(() => {
    if (tabData.bufferContent) {
      const buffer = tabData.bufferContent;
      let data: Uint8Array;
      if (buffer instanceof ArrayBuffer) {
        data = new Uint8Array(buffer);
      } else if (buffer instanceof Uint8Array) {
        data = new Uint8Array(buffer);
      } else if (typeof buffer === 'string') {
        try {
          const binary = atob(buffer);
          data = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            data[i] = binary.charCodeAt(i);
          }
        } catch (e) {
          console.error('Failed to decode base64:', e);
          data = new Uint8Array(0);
        }
      } else {
        data = new Uint8Array(0);
      }
      setBinaryData(data);
      setOriginalData(new Uint8Array(data));
    }
  }, [tabData.bufferContent]);

  // 変更検出
  useEffect(() => {
    if (binaryData.length !== originalData.length) {
      setIsModified(true);
      return;
    }
    for (let i = 0; i < binaryData.length; i++) {
      if (binaryData[i] !== originalData[i]) {
        setIsModified(true);
        return;
      }
    }
    setIsModified(false);
  }, [binaryData, originalData]);

  // 保存機能
  const handleSave = useCallback(async () => {
    if (!globalContext || !tabData.filePath || !tabData.projectId) {
      console.error('Cannot save: missing context or file info');
      return;
    }
    
    setIsSaving(true);
    try {
      const fileRepo = await globalContext.getSystemModule('fileRepository');
      
      // 既存のファイルを取得
      const existingFile = await fileRepo.getFileByPath(tabData.projectId, tabData.filePath);
      if (!existingFile) {
        throw new Error('File not found');
      }
      
      // バイナリデータで更新
      const updatedFile = {
        ...existingFile,
        content: '',
        isBufferArray: true,
        bufferContent: binaryData.buffer.slice(
          binaryData.byteOffset,
          binaryData.byteOffset + binaryData.byteLength
        ),
        updatedAt: new Date(),
      };
      
      await fileRepo.saveFile(updatedFile);
      
      setOriginalData(new Uint8Array(binaryData));
      setIsModified(false);
      globalContext.logger.info(`Saved: ${tabData.filePath}`);
    } catch (error) {
      console.error('Failed to save:', error);
      globalContext?.logger.error(`Failed to save: ${error}`);
    } finally {
      setIsSaving(false);
    }
  }, [binaryData, tabData.filePath, tabData.projectId]);

  // Ctrl+Sで保存
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && isActive) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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

    const searchBytes = parseHexString(searchQuery);
    if (!searchBytes || searchBytes.length === 0) {
      setSearchResults([]);
      setCurrentSearchIndex(-1);
      return;
    }

    const results: number[] = [];
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
    const newData = new Uint8Array(binaryData.length - searchBytes.length + replaceBytes.length);
    
    // コピー：置換前
    newData.set(binaryData.slice(0, offset), 0);
    // コピー：置換データ
    newData.set(replaceBytes, offset);
    // コピー：置換後
    newData.set(binaryData.slice(offset + searchBytes.length), offset + replaceBytes.length);
    
    setBinaryData(newData);
    // 検索結果をクリア（次回検索で再計算）
    setSearchResults([]);
    setCurrentSearchIndex(-1);
  }, [currentSearchIndex, searchResults, replaceQuery, searchQuery, binaryData]);

  // 全置換
  const handleReplaceAll = useCallback(() => {
    const searchBytes = parseHexString(searchQuery);
    const replaceBytes = parseHexString(replaceQuery);
    if (!searchBytes || !replaceBytes || searchResults.length === 0) return;
    
    // 後ろから置換（オフセットがずれないように）
    let newData = new Uint8Array(binaryData);
    const sortedResults = [...searchResults].sort((a, b) => b - a);
    
    for (const offset of sortedResults) {
      const before = newData.slice(0, offset);
      const after = newData.slice(offset + searchBytes.length);
      const temp = new Uint8Array(before.length + replaceBytes.length + after.length);
      temp.set(before, 0);
      temp.set(replaceBytes, before.length);
      temp.set(after, before.length + replaceBytes.length);
      newData = temp;
    }
    
    setBinaryData(newData);
    setSearchResults([]);
    setCurrentSearchIndex(-1);
  }, [searchQuery, replaceQuery, searchResults, binaryData]);

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
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
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
              onChange={(e) => setReplaceQuery(e.target.value)}
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
          {isModified && (
            <span style={{ color: '#f48771', fontSize: '12px', fontWeight: 'bold' }}>
              Modified
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={!isModified || isSaving}
            style={{
              padding: '4px 12px',
              background: isModified && !isSaving ? '#0e639c' : '#333',
              border: 'none',
              borderRadius: '4px',
              color: isModified && !isSaving ? '#fff' : '#666',
              fontSize: '12px',
              cursor: isModified && !isSaving ? 'pointer' : 'default',
            }}
          >
            {isSaving ? 'Saving...' : 'Save'}
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
          userSelect: 'none',
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
    binaryOnly: true,
    order: 10,
    handler: async (file, menuContext) => {
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
  globalContext = null;
  console.log('[Binary Editor] Extension deactivated');
}
