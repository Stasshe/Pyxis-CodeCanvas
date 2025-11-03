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
function NotesListPanel({ extensionId, panelId, isActive, state }: any) {
  const [notes, setNotes] = useState<string[]>([]);

  useEffect(() => {
    // localStorageから全てのノートを取得
    const allNotes: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('note-tab-')) {
        allNotes.push(key);
      }
    }
    setNotes(allNotes);
  }, [isActive]);

  return React.createElement(
    'div',
    {
      style: {
        padding: '16px',
        color: '#d4d4d4',
      },
    },
    [
      React.createElement(
        'h3',
        {
          key: 'title',
          style: { marginBottom: '16px', fontSize: '14px' },
        },
        'Your Notes'
      ),
      React.createElement(
        'div',
        { key: 'list' },
        notes.length === 0
          ? React.createElement('p', { style: { color: '#888', fontSize: '12px' } }, 'No notes yet')
          : notes.map((noteKey, idx) =>
              React.createElement(
                'div',
                {
                  key: noteKey,
                  style: {
                    padding: '8px',
                    marginBottom: '4px',
                    background: '#2d2d2d',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                  },
                },
                `Note ${idx + 1}`
              )
            )
      ),
    ]
  );
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

  // サイドバーパネルを登録
  if (context.sidebar) {
    context.sidebar.createPanel({
      id: 'notes-list',
      title: 'Notes',
      icon: 'StickyNote',
      component: NotesListPanel,
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
