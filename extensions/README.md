# Pyxis Extensions

このディレクトリには、Pyxisの拡張機能のソースコード(TypeScript)が含まれています。

## ディレクトリ構造

```
extensions/
├── _shared/
│   └── types.ts              # 共通型定義
├── typescript-runtime/
│   ├── index.ts              # TypeScript/JSX トランスパイラ
│   └── manifest.json
├── i18n-service/
│   ├── index.ts              # 多言語対応サービス (表示専用)
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

1. **拡張機能を作成** - `extensions/<extension-name>/`にTypeScriptで記述
2. **ビルド実行** - `node build-extensions.js`
3. **自動配置** - `public/extensions/`にトランスパイル済みJavaScriptが配置される

## 拡張機能の種類

- **transpiler**: TypeScript/JSX などのトランスパイラ
- **service**: i18n、テーマなどのサービス
- **builtin-module**: Node.js 互換モジュール (fs, path など)
- **language-runtime**: Python、Ruby などのランタイム
- **tool**: ユーティリティツール
- **ui**: UI コンポーネント

## 新しい拡張機能の作成

### 1. ディレクトリ作成

```bash
mkdir -p extensions/my-extension
```

### 2. manifest.json を作成

```json
{
  "id": "pyxis.my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "type": "service",
  "description": "拡張機能の説明",
  "author": "Your Name",
  "dependencies": [],
  "entry": "index.js"
}
```

### 3. index.ts を作成

```typescript
import type { ExtensionContext, ExtensionActivation } from '../_shared/types.js';

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('My Extension activating...');
  
  return {
    services: {
      'my-service': {
        // your API
      },
    },
  };
}

export async function deactivate(): Promise<void> {
  console.log('[My Extension] Deactivating...');
}
```

### 4. ビルドして配置

```bash
node build-extensions.js
```

ビルドされた拡張機能は `public/extensions/` に配置されます。

## 既存の拡張機能

| 拡張機能 | 種類 | 説明 |
|---------|------|------|
| typescript-runtime | transpiler | TypeScript/JSX/TSXのトランスパイル |
| i18n-service | service | 多言語対応サービス (表示専用) |
| lang-packs/* | service | 言語パック (ja, en, zh など) |

## 型定義について

`_shared/types.ts` には共通の型定義があります:

- **ExtensionContext**: 拡張機能のコンテキスト (logger, storage など)
- **ExtensionActivation**: activate() の戻り値型
- **ExtensionType**: 拡張機能の種類

拡張機能は外部依存を持たず、自己完結している必要があります。
型定義の import は相対パスで `../_shared/types.js` を使用してください。

## ビルドシステム

`build-extensions.js` は:
- TypeScript ファイルを **tsc** でトランスパイル
- JSON/画像/Markdown ファイルをコピー
- `public/extensions/` に出力

実行方法:

```bash
node build-extensions.js
```

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

- **言語**: TypeScript
- **トランスパイラ**: tsc (TypeScript Compiler)
- **配置**: 静的ファイルとして`public/extensions/`
- **ロード**: fetch + IndexedDBキャッシュ

## 詳細ドキュメント

詳細は以下を参照してください:
- `/Development/EXTENSION-SYSTEM.md` - 拡張機能システムの設計
- `/docs/SYSTEM-OVERVIEW.md` - システム全体概要
