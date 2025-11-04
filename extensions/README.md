# Pyxis Extensions

このディレクトリには、Pyxisの拡張機能のソースコード(TypeScript/TSX)が含まれています。

## ディレクトリ構造

```
extensions/
├── _shared/
│   └── types.ts              # 共通型定義
├── typescript-runtime/
│   ├── index.ts              # TypeScript/JSX トランスパイラ
│   └── manifest.json
├── note-tab/
│   ├── index.tsx             # ノートタブ拡張機能 (TSX使用)
│   └── manifest.json
├── todo-panel/
│   ├── index.tsx             # TODOパネル拡張機能 (TSX使用)
│   └── manifest.json
└── lang-packs/
    ├── ja/                   # 日本語パック
    │   ├── index.ts
    │   └── manifest.json
    ├── en/                   # 英語パック
    │   ├── index.ts
    │   └── manifest.json
    └── zh/                   # 中国語パック
        ├── index.ts
        └── manifest.json
```

## 開発フロー

1. **拡張機能を作成** - `extensions/<extension-name>/`にTypeScript/TSXで記述
2. **ビルド実行** - `node build-extensions.js`
3. **自動配置** - `public/extensions/`にトランスパイル済みJavaScriptが配置される

## 拡張機能の種類

| タイプ | 説明 | React必須 | 返り値 |
|--------|------|-----------|--------|
| **transpiler** | TypeScript/JSX などのトランスパイラ | ❌ | `runtimeFeatures` |
| **service** | 言語パック（i18nなど） | ❌ | `services` |
| **builtin-module** | Node.js 互換モジュール (fs, path など) | ❌ | `builtInModules` |
| **ui** | カスタムタブ、サイドバーパネル | ✅ | `{}` (空) |

**重要:** 
- **UI拡張機能** (`type: "ui"`) は React を使用して `context.tabs` / `context.sidebar` APIでUIを登録します
- **非UI拡張機能** (`transpiler`, `service`, `builtin-module`) は React 不要で、機能のみを提供します

## 新しい拡張機能の作成

### 🚀 クイックスタート（推奨）

対話形式でテンプレートを自動生成:

```bash
npm run create-extension
```

以下の情報を入力するだけで、拡張機能のひな形が完成します:
1. 拡張機能タイプ（UI/Transpiler/Service/Built-in Module）
2. 拡張機能ID（例: `my-extension`）
3. 名前と説明
4. UI拡張の場合はコンポーネントタイプ（Tab/Sidebar/Both）
5. タグ（オプション）

テンプレートには以下が含まれます:
- ✅ `manifest.json` - メタデータ
- ✅ `index.ts` または `index.tsx` - メインコード
- ✅ `README.md` - ドキュメント
- ✅ (オプション) `registry.json` への自動登録

### 📝 手動作成

#### 1. ディレクトリ作成

```bash
mkdir -p extensions/my-extension
```

#### 2. manifest.json を作成

```json
{
  "id": "pyxis.my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "type": "ui",
  "description": "拡張機能の説明",
  "author": "Your Name",
  "entry": "index.js",
  "metadata": {
    "publishedAt": "2025-01-01T00:00:00Z",
    "tags": ["ui", "productivity"]
  }
}
```

**注意:** `provides` フィールドは不要です（マニフェストに書いても読み取られません）

#### 3. index.tsx を作成 (TSX推奨)

```tsx
import type { ExtensionContext, ExtensionActivation } from '../_shared/types';
import React, { useState } from 'react';

// タブコンポーネント（TSX構文）
function MyTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  const [count, setCount] = useState(0);

  return (
    <div style={{ padding: '16px', background: '#1e1e1e', color: '#d4d4d4' }}>
      <h2>My Custom Tab</h2>
      <p>Count: {count}</p>
      <button
        onClick={() => setCount(count + 1)}
        style={{
          padding: '8px 16px',
          background: '#0e639c',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      >
        Increment
      </button>
    </div>
  );
}

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('My Extension activating...');
  
  // タブコンポーネントを登録
  if (context.tabs) {
    context.tabs.registerTabType(MyTabComponent);
    context.logger?.info('Tab component registered');
  }
  
  // サイドバーパネルを登録（オプション）
  if (context.sidebar) {
    context.sidebar.createPanel({
      id: 'my-panel',
      title: 'My Panel',
      icon: 'Package',
      component: MyPanelComponent,
      order: 50,
    });
  }
  
  // UI拡張機能なので、services/commandsは不要
  return {};
}

export async function deactivate(): Promise<void> {
  console.log('[My Extension] Deactivating...');
}
```

