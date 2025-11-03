/**
 * TODO Panel Extension (TSX版)
 * TODOリストをサイドバーに追加し、タスク管理タブも提供
 */

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';
import React, { useState, useEffect } from 'react';

interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
}

// TODOタブコンポーネント（TSX構文使用）
function TodoTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  const [todos, setTodos] = useState<Todo[]>((tab as any).data?.todos || []);
  const [newTodoText, setNewTodoText] = useState('');

  // 自動保存
  useEffect(() => {
    localStorage.setItem('todo-tab-data', JSON.stringify(todos));
    
    // カスタムイベントを発火してサイドバーを更新
    window.dispatchEvent(new CustomEvent('todo-updated'));
  }, [todos]);

  const addTodo = () => {
    if (newTodoText.trim()) {
      const newTodo: Todo = {
        id: Date.now().toString(),
        text: newTodoText,
        completed: false,
        createdAt: Date.now(),
      };
      setTodos([...todos, newTodo]);
      setNewTodoText('');
    }
  };

  const toggleTodo = (id: string) => {
    setTodos(todos.map(todo => (todo.id === id ? { ...todo, completed: !todo.completed } : todo)));
  };

  const deleteTodo = (id: string) => {
    setTodos(todos.filter(todo => todo.id !== id));
  };

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
          ✅ TODO List
        </h2>
        <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#888' }}>
          {todos.filter(t => !t.completed).length} tasks remaining
        </p>
      </div>

      {/* 入力フォーム */}
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
          value={newTodoText}
          onChange={(e) => setNewTodoText(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && addTodo()}
          placeholder="Add a new task..."
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
          onClick={addTodo}
          style={{
            padding: '8px 16px',
            background: '#0e639c',
            border: 'none',
            borderRadius: '4px',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
          }}
        >
          Add
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
        {todos.length === 0 ? (
          <p style={{ color: '#888', textAlign: 'center', marginTop: '32px' }}>
            No tasks yet. Add one above!
          </p>
        ) : (
          todos.map(todo => (
            <div
              key={todo.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px',
                marginBottom: '8px',
                background: '#2d2d2d',
                borderRadius: '4px',
                borderLeft: todo.completed ? '3px solid #4caf50' : '3px solid #0e639c',
              }}
            >
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => toggleTodo(todo.id)}
                style={{ cursor: 'pointer' }}
              />
              <span
                style={{
                  flex: 1,
                  textDecoration: todo.completed ? 'line-through' : 'none',
                  color: todo.completed ? '#888' : '#d4d4d4',
                }}
              >
                {todo.text}
              </span>
              <button
                onClick={() => deleteTodo(todo.id)}
                style={{
                  padding: '4px 8px',
                  background: '#d32f2f',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                🗑️
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// サイドバーパネルコンポーネントを作成する関数
function createTodoSidebarPanel(context: ExtensionContext) {
  return function TodoSidebarPanel({ extensionId, panelId, isActive, state }: any) {
    const [todos, setTodos] = useState<Todo[]>([]);

    const loadTodos = () => {
      const savedData = localStorage.getItem('todo-tab-data');
      if (savedData) {
        try {
          setTodos(JSON.parse(savedData));
        } catch (e) {
          console.error('Failed to parse TODO data', e);
        }
      }
    };

    useEffect(() => {
      loadTodos();

      // TODO更新イベントをリッスン
      const handleTodoUpdate = () => loadTodos();
      window.addEventListener('todo-updated', handleTodoUpdate);

      return () => {
        window.removeEventListener('todo-updated', handleTodoUpdate);
      };
    }, [isActive]);

    const openTodoTab = () => {
      if (context.tabs) {
        const savedData = localStorage.getItem('todo-tab-data');
        let todos: Todo[] = [];
        if (savedData) {
          try {
            todos = JSON.parse(savedData);
          } catch (e) {
            console.error('Failed to parse TODO data', e);
          }
        }

        context.tabs.createTab({
          title: '✅ TODO List',
          icon: 'ListTodo',
          closable: true,
          activateAfterCreate: true,
          data: { todos },
        });
      }
    };

    const incompleteTodos = todos.filter(t => !t.completed);
    const completedCount = todos.filter(t => t.completed).length;

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
              ✅ TODO List
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#888' }}>
              {incompleteTodos.length} active • {completedCount} completed
            </p>
          </div>
          <button
            onClick={openTodoTab}
            style={{
              padding: '4px 8px',
              background: '#0e639c',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            Open
          </button>
        </div>

        {/* TODOリスト */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {incompleteTodos.length === 0 ? (
            <p style={{ color: '#888', fontSize: '12px' }}>
              All tasks completed! 🎉
            </p>
          ) : (
            <>
              {incompleteTodos.slice(0, 5).map(todo => (
                <div
                  key={todo.id}
                  onClick={openTodoTab}
                  style={{
                    padding: '8px',
                    marginBottom: '4px',
                    background: '#2d2d2d',
                    borderRadius: '4px',
                    fontSize: '12px',
                    borderLeft: '2px solid #0e639c',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#3d3d3d';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#2d2d2d';
                  }}
                >
                  {todo.text.length > 30 ? todo.text.substring(0, 30) + '...' : todo.text}
                </div>
              ))}
              {incompleteTodos.length > 5 && (
                <p style={{ marginTop: '8px', fontSize: '12px', color: '#888', textAlign: 'center' }}>
                  +{incompleteTodos.length - 5} more tasks
                </p>
              )}
            </>
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
  context.logger?.info('TODO Panel Extension (TSX) activated!');

  // タブコンポーネントを登録（最初に実行）
  if (context.tabs) {
    context.tabs.registerTabType(TodoTabComponent);
    context.logger?.info('TODO tab component registered');
  }

  // TODOタブを作成するコマンド
  const createTodoTab = () => {
    if (context.tabs) {
      // 既存のTODOデータを読み込み
      const savedData = localStorage.getItem('todo-tab-data');
      let todos: Todo[] = [];
      if (savedData) {
        try {
          todos = JSON.parse(savedData);
        } catch (e) {
          console.error('Failed to parse TODO data', e);
        }
      }

      const tabId = context.tabs.createTab({
        title: '✅ TODO List',
        icon: 'ListTodo',
        closable: true,
        activateAfterCreate: true,
        data: { todos },
      });

      context.logger?.info(`Created TODO tab: ${tabId}`);

      // タブが閉じられた時
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
      id: 'todo-list',
      title: 'TODO',
      icon: 'CheckSquare',
      component: TodoSidebarPanelWithContext,
      order: 45,
    });

    // パネルがアクティブになった時
    context.sidebar.onPanelActivate('todo-list', async (panelId: string) => {
      context.logger?.info(`TODO panel activated: ${panelId}`);
    });

    context.logger?.info('TODO sidebar panel registered');
  }

  return {
    services: {
      'todo-panel': {
        createTodoTab,
      },
    },
    commands: {
      'todo.create': createTodoTab,
      'todo.open': createTodoTab,
    },
  };
}

/**
 * 拡張機能のdeactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('TODO Panel Extension (TSX) deactivated');
}
