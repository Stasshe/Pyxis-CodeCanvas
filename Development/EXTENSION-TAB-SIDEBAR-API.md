# Extension Tab & Sidebar API

拡張機能がカスタムタブとサイドバーパネルを追加するための高度なAPI設計

## 設計原則

1. **最小権限の原則**: 拡張機能は自分が作成したタブのみを操作可能
2. **宣言的API**: マニフェストで機能を宣言し、実行時にAPIで操作
3. **型安全性**: TypeScriptで完全に型付け
4. **自動クリーンアップ**: 拡張機能の無効化時に自動でリソースを解放

## アーキテクチャ

```
Extension Manifest
  ↓ 宣言
Extension Manager
  ↓ Context作成
Extension Context (TabAPI + SidebarAPI)
  ↓ 使用
Extension Runtime
  ↓ 作成
Custom Tab / Sidebar Panel
  ↓ 描画
TabRegistry / SidebarRegistry
```

## Tab API

### 概要

拡張機能が独自のタブを作成・管理するためのAPI。各拡張機能は自分が作成したタブのみを操作でき、他の拡張機能や組み込みタブには干渉できません。

### 主要メソッド

#### `registerTabType(component: React.ComponentType): void`

タブのコンポーネントをTabRegistryに登録します。**activate関数の最初に呼び出す必要があります。**

```typescript
// activate関数内で
context.tabs.registerTabType(MyTabComponent);
```

**重要**: この関数を呼ばずに`createTab()`を実行すると、エラーが発生します。

#### `createTab(options: CreateTabOptions): string`

新しいタブを作成します。事前に`registerTabType()`を呼び出している必要があります。

```typescript
const tabId = context.tabs.createTab({
  title: '📝 My Custom Tab',
  icon: 'FileText',
  closable: true,
  activateAfterCreate: true,
  paneId: 'optional-pane-id', // 省略時は最初のペイン
  data: {
    // 拡張機能固有のデータ
    customField: 'value',
  },
});
```

**パラメータ:**
- `title` (string): タブのタイトル
- `icon` (string, optional): Lucide Reactアイコン名
- `closable` (boolean, optional): タブを閉じられるか (デフォルト: true)
- `activateAfterCreate` (boolean, optional): 作成後にアクティブ化 (デフォルト: true)
- `paneId` (string, optional): 開くペインID
- `data` (object, optional): 拡張機能固有のデータ

**戻り値:** タブID (string)

#### `updateTab(tabId: string, options: UpdateTabOptions): boolean`

既存のタブを更新します。

```typescript
context.tabs.updateTab(tabId, {
  title: '📝 Updated Title',
  icon: 'Edit',
  data: {
    customField: 'new value',
  },
});
```

**パラメータ:**
- `tabId` (string): 更新するタブのID
- `options.title` (string, optional): 新しいタイトル
- `options.icon` (string, optional): 新しいアイコン
- `options.data` (object, optional): データの部分更新

**戻り値:** 成功したか (boolean)

#### `closeTab(tabId: string): boolean`

タブを閉じます。

```typescript
context.tabs.closeTab(tabId);
```

#### `onTabClose(tabId: string, callback: (tabId: string) => void | Promise<void>): void`

タブが閉じられた時のコールバックを登録します。

```typescript
context.tabs.onTabClose(tabId, async (closedTabId) => {
  // クリーンアップ処理
  console.log('Tab closed:', closedTabId);
  await saveData();
});
```

#### `getTabData<T>(tabId: string): T | null`

タブのデータを取得します。

```typescript
const data = context.tabs.getTabData(tabId);
console.log(data.customField);
```

### タブコンポーネントの実装

タブの内容を描画するReactコンポーネントを実装します。**TabComponentPropsに準拠する必要があります。**

