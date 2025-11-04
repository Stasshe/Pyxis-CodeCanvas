# 拡張機能でのnpmライブラリ使用ガイド

このガイドは、Pyxis拡張機能でnpm/pnpmライブラリを使用する際の注意点をまとめたものです。

## ⚠️ 重要な注意点

### 1. **React/ReactDOMは依存関係に含めないでください**

Pyxis本体のReact/ReactDOMを使用するため、拡張機能のpackage.jsonに含めないでください。

**❌ NG:**
```json
{
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  }
}
```

**✅ OK:**
```json
{
  "dependencies": {
    "chart.js": "^4.4.1"
  },
  "devDependencies": {
    "@types/react": "^19"
  }
}
```

### 2. **ブラウザ対応ライブラリのみ使用可能**

拡張機能はブラウザで動作するため、Node.js専用ライブラリは使用できません。

**✅ OK:**
- lodash-es
- chart.js
- date-fns
- axios
- marked
- prismjs

**❌ NG:**
- fs, path (Node.js専用)
- express (サーバーサイド)
- sequelize (データベース)

### 3. **他のフレームワークは推奨しません**

Vue、Angular、Svelteなど、React以外のフレームワークを使用すると、以下の問題が発生する可能性があります：

- バンドルサイズの増加
- グローバルスコープの汚染
- パフォーマンスの低下

### 4. **軽量ライブラリを優先**

バンドルサイズが大きいとロード時間が増えるため、軽量なライブラリを選択してください。

**例:**
- ✅ `date-fns` (軽量、Tree-shakingサポート)
- ❌ `moment` (重い、非推奨)

## 📝 使用方法

### 1. package.jsonを作成

```bash
cd extensions/your-extension
pnpm init
```

### 2. 依存関係を追加

```bash
pnpm add chart.js
pnpm add -D @types/react
```

### 3. コードで使用

```tsx
import React, { useState } from 'react';
import { Chart } from 'chart.js';

// ライブラリを使用
```

### 4. ビルド

```bash
# プロジェクトルートで実行
node build-extensions.js
```

## 🔧 トラブルシューティング

### Q: Reactのバージョンエラーが出る

**A:** package.jsonからreact/react-domを削除してください。Pyxis本体のReactが使用されます。

### Q: バンドルサイズが大きすぎる

**A:** 
- 軽量な代替ライブラリを検索
- Tree-shakingが効くライブラリを使用
- 必要な機能だけimport

### Q: ブラウザで動作しない

**A:** Node.js専用APIを使用していないか確認してください。

## 📚 参考

詳細は `/docs/EXTENSION-NPM-LIBRARIES.md` を参照してください。
