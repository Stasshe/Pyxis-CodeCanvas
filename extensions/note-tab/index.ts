/**
 * Note Tab Extension
 * シンプルなメモ帳タブを提供する拡張機能のサンプル
 */

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';
import React, { useState, useEffect } from 'react';

// メモタブコンポーネント（TabComponentPropsに準拠）
function NoteTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  const [content, setContent] = useState((tab as any).data?.content || '');
  const [isSaving, setIsSaving] = useState(false);

  // 自動保存
  useEffect(() => {
    const timer = setTimeout(() => {
      const tabData = (tab as any).data;
      if (content !== tabData?.content) {
        setIsSaving(true);
        // ここでcontextのAPIを使って保存
        localStorage.setItem(`note-tab-${tab.id}`, content);
        setTimeout(() => setIsSaving(false), 500);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [content, tab.id]);

  return React.createElement(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#1e1e1e',
        color: '#d4d4d4',
      },
    },
    [
      // ヘッダー
      React.createElement(
        'div',
        {
          key: 'header',
          style: {
            padding: '8px 16px',
            borderBottom: '1px solid #333',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '14px',
          },
        },
        [
          React.createElement(
            'span',
            {
              key: 'title',
              style: { fontWeight: 'bold' },
            },
            '📝 Quick Note'
          ),
          isSaving &&
            React.createElement(
              'span',
              {
                key: 'saving',
                style: { fontSize: '12px', color: '#888' },
              },
              'Saving...'
            ),
        ]
      ),
      // テキストエリア
      React.createElement('textarea', {
        key: 'textarea',
        value: content,
        onChange: (e: any) => setContent(e.target.value),
        placeholder: 'Type your notes here...',
        style: {
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
        },
      }),
    ]
  );
}

// サイドバーパネルコンポーネント
// contextを保持するために、activate内で作成される必要がある
function createNotesListPanel(context: ExtensionContext) {
  return function NotesListPanel({ extensionId, panelId, isActive, state }: any) {
    const [notes, setNotes] = useState<Array<{ key: string; content: string }>>([]);

    // ノートを再読み込み
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
    }, [isActive]);

    // ノートをクリックして開く
    const openNote = (noteKey: string) => {
      const content = localStorage.getItem(noteKey) || '';
      const noteTitle = content.split('\n')[0].slice(0, 20) || 'Untitled Note';
      
      if (context.tabs) {
        context.tabs.createTab({
          title: `📝 ${noteTitle}`,
          icon: 'FileText',
          closable: true,
          activateAfterCreate: true,
          data: {
            content,
            noteKey,
          },
        });
      }
    };

    // 新規ノート作成
    const createNewNote = () => {
      if (context.tabs) {
        context.tabs.createTab({
          title: '📝 New Note',
          icon: 'FileText',
          closable: true,
          activateAfterCreate: true,
          data: {
            content: '',
          },
        });
      }
    };

    return React.createElement(
      'div',
      {
        style: {
          padding: '16px',
          color: '#d4d4d4',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
        },
      },
      [
        // ヘッダー
        React.createElement(
          'div',
          {
            key: 'header',
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px',
            },
          },
          [
            React.createElement(
              'h3',
              {
                key: 'title',
                style: { fontSize: '14px', margin: 0 },
              },
              'Your Notes'
            ),
            React.createElement(
              'button',
              {
                key: 'new-btn',
                onClick: createNewNote,
                style: {
                  background: '#0e639c',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  fontSize: '12px',
                  cursor: 'pointer',
                },
              },
              '+ New'
            ),
          ]
        ),
        // ノート一覧
        React.createElement(
          'div',
          {
            key: 'list',
            style: {
              flex: 1,
              overflowY: 'auto',
            },
          },
          notes.length === 0
            ? React.createElement(
                'p',
                { style: { color: '#888', fontSize: '12px' } },
                'No notes yet. Click "+ New" to create one.'
              )
            : notes.map(({ key, content }, idx) => {
                const preview = content.slice(0, 50) || 'Empty note';
                const lines = content.split('\n');
                const title = lines[0] || `Note ${idx + 1}`;
                
                return React.createElement(
                  'div',
                  {
                    key: key,
                    onClick: () => openNote(key),
                    style: {
                      padding: '8px',
                      marginBottom: '4px',
                      background: '#2d2d2d',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      transition: 'background 0.2s',
                    },
                    onMouseEnter: function(this: HTMLElement) {
                      this.style.background = '#3d3d3d';
                    },
                    onMouseLeave: function(this: HTMLElement) {
                      this.style.background = '#2d2d2d';
                    },
                  },
                  [
                    React.createElement(
                      'div',
                      {
                        key: 'title',
                        style: { fontWeight: 'bold', marginBottom: '4px' },
                      },
                      title
                    ),
                    React.createElement(
                      'div',
                      {
                        key: 'preview',
                        style: { color: '#888', fontSize: '11px' },
                      },
                      preview
                    ),
                  ]
                );
              })
        ),
      ]
    );
  };
}

/**
 * 拡張機能のactivate関数
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('Note Tab Extension activated!');

  // タブコンポーネントを登録（最初に実行）
  if (context.tabs) {
    context.tabs.registerTabType(NoteTabComponent);
    context.logger?.info('Note tab component registered');
  }

  // タブAPIを使ってノートタブを作成できるコマンドを登録
  const createNoteTab = () => {
    if (context.tabs) {
      const tabId = context.tabs.createTab({
        title: '📝 Quick Note',
        icon: 'FileText',
        closable: true,
        activateAfterCreate: true,
        data: {
          content: '',
        },
      });

      context.logger?.info(`Created note tab: ${tabId}`);

      // タブが閉じられた時のクリーンアップ
      context.tabs.onTabClose(tabId, async (closedTabId: string) => {
        context.logger?.info(`Note tab closed: ${closedTabId}`);
        // 必要に応じてクリーンアップ処理
      });

      return tabId;
    }
    return null;
  };

  // サイドバーパネルを登録（contextを渡すためにcreateNotesListPanelを使用）
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
      'note-tab': {
        createNoteTab,
      },
    },
  };
}

/**
 * 拡張機能のdeactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('Note Tab Extension deactivated');
}
