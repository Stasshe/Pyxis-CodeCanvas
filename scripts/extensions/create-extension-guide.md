# 拡張機能テンプレート作成ツール

対話形式で拡張機能のテンプレートを作成するCLIツールです。

## 使い方

```bash
npm run create-extension
```

## 実行例

### UI拡張機能（サイドバーパネル）の作成

```
🚀 Pyxis Extension Template Generator
=====================================

拡張機能のタイプを選択してください:
  1. UI Extension - カスタムタブやサイドバーパネルを追加
  2. Transpiler - コードのトランスパイル機能を提供
  3. Service - 言語パックやテーマなどのサービス
  4. Built-in Module - Node.js互換モジュール (fs, pathなど)

選択してください (1-4): 1

拡張機能ID (例: my-extension): hello-world
拡張機能名 (例: My Extension): Hello World
説明: サンプルの拡張機能
作者名 (デフォルト: Pyxis Team): 
タグ (カンマ区切り、例: ui,productivity): ui,sample

UIコンポーネントのタイプを選択してください:
  1. Custom Tab - カスタムタブのみ
  2. Sidebar Panel - サイドバーパネルのみ
  3. Tab + Sidebar - タブとサイドバー両方

選択してください (1-3): 2

📋 設定確認:
  ID: hello-world
  名前: Hello World
  タイプ: ui
  コンポーネント: sidebar
  説明: サンプルの拡張機能
  作者: Pyxis Team
  タグ: ui, sample
  React使用: はい

この設定で作成しますか? (y/n): y

✅ ディレクトリ作成: extensions/hello-world/
✅ 作成: manifest.json
✅ 作成: index.tsx
✅ 作成: README.md

🎉 拡張機能のテンプレート作成完了！

次のステップ:
  1. extensions/hello-world/index.tsx を編集
  2. node build-extensions.js を実行（registry.jsonも自動生成されます）
  3. npm run dev で確認
```

### Transpiler拡張機能の作成

```
拡張機能のタイプを選択してください:
  1. UI Extension - カスタムタブやサイドバーパネルを追加
  2. Transpiler - コードのトランスパイル機能を提供
  3. Service - 言語パックやテーマなどのサービス
  4. Built-in Module - Node.js互換モジュール (fs, pathなど)

選択してください (1-4): 2

拡張機能ID (例: my-extension): python-runtime
拡張機能名 (例: My Extension): Python Runtime
説明: Pythonコードの実行をサポート
作者名 (デフォルト: Pyxis Team): 
タグ (カンマ区切り、例: ui,productivity): transpiler,python

📋 設定確認:
  ID: python-runtime
  名前: Python Runtime
  タイプ: transpiler
  説明: Pythonコードの実行をサポート
  作者: Pyxis Team
  タグ: transpiler, python
  React使用: いいえ

この設定で作成しますか? (y/n): y

✅ ディレクトリ作成: extensions/python-runtime/
✅ 作成: manifest.json
✅ 作成: index.ts
✅ 作成: README.md

🎉 拡張機能のテンプレート作成完了！
```

## 生成されるファイル

### manifest.json

拡張機能のメタデータ:

```json
{
  "id": "pyxis.hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "type": "ui",
  "description": "サンプルの拡張機能",
  "author": "Pyxis Team",
  "defaultEnabled": false,
  "entry": "index.js",
  "metadata": {
    "publishedAt": "2025-11-04T00:00:00Z",
    "tags": ["ui", "sample"]
  }
}
```

**注意:** `defaultEnabled` をtrueにすると、Pyxis起動時に自動的に有効化されます。

### index.tsx (UI拡張機能の場合)

Reactコンポーネントとactivate/deactivate関数を含むテンプレート:

```tsx
import React, { useState, useEffect } from 'react';
import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

// サイドバーパネルコンポーネント
function createHelloWorldPanel(context: ExtensionContext) {
  return function HelloWorldPanel({ extensionId, panelId, isActive, state }: any) {
    // コンポーネントの実装
  };
}

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  // 拡張機能の初期化
  return {};
}

export async function deactivate(): Promise<void> {
  // クリーンアップ
}
```

### index.ts (非UI拡張機能の場合)

Reactを使わないシンプルなテンプレート:

```typescript
import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  return {
    runtimeFeatures: {
      transpiler: async (code: string, options: any) => {
        // トランスパイル処理
        return { code };
      }
    }
  };
}
```

### README.md

拡張機能のドキュメント:

```markdown
# Hello World

サンプルの拡張機能

## 概要
...

## 開発
...

## 使い方
...
```

## 拡張機能タイプ別の特徴

| タイプ | ファイル拡張子 | React使用 | 返り値 | 用途 |
|--------|---------------|-----------|--------|------|
| UI Extension | `.tsx` | ✅ | `{}` | カスタムタブ、サイドバーパネル |
| Transpiler | `.ts` | ❌ | `runtimeFeatures` | コードのトランスパイル |
| Service | `.ts` | ❌ | `services` | 言語パック、テーマなど |
| Built-in Module | `.ts` | ❌ | `builtInModules` | Node.js互換モジュール |

## 次のステップ

1. **コードを編集** - 生成された `index.tsx` / `index.ts` を編集
2. **ビルド** - `node build-extensions.js` を実行
3. **テスト** - `npm run dev` で開発サーバーを起動
4. **確認** - ブラウザで拡張機能パネルから有効化

## トラブルシューティング

### IDに使用できる文字

- ✅ 小文字英数字 (`a-z`, `0-9`)
- ✅ ハイフン (`-`)
- ❌ 大文字、アンダースコア、スペースは不可

正しい例: `hello-world`, `my-extension-v2`, `python-runtime`
間違った例: `HelloWorld`, `my_extension`, `my extension`

### 拡張機能が既に存在する

同じIDの拡張機能が既にある場合はエラーになります。別のIDを使用するか、既存の拡張機能を削除してください。

```bash
rm -rf extensions/hello-world
```

## 参考リンク

- [拡張機能開発ガイド](/docs/HOW-TO-CREATE-EXTENSION.md)
- [拡張機能システム](/docs/EXTENSION-SYSTEM.md)
- [Tab/Sidebar API](/docs/EXTENSION-TAB-SIDEBAR-API.md)
