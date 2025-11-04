# 拡張機能でのnpmライブラリ使用ガイド

Pyxis v0.12.0 以降、各拡張機能でnpm/pnpmライブラリを使用できるようになりました。

## 📋 概要

### 対応機能

- ✅ **esbuildバンドラー**: package.jsonがある拡張機能はesbuildでバンドル
- ✅ **npm/pnpm/yarnサポート**: どのパッケージマネージャーでも使用可能
- ✅ **React外部化**: Pyxis本体のReact/ReactDOMを使用（重複を防ぐ）
- ✅ **後方互換性**: package.jsonがない拡張機能は従来通りtscでトランスパイル
- ✅ **Tree-shaking**: 使われていないコードは自動的に削除
- ✅ **型安全性**: TypeScript完全サポート

### 制約事項

- ❌ **React/ReactDOMは外部化**: バンドルに含めない（Pyxisから提供）
- ❌ **サーバーサイドライブラリは不可**: ブラウザで動作するライブラリのみ
- ⚠️ **フレームワーク競合注意**: VueやAngularなど、Reactと競合する可能性があるフレームワークは推奨しない

---

## 🚀 クイックスタート

### ステップ1: 拡張機能を作成

```bash
npm run create-extension
```

または手動で:

```bash
mkdir -p extensions/my-extension
```

### ステップ2: package.jsonを追加

```bash
cd extensions/my-extension
cat > package.json << 'EOF'
{
  "name": "my-extension",
  "version": "1.0.0",
  "private": true,
  "description": "My custom extension",
  "dependencies": {
    "lodash-es": "^4.17.21"
  },
  "devDependencies": {
    "@types/react": "^19",
    "@types/lodash-es": "^4.17.12"
  }
}
EOF
```

### ステップ3: 依存関係をインストール

```bash
pnpm install
# または npm install
# または yarn install
```

### ステップ4: コードを書く (index.tsx)

```tsx
import type { ExtensionContext, ExtensionActivation } from '../_shared/types';
import React, { useState } from 'react';
import { debounce } from 'lodash-es';

function MyTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  const [value, setValue] = useState('');
  
  // lodashのdebounceを使用
  const handleChange = debounce((val: string) => {
    console.log('Debounced value:', val);
  }, 500);
  
  return (
    <div style={{ padding: '16px' }}>
      <h2>My Extension with Lodash</h2>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          handleChange(e.target.value);
        }}
        style={{ padding: '8px', width: '300px' }}
      />
    </div>
  );
}

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('My Extension activating...');
  
  if (context.tabs) {
    context.tabs.registerTabType(MyTabComponent);
    
    context.tabs.createTab({
      title: '🎉 My Extension',
      icon: 'Package',
      closable: true,
      data: {},
    });
  }
  
  return {};
}

export async function deactivate(): Promise<void> {
  console.log('[My Extension] Deactivating...');
}
```

### ステップ5: manifest.jsonを追加

```json
{
  "id": "pyxis.my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "type": "ui",
  "description": "My custom extension with npm libraries",
  "author": "Your Name",
  "defaultEnabled": false,
  "entry": "index.js"
}
```

### ステップ6: ビルド

```bash
# プロジェクトルートで実行
node build-extensions.js
```

### ステップ7: 確認

```bash
npm run dev
```

ブラウザで拡張機能パネルから「My Extension」をインストール・有効化してください。

---

## 📦 サンプル: Chart.js を使った拡張機能

### ディレクトリ構造

```
extensions/chart-extension/
├── package.json
├── manifest.json
├── index.tsx
└── README.md
```

### package.json

```json
{
  "name": "chart-extension",
  "version": "1.0.0",
  "private": true,
  "description": "Chart visualization extension",
  "dependencies": {
    "chart.js": "^4.4.1"
  },
  "devDependencies": {
    "@types/react": "^19"
  }
}
```

### manifest.json

```json
{
  "id": "pyxis.chart-extension",
  "name": "Chart Visualization",
  "version": "1.0.0",
  "type": "ui",
  "description": "Chart visualization using Chart.js",
  "author": "Pyxis Team",
  "defaultEnabled": false,
  "entry": "index.js"
}
```

### index.tsx

```tsx
import type { ExtensionContext, ExtensionActivation } from '../_shared/types';
import React, { useState, useEffect, useRef } from 'react';
import { Chart, ChartConfiguration, registerables } from 'chart.js';

Chart.register(...registerables);

function ChartTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const [chartType, setChartType] = useState<'line' | 'bar' | 'pie'>('line');
  
  useEffect(() => {
    if (!canvasRef.current) return;
    
    if (chartRef.current) {
      chartRef.current.destroy();
    }
    
    const data = {
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
      datasets: [{
        label: 'Sample Data',
        data: [12, 19, 3, 5, 2, 3],
        backgroundColor: 'rgba(54, 162, 235, 0.2)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 1,
      }],
    };
    
    const config: ChartConfiguration = {
      type: chartType,
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
      },
    };
    
    chartRef.current = new Chart(canvasRef.current, config);
    
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
    };
  }, [chartType]);
  
  return (
    <div style={{ padding: '16px', height: '100%' }}>
      <h2>📊 Chart Visualization</h2>
      
      <div style={{ marginBottom: '16px' }}>
        <button onClick={() => setChartType('line')}>Line</button>
        <button onClick={() => setChartType('bar')}>Bar</button>
        <button onClick={() => setChartType('pie')}>Pie</button>
      </div>
      
      <div style={{ height: '400px' }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  if (context.tabs) {
    context.tabs.registerTabType(ChartTabComponent);
    
    context.tabs.createTab({
      title: '📊 Chart',
      icon: 'BarChart3',
      closable: true,
      data: {},
    });
  }
  
  return {};
}

export async function deactivate(): Promise<void> {
  console.log('[Chart Extension] Deactivating...');
}
```

