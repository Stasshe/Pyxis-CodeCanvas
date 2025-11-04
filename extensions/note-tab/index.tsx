/**
 * Note Tab Extension (TSX版サンプル)
 * TSX構文を使用した実装例
 */

import React, { useState, useEffect } from 'react';

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

// メモタブコンポーネント（TSX構文使用）
function NoteTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  const [content, setContent] = useState((tab as any).data?.content || '');
  const [isSaving, setIsSaving] = useState(false);

  // 自動保存
  useEffect(() => {
    const timer = setTimeout(() => {
      const tabData = (tab as any).data;
      const noteKey = tabData?.noteKey || `note-tab-${tab.id}`;
      
      if (content !== tabData?.content) {
        setIsSaving(true);
        localStorage.setItem(noteKey, content);
        localStorage.setItem(`${noteKey}-timestamp`, Date.now().toString());
        
        window.dispatchEvent(new CustomEvent('note-updated', { 
          detail: { noteKey } 
        }));
        
        setTimeout(() => setIsSaving(false), 500);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [content, tab.id]);

  // TSX構文で記述！
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#1e1e1e',
        color: '#d4d4d4',
      }}
    >
      {/* ヘッダー */}
      <div
        style={{
          padding: '8px 16px',
          borderBottom: '1px solid #333',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '14px',
        }}
      >
        <span style={{ fontWeight: 'bold' }}>📝 Quick Note</span>
        {isSaving && <span style={{ fontSize: '12px', color: '#888' }}>Saving...</span>}
      </div>
      
      {/* テキストエリア */}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Type your notes here..."
        style={{
          flex: 1,
          width: '100%',
          padding: '16px',
          background: '#1e1e1e',
          color: '#d4d4d4',
          border: 'none',
          outline: 'none',
          fontFamily: 'monospace',
          fontSize: '14px',
          resize: 'none',
        }}
      />
    </div>
  );
}

