/**
 * TODO Panel Extension
 * Pyxis内のファイルから TODO: コメントを検索して一覧表示
 */

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';
import React, { useState, useEffect } from 'react';

interface TodoItem {
  id: string;
  text: string;
  filePath: string;
  line: number;
  projectId: string;
  projectName: string;
  file: any; // ファイルオブジェクト
}

// サイドバーパネルコンポーネント
function createTodoSidebarPanel(context: ExtensionContext) {
  return function TodoSidebarPanel({ extensionId, panelId, isActive, state }: any) {
    const [todos, setTodos] = useState<TodoItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState('');

    // TODO検索関数
    const scanTodos = async () => {
      if (!context?.getSystemModule) return;
      
      setLoading(true);
      try {
        const fileRepository = await context.getSystemModule('fileRepository');
        
        // 全プロジェクトを取得
        const projects = await fileRepository.getProjects();
        const allTodos: TodoItem[] = [];

        for (const project of projects) {
          // プロジェクトの全ファイルを取得
          const files = await fileRepository.getProjectFiles(project.id);

          for (const file of files) {
            if (file.type !== 'file' || file.isBufferArray) continue;

            // ファイル内容からTODOを検索
            const lines = file.content.split('\n');
            lines.forEach((line: string, index: number) => {
              // TODO:, TODO , FIXME:, FIXME などを検索
              const todoMatch = line.match(/(?:TODO|FIXME)\s*[:：]\s*(.+)/i);
              if (todoMatch) {
                allTodos.push({
                  id: `${project.id}-${file.path}-${index}`,
                  text: todoMatch[1].trim(),
                  filePath: file.path,
                  line: index + 1,
                  projectId: project.id,
                  projectName: project.name,
                  file: file,
                });
              }
            });
          }
        }

        setTodos(allTodos);
      } catch (error) {
        console.error('Failed to scan TODOs:', error);
      } finally {
        setLoading(false);
      }
    };

    // 初回ロード
    useEffect(() => {
      if (isActive) {
        scanTodos();
      }
    }, [isActive]);

    // TODOをクリックしたときにファイルを開く
    const handleTodoClick = (todo: TodoItem) => {
      if (!context?.tabs?.openSystemTab) {
        context.logger?.error('openSystemTab is not available');
        return;
      }

      try {
        // システムのopenTabを使ってファイルを開く
        context.tabs.openSystemTab(todo.file, {
          kind: 'editor',
          jumpToLine: todo.line,
          activateAfterOpen: true,
        });
        
        context.logger?.info(`Opened file: ${todo.filePath} at line ${todo.line}`);
      } catch (error) {
        context.logger?.error('Failed to open file:', error);
      }
    };

    // フィルタリング
    const filteredTodos = todos.filter(todo =>
      filter === '' ||
      todo.text.toLowerCase().includes(filter.toLowerCase()) ||
      todo.filePath.toLowerCase().includes(filter.toLowerCase()) ||
      todo.projectName.toLowerCase().includes(filter.toLowerCase())
    );

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          color: '#d4d4d4',
          overflow: 'hidden',
        }}
      >
        {/* ヘッダー */}
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid #333',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 'bold' }}>
              📋 TODO
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: '#888' }}>
              {loading ? '🔍 Scanning...' : `${todos.length} found • ${filteredTodos.length} shown`}
            </p>
          </div>
          <button
            onClick={scanTodos}
            disabled={loading}
            style={{
              padding: '4px 8px',
              background: loading ? '#555' : '#0e639c',
              border: 'none',
              borderRadius: '4px',
              color: '#fff',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '11px',
              fontWeight: 'bold',
            }}
          >
            {loading ? '...' : '🔄'}
          </button>
        </div>

        {/* フィルター */}
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid #333',
          }}
        >
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter..."
            style={{
              width: '100%',
              padding: '6px 10px',
              background: '#2d2d2d',
              border: '1px solid #444',
              borderRadius: '4px',
              color: '#d4d4d4',
              fontSize: '12px',
              outline: 'none',
            }}
          />
        </div>

        {/* TODOリスト */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px',
          }}
        >
          {loading ? (
            <p style={{ color: '#888', textAlign: 'center', marginTop: '32px', fontSize: '12px' }}>
              🔍 Scanning...
            </p>
          ) : filteredTodos.length === 0 ? (
            <div style={{ textAlign: 'center', marginTop: '32px' }}>
              <p style={{ color: '#888', fontSize: '12px' }}>
                {filter ? '🔍 No matches' : '✅ No TODOs found'}
              </p>
              {!filter && todos.length === 0 && (
                <p style={{ color: '#666', fontSize: '11px', marginTop: '8px', padding: '0 12px' }}>
                  Add TODO: or FIXME: comments
                </p>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {filteredTodos.map(todo => (
                <div
                  key={todo.id}
                  onClick={() => handleTodoClick(todo)}
                  style={{
                    padding: '10px',
                    background: '#2d2d2d',
                    borderRadius: '4px',
                    borderLeft: '3px solid #0e639c',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#3d3d3d';
                    e.currentTarget.style.borderLeftColor = '#1e7bbe';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#2d2d2d';
                    e.currentTarget.style.borderLeftColor = '#0e639c';
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#d4d4d4', marginBottom: '4px', fontWeight: '500' }}>
                    {todo.text}
                  </div>
                  <div style={{ fontSize: '10px', color: '#888', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ color: '#7cb342' }}>{todo.projectName}</span>
                    <span style={{ color: '#555' }}>•</span>
                    <span style={{ fontFamily: 'monospace', color: '#64b5f6' }}>{todo.filePath}</span>
                    <span style={{ color: '#555' }}>•</span>
                    <span style={{ fontFamily: 'monospace' }}>L{todo.line}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };
}

/**
 * 拡張機能のactivate関数
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('TODO Scanner Extension activated!');

  // サイドバーパネルを登録
  if (context.sidebar) {
    const TodoSidebarPanelWithContext = createTodoSidebarPanel(context);

    context.sidebar.createPanel({
      id: 'todo-scanner',
      title: 'TODO',
      icon: 'CheckSquare',
      component: TodoSidebarPanelWithContext,
      order: 45,
    });

    context.sidebar.onPanelActivate('todo-scanner', async (panelId: string) => {
      context.logger?.info(`TODO panel activated: ${panelId}`);
    });

    context.logger?.info('TODO sidebar panel registered');
  }

  return {
    services: {},
    commands: {},
  };
}

/**
 * 拡張機能のdeactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('TODO Scanner Extension deactivated');
}