---

## 🔧 ビルドシステムの仕組み

### フロー図

```
拡張機能ディレクトリ
    │
    ├─ package.json あり?
    │   │
    │   ├─ YES → esbuild バンドル
    │   │         ├─ node_modules チェック
    │   │         ├─ なければ pnpm/npm install
    │   │         ├─ TypeScript/TSX トランスパイル
    │   │         ├─ 依存関係バンドル
    │   │         ├─ React/ReactDOM 外部化
    │   │         └─ public/extensions/ に出力
    │   │
    │   └─ NO  → tsc トランスパイル
    │             ├─ TypeScript/TSX のみ変換
    │             ├─ 依存関係なし
    │             └─ public/extensions/ に出力
    │
    └─ JSON/画像/Markdown ファイルをコピー
```

### esbuild設定

```javascript
esbuild.build({
  entryPoints: [entryPoint],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'react-dom/client',
  ],
  // ...
})
```

**重要ポイント:**

1. **`external: ['react', 'react-dom']`**: React系は外部化し、バンドルに含めない
2. **`jsx: 'transform'`**: TSXを`React.createElement`に変換
3. **ビルド後の変換**: `import React from 'react'` → `const React = window.__PYXIS_REACT__`

---

## 💡 ベストプラクティス

### 1. Reactは外部化する

**❌ NG: Reactをバンドルに含める**

```json
{
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  }
}
```

**✅ OK: ReactはdevDependencyまたは省略**

```json
{
  "devDependencies": {
    "@types/react": "^19"
  }
}
```

### 2. ブラウザ対応ライブラリのみ使用

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

### 3. 軽量ライブラリを優先

**理由:** 拡張機能はユーザーのブラウザで動作するため、バンドルサイズが大きいとロード時間が増える

**例:**
- ✅ `date-fns` (軽量、Tree-shakingサポート)
- ❌ `moment` (重い、非推奨)

### 4. 型定義を追加

```json
{
  "devDependencies": {
    "@types/react": "^19",
    "@types/lodash-es": "^4.17.12"
  }
}
```

### 5. プライベートパッケージにする

```json
{
  "private": true
}
```

これにより、誤ってnpmに公開されるのを防ぎます。

---

## 🚫 非推奨: フレームワーク競合

### Vue、Angular、Svelte等は推奨しない

PyxisはReactベースのため、他のフレームワークを使うと以下の問題が発生する可能性があります:

1. **バンドルサイズの増加**: 2つのフレームワークが共存するとサイズが大幅に増える
2. **グローバルスコープ汚染**: 複数のフレームワークがグローバル変数を競合させる可能性
3. **パフォーマンス低下**: 2つのVirtual DOMが同時に動作するとオーバーヘッド

### 代替案

**CDNを使う:**

CDNからライブラリを読み込み、スクリプトタグで使用する方法もありますが、拡張機能システムの外で管理する必要があります。

```tsx
useEffect(() => {
  // CDNから動的ロード
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/some-library@1.0.0/dist/bundle.min.js';
  document.head.appendChild(script);
  
  return () => {
    document.head.removeChild(script);
  };
}, []);
```

**推奨: Reactエコシステム内のライブラリを使う**

Reactと互換性のあるライブラリを選択することで、問題を回避できます。

---

## 📚 よくある質問

### Q: 既存の拡張機能はどうなる?

**A:** package.jsonがない拡張機能は従来通りtscでトランスパイルされます。後方互換性は保たれています。

### Q: Reactのバージョンは?

**A:** Pyxis本体のReact (v19.2.0) が使用されます。拡張機能側で別バージョンを指定しても無視されます。

### Q: バンドルサイズが大きくなる?

**A:** esbuildはTree-shakingをサポートしているため、使われていないコードは自動的に削除されます。ただし、大きなライブラリは避けるべきです。

### Q: ソースマップは生成される?

**A:** デフォルトでは生成されません（`sourcemap: false`）。デバッグ用に有効化したい場合は`build-extensions.js`を編集してください。

### Q: minifyされる?

**A:** デフォルトでは無効です（`minify: false`）。デバッグしやすさを優先しています。本番環境では有効化を推奨します。

### Q: CDNライブラリは使える?

**A:** 使用可能ですが、拡張機能システムの管理外になります。動的に`<script>`タグを挿入する方法で実装してください。

---

## 🔄 ビルドコマンド

```bash
# 拡張機能をビルド
node build-extensions.js

# または npm scriptで
npm run setup-build

# 開発サーバー起動（自動ビルド含む）
npm run dev
```

---

## 🎉 まとめ

Pyxis v0.12.0以降、拡張機能でnpmライブラリを使用できるようになりました!

**手順:**
1. 拡張機能ディレクトリにpackage.jsonを追加
2. 依存関係をインストール (pnpm/npm/yarn)
3. index.tsxでライブラリをimport
4. `node build-extensions.js`でビルド
5. Pyxisで拡張機能を有効化

**注意点:**
- React/ReactDOMは外部化（Pyxis本体を使用）
- ブラウザ対応ライブラリのみ使用
- 他のフレームワーク（Vue等）は推奨しない

**サンプル:** `extensions/chart-extension/` を参照