```typescript
// TabComponentProps: { tab: Tab; isActive: boolean }
function MyTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  const tabData = (tab as any).data;
  const [state, setState] = useState(tabData?.initialState || '');

  return React.createElement(
    'div',
    { 
      style: { 
        padding: '16px',
        width: '100%',
        height: '100%',
        background: '#1e1e1e',
        color: '#d4d4d4',
      } 
    },
    [
      React.createElement('h2', { key: 'title' }, 'My Custom Tab'),
      React.createElement('p', { key: 'content' }, `Current state: ${state}`),
      React.createElement('p', { key: 'active' }, `Active: ${isActive}`),
    ]
  );
}
```

**重要な注意点:**
1. **React JSXは使用できません** - `React.createElement`を使用してください
2. **TabComponentPropsに準拠** - `{ tab, isActive }` のpropsを受け取ること
3. **動的import** - 拡張機能はユーザーが動的にimportするため、ビルド時の依存は不可
4. **Static Site** - サーバーサイド処理なし、完全にクライアントサイドで動作

## Sidebar API

### 概要

拡張機能がサイドバーにカスタムパネルを追加するためのAPI。

### 主要メソッド

#### `createPanel(definition: SidebarPanelDefinition): void`

サイドバーパネルを作成します。

```typescript
context.sidebar.createPanel({
  id: 'my-panel',
  title: 'My Panel',
  icon: 'Package',
  component: MyPanelComponent,
  order: 50, // 表示順序
});
```

**パラメータ:**
- `id` (string): パネルID (拡張機能内で一意)
- `title` (string): パネルのタイトル
- `icon` (string): Lucide Reactアイコン名
- `component` (React.ComponentType): パネルコンポーネント
- `order` (number, optional): 表示順序 (小さいほど上)

#### `updatePanel(panelId: string, state: any): void`

パネルの状態を更新します。

```typescript
context.sidebar.updatePanel('my-panel', {
  items: [...newItems],
});
```

#### `removePanel(panelId: string): void`

パネルを削除します。

```typescript
context.sidebar.removePanel('my-panel');
```

#### `onPanelActivate(panelId: string, callback: (panelId: string) => void | Promise<void>): void`

パネルがアクティブになった時のコールバック。

```typescript
context.sidebar.onPanelActivate('my-panel', async (panelId) => {
  console.log('Panel activated:', panelId);
  await loadData();
});
```

### パネルコンポーネントの実装

```typescript
function MyPanelComponent({ extensionId, panelId, isActive, state }: any) {
  const [items, setItems] = useState(state?.items || []);

  useEffect(() => {
    if (isActive) {
      // アクティブ時の処理
      loadItems().then(setItems);
    }
  }, [isActive]);

  return React.createElement(
    'div',
    { style: { padding: '16px' } },
    [
      React.createElement('h3', { key: 'title' }, 'My Panel'),
      // ...
    ]
  );
}
```

**Props:**
- `extensionId` (string): 拡張機能のID
- `panelId` (string): パネルのID
- `isActive` (boolean): パネルがアクティブか
- `state` (any): パネルの状態

## 完全な拡張機能の例

### 1. マニフェスト (`manifest.json`)

```json
{
  "id": "my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "type": "ui",
  "description": "Example extension with custom tab and sidebar",
  "author": "Your Name",
  "entry": "index.ts",
  "provides": {
    "services": ["my-service"]
  },
  "metadata": {
    "publishedAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-01-01T00:00:00Z",
    "tags": ["ui", "productivity"]
  }
}
```

### 2. エントリーポイント (`index.ts`)