**または、React.createElementを使用 (index.ts)**

```typescript
import type { ExtensionContext, ExtensionActivation } from '../_shared/types';
import React, { useState } from 'react';

function MyTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
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

// ... 残りは同じ
```

#### 4. レジストリに登録

`extensions/registry.json` に拡張機能を追加:

```json
{
  "id": "pyxis.my-extension",
  "type": "ui",
  "manifestUrl": "/extensions/my-extension/manifest.json",
  "defaultEnabled": false,
  "recommended": false
}
```

#### 5. ビルドして配置

```bash
node build-extensions.js
```

ビルドされた拡張機能は `public/extensions/` に配置されます。

#### 6. 開発サーバーで確認

```bash
npm run dev
```

ブラウザで拡張機能パネルから「My Extension」をインストール・有効化してください。

## 既存の拡張機能

| 拡張機能 | 種類 | ファイル | 説明 |
|---------|------|---------|------|
| typescript-runtime | transpiler | index.ts | TypeScript/JSX/TSXのトランスパイル |
| note-tab | ui | index.tsx | シンプルなノートタブ (TSX使用) |
| todo-panel | ui | index.tsx | TODOリスト管理 (TSX使用) |
| lang-packs/* | service | index.ts | 言語パック (ja, en, zh など) |

## 型定義について

`_shared/types.ts` には共通の型定義があります:

- **ExtensionContext**: 拡張機能のコンテキスト
  - `extensionId`: 拡張機能のID
  - `logger`: ロガー (info, warn, error)
  - `tabs`: Tab API (タブ作成・管理)
  - `sidebar`: Sidebar API (サイドバーパネル作成・管理)
  - `getSystemModule`: システムモジュールの取得
- **ExtensionActivation**: activate() の戻り値型
  - `services`: 提供するサービス
  - `commands`: コマンド
  - `dispose`: クリーンアップ関数
- **ExtensionType**: 拡張機能の種類

拡張機能は外部依存を持たず、自己完結している必要があります。
型定義の import は相対パスで `../_shared/types` を使用してください。

## TSX vs TypeScript

### TSX (推奨) - HTMLライクな構文

```tsx
// ファイル名: index.tsx
return (
  <div style={{ padding: '16px' }}>
    <h2>Hello</h2>
    <button onClick={handleClick}>Click</button>
  </div>
);
```

**メリット:**
- ✅ 直感的で読みやすい
- ✅ ネストが深くても見やすい
- ✅ JSXのベストプラクティス

### TypeScript - React.createElement

```typescript
// ファイル名: index.ts
return React.createElement(
  'div',
  { style: { padding: '16px' } },
  [
    React.createElement('h2', { key: 'title' }, 'Hello'),
    React.createElement('button', { key: 'btn', onClick: handleClick }, 'Click'),
  ]
);
```

**メリット:**
- ✅ JSXに慣れていない人にもわかりやすい
- ✅ ビルド後のコードが想像しやすい

**どちらもビルド後は同じコードになります。**

## ビルドシステム

`build-extensions.js` は:
- **TypeScript/TSX ファイル**を **tsc** でトランスパイル
  - TSX → `React.createElement` に変換
  - `import React from 'react'` → `const React = window.__PYXIS_REACT__` に変換
- **JSON/画像/Markdown ファイル**をコピー
- `public/extensions/` に出力

実行方法:

```bash
node build-extensions.js
```

**ビルド時の変換例:**

```tsx
// 開発時 (index.tsx)
import React from 'react';
<div>Hello</div>

// ビルド後 (index.js)
const React = window.__PYXIS_REACT__;
React.createElement('div', null, 'Hello')
```

**重要:** Reactはバンドルされません。ランタイムで`window.__PYXIS_REACT__`から提供されます。

## レジストリ

`public/extensions/registry.json` には利用可能な拡張機能の一覧が含まれています。
新しい拡張機能を追加したら、このファイルも更新してください。

```json
{
  "version": "1.0.0",
  "extensions": [
    {
      "id": "pyxis.my-extension",
      "type": "service",
      "manifestUrl": "/extensions/my-extension/manifest.json",
      "defaultEnabled": false,
      "recommended": false
    }
  ]
}
```

## 技術スタック

- **言語**: TypeScript / TSX
- **UI**: React (グローバルスコープから提供)
- **トランスパイラ**: tsc (TypeScript Compiler)
  - JSX設定: `jsx: 'react'`
  - JSX Factory: `React.createElement`
- **配置**: 静的ファイルとして`public/extensions/`
- **ロード**: fetch + IndexedDBキャッシュ
- **アーキテクチャ**: Static Site (サーバーサイド処理なし)

## API

### Tab API

拡張機能がカスタムタブを作成・管理できます。

```typescript
// タブコンポーネントを登録
context.tabs.registerTabType(MyTabComponent);

// タブを作成
const tabId = context.tabs.createTab({
  title: '📝 My Tab',
  icon: 'FileText',
  closable: true,
  data: { content: 'Hello' },
});

// タブを更新
context.tabs.updateTab(tabId, {
  title: 'Updated Title',
  data: { content: 'New content' },
});

// タブを閉じる
context.tabs.closeTab(tabId);

// タブのクローズイベント
context.tabs.onTabClose(tabId, (closedTabId) => {
  console.log('Tab closed:', closedTabId);
});
```

### Sidebar API

拡張機能がサイドバーにパネルを追加できます。

```typescript
// パネルを作成
context.sidebar.createPanel({
  id: 'my-panel',
  title: 'My Panel',
  icon: 'Package',
  component: MyPanelComponent,
  order: 50,
});

// パネルの状態を更新
context.sidebar.updatePanel('my-panel', { items: [...] });

// パネルを削除
context.sidebar.removePanel('my-panel');

// パネルのアクティブイベント
context.sidebar.onPanelActivate('my-panel', (panelId) => {
  console.log('Panel activated:', panelId);
});
```

## サンプル拡張機能

詳細な実装例は以下を参照してください:

- **Note Tab** (`extensions/note-tab/`) - シンプルなノートタブ (TSX使用)
- **TODO Panel** (`extensions/todo-panel/`) - TODOリスト管理 (TSX使用)

## 詳細ドキュメント

詳細は以下を参照してください:
- `/docs/EXTENSION-TAB-SIDEBAR-API.md` - **拡張機能開発ガイド** (必読)
- `/docs/EXTENSION-SYSTEM.md` - 拡張機能システムの設計
- `/docs/SYSTEM-OVERVIEW.md` - システム全体概要

## よくある質問

### Q: TSXとTypeScriptどちらを使うべき？

**A: UI拡張機能の場合はTSXを推奨します。** 直感的で読みやすく、Reactのベストプラクティスに沿っています。非UI拡張機能（transpiler, serviceなど）の場合はTypeScript (.ts) で十分です。

### Q: Reactをimportする必要がある？

**A: UI拡張機能の場合のみ必須です。** `import React from 'react'` は必須で、ビルド時に`const React = window.__PYXIS_REACT__`に変換されます。非UI拡張機能（typescript-runtime, lang-packsなど）ではReactは不要です。

### Q: npm パッケージは使える？

**A: いいえ。** Pyxisは静的サイトで、拡張機能は動的にロードされます。React以外の外部パッケージは使用できません。

### Q: データを永続化するには？

**A: localStorageを使用してください。**

```typescript
// 保存
localStorage.setItem('my-extension-data', JSON.stringify(data));

// 読み込み
const data = JSON.parse(localStorage.getItem('my-extension-data') || '{}');
```

### Q: 拡張機能間で通信するには？

**A: CustomEventを使用してください。**

```typescript
// イベント発火
window.dispatchEvent(new CustomEvent('my-event', { detail: { data } }));

// イベントリッスン
window.addEventListener('my-event', (event) => {
  console.log(event.detail.data);
});
```
