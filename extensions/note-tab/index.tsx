/**
 * Note Tab Extension (TSX版サンプル)
 * TSX構文を使用した実装例
 */

import React, { useState, useEffect, useRef } from 'react';

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

// --- Storage abstraction -------------------------------------------------
const OLD_PREFIX = 'note-tab-';
const STORAGE_PREFIX = 'note-tab-v2-';

function normalizeKey(rawKey: string) {
  if (!rawKey) return STORAGE_PREFIX + Date.now();
  if (rawKey.startsWith(STORAGE_PREFIX)) return rawKey;
  if (rawKey.startsWith(OLD_PREFIX)) {
    const suffix = rawKey.slice(OLD_PREFIX.length);
    return STORAGE_PREFIX + suffix;
  }
  // If a full key-like string but not prefixed, prefix it
  return STORAGE_PREFIX + rawKey;
}

function saveNote(rawKey: string, content: string) {
  const key = normalizeKey(rawKey);
  const now = Date.now();
  const payload = JSON.stringify({ version: 2, content, updatedAt: now });
  try {
    localStorage.setItem(key, payload);
  } catch (e) {
    console.error('saveNote failed', e);
  }
  // notify
  window.dispatchEvent(new CustomEvent('note-updated', { detail: { noteKey: key } }));
  return key;
}

function loadNote(rawKey: string) {
  const key = normalizeKey(rawKey);
  const raw = localStorage.getItem(key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return { content: parsed.content || '', updatedAt: parsed.updatedAt || Date.now() };
    } catch (e) {
      // fallthrough to fallback
      console.warn('malformed note payload, falling back to raw', e);
    }
  }

  // Fallback for old format (note-tab-KEY and note-tab-KEY-timestamp)
  if (rawKey && rawKey.startsWith(OLD_PREFIX) && !rawKey.startsWith(STORAGE_PREFIX)) {
    const content = localStorage.getItem(rawKey) || '';
    const ts = localStorage.getItem(`${rawKey}-timestamp`);
    return { content, updatedAt: ts ? parseInt(ts, 10) : Date.now() };
  }

  return { content: '', updatedAt: Date.now() };
}

function listNotes() {
  const results: Array<{ key: string; content: string; timestamp: number }> = [];

  // Simple migration: move old keys (note-tab-*) to namespaced keys
  const toMigrate: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.startsWith(OLD_PREFIX) && !k.startsWith(STORAGE_PREFIX)) {
      toMigrate.push(k);
    }
  }

  toMigrate.forEach((oldKey) => {
    try {
      const content = localStorage.getItem(oldKey) || '';
      const ts = localStorage.getItem(`${oldKey}-timestamp`);
      const suffix = oldKey.slice(OLD_PREFIX.length);
      const newKey = STORAGE_PREFIX + suffix;
      const payload = JSON.stringify({ version: 2, content, updatedAt: ts ? parseInt(ts, 10) : Date.now() });
      localStorage.setItem(newKey, payload);
      localStorage.removeItem(oldKey);
      localStorage.removeItem(`${oldKey}-timestamp`);
    } catch (e) {
      console.warn('migration failed for', oldKey, e);
    }
  });

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (!key.startsWith(STORAGE_PREFIX)) continue;
    const raw = localStorage.getItem(key) || '';
    try {
      const parsed = JSON.parse(raw);
      results.push({ key, content: parsed.content || '', timestamp: parsed.updatedAt || Date.now() });
    } catch (e) {
      // Fallback: keep raw string
      results.push({ key, content: raw, timestamp: Date.now() });
    }
  }

  // newest first
  results.sort((a, b) => b.timestamp - a.timestamp);
  return results;
}

function deleteNoteByKey(rawKey: string) {
  const key = normalizeKey(rawKey);
  try {
    localStorage.removeItem(key);
  } catch (e) {
    console.warn('deleteNote failed', e);
  }
  window.dispatchEvent(new CustomEvent('note-updated', { detail: { noteKey: key } }));
}

// ------------------------------------------------------------------------
// Helper: derive storage suffix from a storage key
function storageKeyToSuffix(storageKey: string) {
  if (!storageKey) return storageKey;
  if (storageKey.startsWith(STORAGE_PREFIX)) return storageKey.slice(STORAGE_PREFIX.length);
  if (storageKey.startsWith(OLD_PREFIX)) return storageKey.slice(OLD_PREFIX.length);
  return storageKey;
}

// Helper: get suffix/id from tab.id (format: extension:extensionId[:id])
function getSuffixFromTabId(tabId: string) {
  if (!tabId) return null;
  const parts = tabId.split(':');
  if (parts.length >= 3) return parts.slice(2).join(':');
  return null;
}

// メモタブコンポーネント（TSX構文使用）
function NoteTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  const [content, setContent] = useState((tab as any).data?.content || '');
  const [isSaving, setIsSaving] = useState(false);
  const saveTimer = useRef<number | null>(null);

  // Load note content when tab changes (support when opening existing note)
  useEffect(() => {
    const suffix = getSuffixFromTabId((tab as any).id) || (tab as any).data?.id || null;
    if (suffix) {
      const note = loadNote(suffix);
      setContent(note.content || '');
    } else {
      // fallback to inline data if provided
      setContent((tab as any).data?.content || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  // Auto-save with debounce and a storage abstraction
  useEffect(() => {
    const tabData = (tab as any).data || {};
    const suffix = getSuffixFromTabId((tab as any).id) || tabData.id || `${Date.now()}`;
    const noteKeyRaw = suffix;
    // clear previous timer
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
    }

    saveTimer.current = window.setTimeout(() => {
      const normalizedKey = saveNote(noteKeyRaw, content);
      setIsSaving(true);
      // small visual delay before turning off saving indicator
      setTimeout(() => setIsSaving(false), 350);
    }, 750);

    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
    // only depend on content and tab id/key
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
      try {
        const allNotes = listNotes();
        setNotes(allNotes);
      } catch (e) {
        console.error('loadNotes failed', e);
        setNotes([]);
      }
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
      const note = loadNote(noteKey);
      const noteTitle = note.content.split('\n')[0].slice(0, 20) || 'Untitled Note';

      if (context.tabs) {
        // derive an id from the storage key suffix and pass as tab id
        const suffix = storageKeyToSuffix(noteKey);
        context.tabs.createTab({
          id: suffix,
          title: `📝 ${noteTitle}`,
          icon: 'FileText',
          closable: true,
          activateAfterCreate: true,
          data: { content: note.content, id: suffix },
        });
      }
    };

    const deleteNote = (noteKey: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (confirmDelete === noteKey) {
        deleteNoteByKey(noteKey);
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
        const suffix = Date.now().toString();
        // save under a suffix-only key so storage key becomes STORAGE_PREFIX + suffix
        saveNote(suffix, '');
        context.tabs.createTab({
          id: suffix,
          title: '📝 New Note',
          icon: 'FileText',
          closable: true,
          activateAfterCreate: true,
          data: { content: '', id: suffix },
        });
        // refresh list shortly after save
        setTimeout(loadNotes, 100);
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