```typescript
import type { ExtensionContext, ExtensionActivation } from '../../_shared/types';
import React, { useState } from 'react';

// タブコンポーネント
function MyTabComponent({ tab, paneId }: any) {
  const [count, setCount] = useState(0);

  return React.createElement(
    'div',
    { style: { padding: '16px' } },
    [
      React.createElement('h2', { key: 'title' }, 'My Custom Tab'),
      React.createElement('p', { key: 'count' }, `Count: ${count}`),
      React.createElement(
        'button',
        {
          key: 'button',
          onClick: () => setCount(count + 1),
          style: { padding: '8px 16px', cursor: 'pointer' },
        },
        'Increment'
      ),
    ]
  );
}

// パネルコンポーネント
function MyPanelComponent({ extensionId, panelId, isActive, state }: any) {
  return React.createElement(
    'div',
    { style: { padding: '16px' } },
    [
      React.createElement('h3', { key: 'title' }, 'My Panel'),
      React.createElement('p', { key: 'status' }, isActive ? 'Active' : 'Inactive'),
    ]
  );
}

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('Extension activated!');

  // 【重要】最初にタブコンポーネントを登録
  if (context.tabs) {
    context.tabs.registerTabType(MyTabComponent);
    context.logger?.info('Tab component registered');
  }

  // タブを作成するコマンド
  const createTab = () => {
    if (context.tabs) {
      const tabId = context.tabs.createTab({
        title: 'My Tab',
        icon: 'Package',
        closable: true,
        data: { initialValue: 'hello' },
      });

      // クローズ時のクリーンアップ
      context.tabs.onTabClose(tabId, () => {
        context.logger?.info('Tab closed');
      });

      return tabId;
    }
    return null;
  };

  // サイドバーパネルを登録
  if (context.sidebar) {
    context.sidebar.createPanel({
      id: 'my-panel',
      title: 'My Panel',
      icon: 'Box',
      component: MyPanelComponent,
      order: 50,
    });

    context.sidebar.onPanelActivate('my-panel', () => {
      context.logger?.info('Panel activated');
    });
  }

  return {
    services: {
      'my-service': { createTab },
    },
    commands: {
      'my-extension.createTab': createTab,
    },
  };
}

export async function deactivate(): Promise<void> {
  console.log('Extension deactivated');
}
```

### 3. レジストリに登録 (`extensions/registry.json`)

```json
{
  "id": "my-extension",
  "type": "ui",
  "manifestUrl": "/extensions/my-extension/manifest.json",
  "defaultEnabled": false,
  "recommended": true
}
```

## ベストプラクティス

### 1. リソースのクリーンアップ

```typescript
context.tabs.onTabClose(tabId, async (closedTabId) => {
  // データを保存
  await saveToStorage(data);
  // イベントリスナーを削除
  removeEventListeners();
});
```

### 2. エラーハンドリング

```typescript
try {
  const tabId = context.tabs.createTab(options);
} catch (error) {
  context.logger?.error('Failed to create tab:', error);
  // フォールバック処理
}
```

### 3. 状態の永続化

```typescript
// localStorageを使用
useEffect(() => {
  localStorage.setItem(`${extensionId}-${tabId}`, JSON.stringify(data));
}, [data]);
```

### 4. パフォーマンス最適化

```typescript
// React.memo を使用
const MyComponent = React.memo(({ data }) => {
  // ...
});

// useCallback を使用
const handleClick = React.useCallback(() => {
  // ...
}, [dependencies]);
```

## トラブルシューティング

### タブが表示されない

**原因:** TabRegistryに登録されていない

**解決:** TabAPIが自動的にTabRegistryに登録するため、通常は不要です。もし問題がある場合は、ブラウザのコンソールを確認してください。

### パネルがサイドバーに表示されない

**原因:** SidebarRegistryに登録されていない

**解決:** `context.sidebar.createPanel()` が正しく呼ばれているか確認してください。

### データが保存されない

**原因:** ブラウザのlocalStorageに保存していない

**解決:** `useEffect` で自動保存を実装してください。

## APIリファレンス

完全なAPI仕様は以下のファイルを参照してください:

- `src/engine/extensions/api/TabAPI.ts`
- `src/engine/extensions/api/SidebarAPI.ts`
- `src/engine/extensions/types.ts`

## サンプル拡張機能

- **Note Tab** (`extensions/note-tab`): シンプルなメモ帳タブ
- **TODO Panel** (`extensions/todo-panel`): TODOリスト管理

これらのサンプルを参考に、独自の拡張機能を開発してください。