// サイドバーパネルコンポーネント（TSX構文使用）
function createNotesListPanel(context: ExtensionContext) {
  return function NotesListPanel({ extensionId, panelId, isActive, state }: any) {
    const [notes, setNotes] = useState<Array<{ key: string; content: string; timestamp: number }>>([]);
    const [hoveredKey, setHoveredKey] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

    const loadNotes = () => {
      const allNotes: Array<{ key: string; content: string; timestamp: number }> = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('note-tab-')) {
          const content = localStorage.getItem(key) || '';
          const timestampStr = localStorage.getItem(`${key}-timestamp`);
          const timestamp = timestampStr ? parseInt(timestampStr, 10) : Date.now();
          allNotes.push({ key, content, timestamp });
        }
      }
      // 最新順にソート
      allNotes.sort((a, b) => b.timestamp - a.timestamp);
      setNotes(allNotes);
    };

    useEffect(() => {
      loadNotes();
      
      const handleNoteUpdate = () => loadNotes();
      window.addEventListener('note-updated', handleNoteUpdate);
      
      return () => {
        window.removeEventListener('note-updated', handleNoteUpdate);
      };
    }, [isActive]);

    const openNote = (noteKey: string) => {
      const content = localStorage.getItem(noteKey) || '';
      const noteTitle = content.split('\n')[0].slice(0, 20) || 'Untitled Note';
      
      if (context.tabs) {
        context.tabs.createTab({
          title: `📝 ${noteTitle}`,
          icon: 'FileText',
          closable: true,
          activateAfterCreate: true,
          data: { content, noteKey },
        });
      }
    };

    const deleteNote = (noteKey: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (confirmDelete === noteKey) {
        localStorage.removeItem(noteKey);
        localStorage.removeItem(`${noteKey}-timestamp`);
        loadNotes();
        setConfirmDelete(null);
        context.logger?.info(`Note deleted: ${noteKey}`);
      } else {
        setConfirmDelete(noteKey);
        setTimeout(() => setConfirmDelete(null), 3000);
      }
    };

    const createNewNote = () => {
      if (context.tabs) {
        const timestamp = Date.now();
        const newKey = `note-tab-${timestamp}`;
        localStorage.setItem(`${newKey}-timestamp`, timestamp.toString());
        
        context.tabs.createTab({
          title: '📝 New Note',
          icon: 'FileText',
          closable: true,
          activateAfterCreate: true,
          data: { content: '', noteKey: newKey },
        });
      }
    };

    const formatDate = (timestamp: number) => {
      const now = Date.now();
      const diff = now - timestamp;
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);

      if (minutes < 1) return 'Just now';
      if (minutes < 60) return `${minutes}m ago`;
      if (hours < 24) return `${hours}h ago`;
      if (days < 7) return `${days}d ago`;
      
      const date = new Date(timestamp);
      return date.toLocaleDateString();
    };

    // TSX構文で記述！
    return (
      <div
        style={{
          padding: '12px',
          color: '#d4d4d4',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#1e1e1e',
        }}
      >
        {/* ヘッダー */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
            paddingBottom: '8px',
            borderBottom: '1px solid #333',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>📝</span>
            <h3 style={{ fontSize: '13px', margin: 0, fontWeight: 600 }}>Notes</h3>
            <span style={{ 
              fontSize: '11px', 
              color: '#888',
              background: '#2d2d2d',
              padding: '2px 6px',
              borderRadius: '10px',
            }}>
              {notes.length}
            </span>
          </div>
          <button
            onClick={createNewNote}
            style={{
              background: '#0e639c',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              padding: '6px 10px',
              fontSize: '12px',
              cursor: 'pointer',
              fontWeight: 500,
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#1177bb';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#0e639c';
            }}
          >
            + New
          </button>
        </div>
        
        {/* ノート一覧 */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {notes.length === 0 ? (
            <div style={{ 
              textAlign: 'center', 
              padding: '32px 16px',
              color: '#888',
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }}>📝</div>
              <p style={{ fontSize: '13px', margin: '0 0 8px 0' }}>
                No notes yet
              </p>
              <p style={{ fontSize: '11px', margin: 0, color: '#666' }}>
                Click "+ New" to create your first note
              </p>
            </div>
          ) : (
            notes.map(({ key, content, timestamp }, idx) => {
              const lines = content.split('\n').filter(line => line.trim());
              const title = lines[0]?.slice(0, 30) || 'Untitled Note';
              const preview = lines.slice(1).join(' ').slice(0, 60) || 'No content';
              const wordCount = content.split(/\s+/).filter(w => w).length;
              const isHovered = hoveredKey === key;
              const isConfirmingDelete = confirmDelete === key;
              
              return (
                <div
                  key={key}
                  onClick={() => openNote(key)}
                  onMouseEnter={() => setHoveredKey(key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  style={{
                    padding: '12px',
                    marginBottom: '8px',
                    background: isHovered ? '#2d2d2d' : '#252525',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    border: '1px solid',
                    borderColor: isHovered ? '#3d3d3d' : 'transparent',
                    transition: 'all 0.2s',
                    position: 'relative',
                  }}
                >
                  {/* タイトル */}
                  <div style={{ 
                    fontWeight: 600, 
                    marginBottom: '6px',
                    fontSize: '13px',
                    color: '#e0e0e0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '8px',
                  }}>
                    <span style={{ 
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {title}
                    </span>
                    {isHovered && (
                      <button
                        onClick={(e) => deleteNote(key, e)}
                        style={{
                          background: isConfirmingDelete ? '#c62828' : '#333',
                          color: isConfirmingDelete ? '#fff' : '#999',
                          border: 'none',
                          borderRadius: '3px',
                          padding: '4px 8px',
                          fontSize: '11px',
                          cursor: 'pointer',
                          fontWeight: 500,
                          transition: 'all 0.2s',
                          flexShrink: 0,
                        }}
                        onMouseEnter={(e) => {
                          if (!isConfirmingDelete) {
                            e.currentTarget.style.background = '#444';
                            e.currentTarget.style.color = '#fff';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isConfirmingDelete) {
                            e.currentTarget.style.background = '#333';
                            e.currentTarget.style.color = '#999';
                          }
                        }}
                      >
                        {isConfirmingDelete ? 'Confirm?' : 'Delete'}
                      </button>
                    )}
                  </div>
                  
                  {/* プレビュー */}
                  <div style={{ 
                    color: '#999', 
                    fontSize: '11px',
                    lineHeight: '1.5',
                    marginBottom: '8px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}>
                    {preview}
                  </div>
                  
                  {/* メタ情報 */}
                  <div style={{ 
                    display: 'flex', 
                    gap: '12px',
                    fontSize: '10px',
                    color: '#666',
                  }}>
                    <span>{formatDate(timestamp)}</span>
                    <span>•</span>
                    <span>{wordCount} words</span>
                    <span>•</span>
                    <span>{lines.length} lines</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  };
}

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('Note Tab Extension (TSX) activated!');

  if (context.tabs) {
    context.tabs.registerTabType(NoteTabComponent);
    context.logger?.info('Note tab component registered');
  }

  const createNoteTab = () => {
    if (context.tabs) {
      const tabId = context.tabs.createTab({
        title: '📝 Quick Note',
        icon: 'FileText',
        closable: true,
        activateAfterCreate: true,
        data: { content: '' },
      });

      context.tabs.onTabClose(tabId, async (closedTabId: string) => {
        context.logger?.info(`Note tab closed: ${closedTabId}`);
      });

      return tabId;
    }
    return null;
  };

  if (context.sidebar) {
    const NotesListPanelWithContext = createNotesListPanel(context);
    
    context.sidebar.createPanel({
      id: 'notes-list',
      title: 'Notes',
      icon: 'StickyNote',
      component: NotesListPanelWithContext,
      order: 50,
    });

    context.logger?.info('Notes sidebar panel registered');
  }

  // UI拡張機能なので、services/commandsは不要
  // createNoteTabは使われていないため削除
  return {};
}

export async function deactivate(): Promise<void> {
  console.log('Note Tab Extension (TSX) deactivated');
}
