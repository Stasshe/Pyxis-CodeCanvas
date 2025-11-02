# Pyxis Extensions

このディレクトリには、Pyxisの拡張機能のソースコード(TypeScript)が含まれています。

## 開発フロー

1. **拡張機能を作成** - `extensions/pyxis/<extension-name>/`にTypeScriptで記述
2. **ビルド実行** - `npm run dev`または`npm run build`
3. **自動配置** - `public/extensions/`にトランスパイル済みJavaScriptが配置される

## ディレクトリ構造

```
extensions/
└── pyxis/
    ├── typescript-runtime/    # TypeScriptトランスパイラ拡張
    │   ├── index.ts
    │   └── manifest.json
    └── i18n-service/          # 多言語対応サービス拡張
        ├── index.ts
        └── manifest.json
```

## 新しい拡張機能の作成

```bash
mkdir -p extensions/pyxis/my-extension
```

詳細は `/docs/EXTENSION-SYSTEM.md` を参照してください。

## ビルドコマンド

```bash
# 開発モード（自動ビルド）
npm run dev

# プロダクションビルド
npm run build

# 拡張機能のみビルド
node scripts/build-extensions.js
```

## 既存の拡張機能

| 拡張機能 | 種類 | 説明 |
|---------|------|------|
| typescript-runtime | transpiler | TypeScript/TSX/MTSのトランスパイル |
| i18n-service | service | 多言語対応サービス |

## 技術スタック

- **言語**: TypeScript
- **トランスパイラ**: Babel standalone
- **配置**: 静的ファイルとして`public/extensions/`
- **ロード**: fetch + IndexedDBキャッシュ
