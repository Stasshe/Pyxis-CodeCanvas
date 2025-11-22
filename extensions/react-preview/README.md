# react-preview Extension

React/JSXファイルをブラウザ上でビルド・プレビューする拡張機能。

## 使い方

### 基本コマンド

```bash
react-build <entry.jsx> [--tailwind]
```

指定したJSX/TSXファイルをエントリーポイントとしてビルドし、プレビュータブを開きます。

### オプション

- `--tailwind`: Tailwind CSS CDNを読み込んでプレビュー

### 例

```bash
# 通常のビルド
react-build App.jsx

# Tailwind CSSを使用
react-build App.jsx --tailwind

# src配下のファイルをビルド
react-build src/App.jsx --tailwind

# 絶対パス指定も可
react-build /components/Button.jsx
```

## 機能

- **自動バンドル**: esbuild-wasmによる高速ビルド
- **相対インポート対応**: `import Button from './Button'` などが動作
- **CSS対応**: `.css`ファイルを`<style>`タグとして自動注入
- **React外部化**: React/ReactDOMは外部から供給（バンドルサイズ削減）
- **ホットプレビュー**: ビルド成功後、即座にプレビュータブが開く

## プロジェクト構成例

```
/
├── App.jsx          # エントリーポイント
├── Button.jsx       # コンポーネント
├── styles.css       # スタイル
└── src/
    └── Header.jsx
```

### サンプルコード

**App.jsx**
```jsx
import React from 'react';
import Button from './Button';
import './styles.css';

export default function App() {
  return (
    <div className="app">
      <h1>Hello, React Preview!</h1>
      <Button />
    </div>
  );
}
```

**Button.jsx**
```jsx
import React from 'react';

export default function Button() {
  return <button onClick={() => alert('Clicked!')}>Click me</button>;
}
```

**styles.css**
```css
.app {
  padding: 20px;
  font-family: sans-serif;
}

button {
  padding: 10px 20px;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
```

## 内部設定

### 必須の外部依存

この拡張機能を動作させるには、以下がグローバルに必要です：

```javascript
window.__PYXIS_REACT__       // React本体
window.__PYXIS_REACT_DOM__   // ReactDOM本体
```

これらはシステム側で事前にロードされている必要があります。

### esbuild.wasm配置

esbuildのWASMファイルは以下のパスに配置：

```
/extensions/react-preview/esbuild.wasm
```

ビルドシステムでNext.jsなどを使用している場合、`__NEXT_PUBLIC_BASE_PATH__`を考慮してWASMをロードします。

### transformImportsモジュール

システムモジュール`transformImports`が必要です。これはesbuildの出力を変換し、`require()`をシムと連携させます。

```javascript
const transformImportsModule = await context.getSystemModule('transformImports');
const transformed = transformImportsModule(bundled);
```

### fileRepositoryモジュール

仮想ファイルシステムとして`fileRepository`が必要です。

```javascript
const fileRepository = await context.getSystemModule('fileRepository');
const file = await fileRepository.getFileByPath(projectId, filePath);
```

## 制約

- **外部ライブラリ**: React/ReactDOM以外の外部ライブラリは現状未対応
- **TypeScript**: `.tsx`は部分対応（型チェックなし、トランスパイルのみ）
- **画像**: `.png`, `.jpg`などはスキップされる
- **エラー表示**: ビルドエラーはコンソールとプレビュータブに表示

## Tailwind CSS対応

**対応状況**: `--tailwind`オプションで有効化

プレビュー時に`--tailwind`オプションを指定すると、Tailwind CSS CDNを読み込みます。

### サンプルコード

```jsx
import React, { useState } from 'react';
export default function App() {
  const [count, setCount] = useState(0);
  const increment = () => {
    setCount(count + 1);
  };
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-xl p-8 max-w-md">
        <h1 className="text-3xl font-bold text-gray-800 mb-4">
          Tailwind CSS Ready!
        </h1>
        <p className="text-gray-700 mb-4">Count: {count}</p>
        <button
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition"
          onClick={increment}
        >
          Click me
        </button>
      </div>
    </div>
  );
}
```

```bash
# Tailwindを使用してビルド
react-build App.jsx --tailwind
```

### 制約

- **CDN版のため**: カスタムTailwind設定（`tailwind.config.js`）は非対応
- **初回読み込み**: CDNからの取得に若干時間がかかる場合あり
- **オフライン**: インターネット接続が必要
