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

// TODOタブコンポーネント
function TodoTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const context: ExtensionContext = (tab as any).data?.context;

  // TODO検索関数
  const scanTodos = async () => {
    if (!context?.getSystemModule) return;
    
    setLoading(true);
    try {
      const { fileRepository } = await context.getSystemModule('fileRepository');
      
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
          lines.forEach((line, index) => {
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
                file: file, // ファイルオブジェクトを保存
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
    if (isActive && context) {
      scanTodos();
    }
  }, [isActive, context]);

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
        background: '#1e1e1e',
        color: '#d4d4d4',
        overflow: 'auto',
      }}
    >
      {/* ヘッダー */}
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid #333',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>
          📋 TODO Scanner
        </h2>
        <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#888' }}>
          {todos.length} TODOs found • {filteredTodos.length} shown
        </p>
      </div>

      {/* ツールバー */}
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid #333',
          display: 'flex',
          gap: '8px',
        }}
      >
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by text, file, or project..."
          style={{
            flex: 1,
            padding: '8px 12px',
            background: '#2d2d2d',
            border: '1px solid #444',
            borderRadius: '4px',
            color: '#d4d4d4',
            fontSize: '14px',
            outline: 'none',
          }}
        />
        <button
          onClick={scanTodos}
          disabled={loading}
          style={{
            padding: '8px 16px',
            background: loading ? '#555' : '#0e639c',
            border: 'none',
            borderRadius: '4px',
            color: '#fff',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
          }}
        >
          {loading ? 'Scanning...' : '🔄 Refresh'}
        </button>
      </div>

      {/* TODOリスト */}
      <div
        style={{
          flex: 1,
          padding: '16px',
          overflowY: 'auto',
        }}
      >
        {loading ? (
          <p style={{ color: '#888', textAlign: 'center', marginTop: '32px' }}>
            🔍 Scanning workspace for TODOs...
          </p>
        ) : filteredTodos.length === 0 ? (
          <div style={{ textAlign: 'center', marginTop: '32px' }}>
            <p style={{ color: '#888', fontSize: '16px' }}>
              {filter ? '🔍 No TODOs match your filter' : '✅ No TODOs found in workspace'}
            </p>
            {!filter && todos.length === 0 && (
              <p style={{ color: '#666', fontSize: '12px', marginTop: '8px' }}>
                Add TODO: or FIXME: comments in your code to see them here
              </p>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredTodos.map(todo => (
              <div
                key={todo.id}
                onClick={() => handleTodoClick(todo)}
                style={{
                  padding: '12px',
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', color: '#d4d4d4', marginBottom: '6px', fontWeight: '500' }}>
                      {todo.text}
                    </div>
                    <div style={{ fontSize: '11px', color: '#888', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        📁 <span style={{ color: '#7cb342' }}>{todo.projectName}</span>
                      </span>
                      <span style={{ color: '#555' }}>•</span>
                      <span style={{ fontFamily: 'monospace', color: '#64b5f6' }}>{todo.filePath}</span>
                    </div>
                  </div>
                  <div style={{ 
                    fontSize: '11px', 
                    color: '#888',
                    background: '#1e1e1e',
                    padding: '4px 8px',
                    borderRadius: '3px',
                    whiteSpace: 'nowrap',
                    fontFamily: 'monospace'
                  }}>
                    L{todo.line}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// サイドバーパネルコンポーネント
function createTodoSidebarPanel(context: ExtensionContext) {
  return function TodoSidebarPanel({ extensionId, panelId, isActive, state }: any) {
    const [todoCount, setTodoCount] = useState(0);
    const [loading, setLoading] = useState(false);

    const loadTodoCount = async () => {
      if (!isActive || !context.getSystemModule) return;
      
      setLoading(true);
      try {
        const { fileRepository } = await context.getSystemModule('fileRepository');
        
        const projects = await fileRepository.getProjects();
        let count = 0;

        for (const project of projects) {
          const files = await fileRepository.getProjectFiles(project.id);

          for (const file of files) {
            if (file.type !== 'file' || file.isBufferArray) continue;

            const lines = file.content.split('\n');
            lines.forEach((line) => {
              if (/(?:TODO|FIXME)\s*[:：]/i.test(line)) {
                count++;
              }
            });
          }
        }

        setTodoCount(count);
      } catch (error) {
        console.error('Failed to count TODOs:', error);
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      loadTodoCount();
    }, [isActive]);

    const openTodoTab = () => {
      if (context.tabs) {
        context.tabs.createTab({
          title: '📋 TODO Scanner',
          icon: 'ListTodo',
          closable: true,
          activateAfterCreate: true,
          data: { context },
        });
      }
    };

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
          <div>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 'bold' }}>
              📋 TODO
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#888' }}>
              {loading ? '🔍 Scanning...' : `${todoCount} found`}
            </p>
          </div>
          <button
            onClick={openTodoTab}
            style={{
              padding: '6px 12px',
              background: '#0e639c',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              fontSize: '11px',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            Open
          </button>
        </div>

        {/* 説明 */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div
            style={{
              padding: '12px',
              background: '#2d2d2d',
              borderRadius: '4px',
              fontSize: '12px',
              color: '#888',
              borderLeft: '3px solid #0e639c',
            }}
          >
            <p style={{ margin: '0 0 8px 0' }}>
              Scans workspace for <strong style={{ color: '#d4d4d4' }}>TODO:</strong> and <strong style={{ color: '#d4d4d4' }}>FIXME:</strong> comments
            </p>
            <p style={{ margin: 0 }}>
              Click <strong style={{ color: '#d4d4d4' }}>Open</strong> to view all TODOs and jump to their locations
            </p>
          </div>

          {todoCount > 0 && (
            <div
              style={{
                marginTop: '16px',
                padding: '16px',
                background: '#2d2d2d',
                borderRadius: '4px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#0e639c' }}>
                {todoCount}
              </div>
              <div style={{ color: '#888', marginTop: '4px', fontSize: '12px' }}>
                {todoCount === 1 ? 'TODO found' : 'TODOs found'}
              </div>
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

  // タブコンポーネントを登録
  if (context.tabs) {
    context.tabs.registerTabType(TodoTabComponent);
    context.logger?.info('TODO tab component registered');
  }

  // TODOタブを作成するコマンド
  const createTodoTab = () => {
    if (context.tabs) {
      const tabId = context.tabs.createTab({
        title: '📋 TODO Scanner',
        icon: 'ListTodo',
        closable: true,
        activateAfterCreate: true,
        data: { context },
      });

      context.logger?.info(`Created TODO tab: ${tabId}`);

      context.tabs.onTabClose(tabId, async (closedTabId: string) => {
        context.logger?.info(`TODO tab closed: ${closedTabId}`);
      });

      return tabId;
    }
    return null;
  };

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
    services: {
      'todo-scanner': {
        createTodoTab,
      },
    },
    commands: {
      'todo.scan': createTodoTab,
      'todo.open': createTodoTab,
    },
  };
}

/**
 * 拡張機能のdeactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('TODO Scanner Extension deactivated');
}
