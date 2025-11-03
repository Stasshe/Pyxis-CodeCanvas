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
      if (content !== tabData?.content) {
        setIsSaving(true);
        localStorage.setItem(`note-tab-${tab.id}`, content);
        
        window.dispatchEvent(new CustomEvent('note-updated', { 
          detail: { noteKey: `note-tab-${tab.id}` } 
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
    const [notes, setNotes] = useState<Array<{ key: string; content: string }>>([]);

    const loadNotes = () => {
      const allNotes: Array<{ key: string; content: string }> = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('note-tab-')) {
          const content = localStorage.getItem(key) || '';
          allNotes.push({ key, content });
        }
      }
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

    const createNewNote = () => {
      if (context.tabs) {
        context.tabs.createTab({
          title: '📝 New Note',
          icon: 'FileText',
          closable: true,
          activateAfterCreate: true,
          data: { content: '' },
        });
      }
    };

    // TSX構文で記述！
    return (
      <div
        style={{
          padding: '16px',
          color: '#d4d4d4',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* ヘッダー */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
          }}
        >
          <h3 style={{ fontSize: '14px', margin: 0 }}>Your Notes</h3>
          <button
            onClick={createNewNote}
            style={{
              background: '#0e639c',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            + New
          </button>
        </div>
        
        {/* ノート一覧 */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {notes.length === 0 ? (
            <p style={{ color: '#888', fontSize: '12px' }}>
              No notes yet. Click "+ New" to create one.
            </p>
          ) : (
            notes.map(({ key, content }, idx) => {
              const preview = content.slice(0, 50) || 'Empty note';
              const lines = content.split('\n');
              const title = lines[0] || `Note ${idx + 1}`;
              
              return (
                <div
                  key={key}
                  onClick={() => openNote(key)}
                  style={{
                    padding: '8px',
                    marginBottom: '4px',
                    background: '#2d2d2d',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#3d3d3d';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#2d2d2d';
                  }}
                >
                  <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                    {title}
                  </div>
                  <div style={{ color: '#888', fontSize: '11px' }}>
                    {preview}
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

  return {
    services: {
      'note-tab': { createNoteTab },
    },
  };
}

export async function deactivate(): Promise<void> {
  console.log('Note Tab Extension (TSX) deactivated');
}
