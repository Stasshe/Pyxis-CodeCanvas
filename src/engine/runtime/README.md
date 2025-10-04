# Node.js Runtime - モジュール解決システム

## 概要

Pyxis CodeCanvasのNode.jsランタイムは、完全にブラウザ環境で動作するNode.js互換の実行環境です。npm installされたパッケージ、ES Modules、CommonJS、TypeScriptをサポートし、IndexedDBをベースとした高度なモジュール解決とキャッシュ機構を備えています。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                       NodeRuntime                            │
│  - エントリーポイント                                         │
│  - サンドボックス環境の構築                                   │
│  - ビルトインモジュールの提供                                 │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ↓
┌─────────────────────────────────────────────────────────────┐
│                     ModuleLoader                             │
│  - モジュールの読み込みと実行                                │
│  - トランスパイル処理の調整                                   │
│  - 循環参照の検出と解決                                       │
└─────┬───────────────┬───────────────┬───────────────────────┘
      │               │               │
      ↓               ↓               ↓
┌───────────┐   ┌────────────┐   ┌──────────────┐
│  Module   │   │  Module    │   │   Module     │
│  Resolver │   │  Cache     │   │  Transpiler  │
│           │   │            │   │              │
│ パス解決  │   │ LRUキャッシュ│  │ TS/ESM変換   │
│ node_modules│  │ IndexedDB  │   │ SWC wasm    │
│ エイリアス │   │ GC機能     │   │ (将来実装)  │
└───────────┘   └────────────┘   └──────────────┘
```

## ファイル構成

### 1. `nodeRuntime.ts`
**役割**: メインランタイムエントリーポイント

**主な機能**:
- ファイルの実行
- サンドボックス環境の構築
- ビルトインモジュールの提供
- require関数の実装

**使用例**:
```typescript
import { executeNodeFile } from '@/engine/runtime/nodeRuntime';

await executeNodeFile({
  projectId: 'project-123',
  projectName: 'my-project',
  filePath: '/src/index.js',
  debugConsole: {
    log: console.log,
    error: console.error,
    warn: console.warn,
    clear: console.clear,
  },
});
```

---

### 2. `moduleLoader.ts`
**役割**: モジュールの読み込みと管理

**主な機能**:
- モジュールの解決と読み込み
- トランスパイル処理の調整
- 実行キャッシュ（循環参照対策）
- 依存関係の抽出

**処理フロー**:
1. モジュール名を受け取る
2. ModuleResolverでパスを解決
3. ビルトインモジュールならそのまま返す
4. キャッシュをチェック
5. ファイルを読み込み
6. 必要ならトランスパイル
7. モジュールを実行してexportsを返す

---

### 3. `moduleResolver.ts`
**役割**: モジュールパスの解決

**主な機能**:
- 相対パス解決 (`./`, `../`)
- node_modules解決
- エイリアス解決 (`@/`)
- package.jsonの解析
- exportsフィールドのサポート

**解決優先順位**:
1. ビルトインモジュール (`fs`, `path`, etc.)
2. 相対パス (`./module`, `../utils`)
3. エイリアス (`@/components/Button`)
4. node_modules (`lodash`, `@vue/runtime-core`)

**パス解決例**:
```typescript
// 相対パス
require('./utils') → /projects/my-project/src/utils.js

// エイリアス
require('@/components/Button') → /projects/my-project/src/components/Button.js

// node_modules
require('lodash') → /projects/my-project/node_modules/lodash/lodash.js

// スコープ付きパッケージ
require('@vue/runtime-core') → /projects/my-project/node_modules/@vue/runtime-core/dist/runtime-core.esm-bundler.js
```

---

### 4. `transpileManager.ts` ⭐ NEW
**役割**: SWC wasmを使用したトランスパイル管理

**主な機能**:
- Web Workerの作成と管理
- SWC wasmによるAST変換
- TypeScript/JSX/ES Module完全サポート
- 自動メモリ管理（Worker終了）

**使用例**:
```typescript
import { transpileManager } from '@/engine/runtime/transpileManager';

const result = await transpileManager.transpile({
  code: 'const x: number = 1;',
  filePath: '/src/index.ts',
  isTypeScript: true,
  isESModule: true,
});

console.log(result.code); // トランスパイル済みコード
console.log(result.dependencies); // 依存関係リスト
```

**処理フロー**:
1. Web Workerを作成
2. SWC wasmを初期化（Worker内）
3. AST変換を実行
4. 結果を返却
5. Workerを即座に終了（メモリ解放）

---

### 5. `transpileWorker.ts` ⭐ NEW
**役割**: Web Worker内でのSWC wasm実行

**主な機能**:
- SWC wasmの初期化
- TypeScript → JavaScript変換
- JSX → JavaScript変換
- ES Module → CommonJS変換
- 依存関係の抽出

**SWCオプション**:
```typescript
{
  jsc: {
    parser: {
      syntax: 'typescript', // or 'ecmascript'
      tsx: true,
      decorators: true,
      dynamicImport: true,
    },
    target: 'es2020',
  },
  module: {
    type: 'commonjs', // ES Module → CommonJS
  },
}
```

---

### 6. `moduleCache.ts`
**役割**: トランスパイル済みモジュールのキャッシュ管理

**主な機能**:
- LRU戦略によるメモリ管理
- IndexedDBへの永続化
- 自動GC（100MBを超えたら古いキャッシュを削除）
- ハッシュベースのキャッシュキー

**キャッシュ構造**:
```
/cache/
  ├─ modules/           # トランスパイル済みコード
  │   ├─ abc123.js
  │   ├─ def456.js
  │   └─ ...
  └─ meta/              # メタデータ
      ├─ abc123.json    # 依存関係、更新日時など
      ├─ def456.json
      └─ ...
```

**メタデータ例**:
```json
{
  "originalPath": "/src/utils/helper.ts",
  "hash": "abc123",
  "deps": ["fs", "path", "./config"],
  "mtime": 1728300000,
  "lastAccess": 1728301000,
  "size": 12456
}
```

---

## モジュール解決フロー

### 1. require('lodash') の場合

```
1. ModuleResolver.resolve('lodash', '/src/index.js')
   ↓
2. ビルトインモジュール? → No
   ↓
3. 相対パス? → No
   ↓
4. エイリアス? → No
   ↓
5. node_modules解決
   ├─ package.jsonを読む
   │   /node_modules/lodash/package.json
   │   → main: "lodash.js"
   ├─ エントリーポイントを決定
   │   → /node_modules/lodash/lodash.js
   └─ ファイル存在チェック → OK
   ↓
6. ModuleLoader.load('/node_modules/lodash/lodash.js')
   ↓
7. キャッシュチェック → なし
   ↓
8. ファイル読み込み（IndexedDB）
   ↓
9. ES Module? → No
   TypeScript? → No
   ↓
10. そのまま実行
    ↓
11. exports返却
```

### 2. require('./utils/helper') の場合

```
1. ModuleResolver.resolve('./utils/helper', '/src/index.js')
   ↓
2. 相対パス解決
   ├─ 現在のディレクトリ: /src
   ├─ 相対パス: ./utils/helper
   └─ 結合: /src/utils/helper
   ↓
3. 拡張子を試す
   ├─ /src/utils/helper.js → 存在
   └─ 決定: /src/utils/helper.js
   ↓
4. ModuleLoader.load('/src/utils/helper.js')
   ↓
5. キャッシュチェック → なし
   ↓
6. ファイル読み込み
   ↓
7. ES Module? → Yes (import/export構文あり)
   ↓
8. トランスパイルキャッシュチェック → なし
   ↓
9. トランスパイル (ES Module → CommonJS)
   import x from 'y' → const x = require('y')
   export default z → module.exports = z
   ↓
10. キャッシュに保存
    ├─ /cache/modules/xyz789.js
    └─ /cache/meta/xyz789.json
    ↓
11. 実行してexports返却
```

---

## サポート機能

### ✅ 実装済み
- [x] 相対パス解決 (`./`, `../`)
- [x] node_modules解決
- [x] エイリアス (`@/`)
- [x] package.json解析
- [x] ES Module → CommonJS変換
- [x] トランスパイルキャッシュ
- [x] LRU GC
- [x] 循環参照検出
- [x] ビルトインモジュール
- [x] スコープ付きパッケージ (`@vue/xxx`)

### ✅ 実装済み（SWC wasm統合完了！）
- [x] SWC wasmによる本格的なトランスパイル
- [x] Web Worker内でのトランスパイル実行
- [x] TypeScript完全サポート（型チェック以外）
- [x] JSX/TSXサポート
- [x] 自動メモリ管理（Worker終了）

### 🚧 一部実装
- [ ] Source Map生成（SWC対応済みだが無効化中）
- [ ] package.json exportsフィールド（基本的な対応のみ）
- [ ] Workerプール（現在は都度作成）

### 📝 未実装（将来対応）
- [ ] 条件付きexports（node/browser）
- [ ] Source Map統合
- [ ] Workerプールによる並列処理

---

## パフォーマンス最適化

### キャッシュ戦略
1. **メモリキャッシュ**: 実行済みモジュールをメモリに保持
2. **ディスクキャッシュ**: トランスパイル済みコードをIndexedDBに永続化
3. **LRU GC**: 100MBを超えたら古いキャッシュから削除

### 最適化テクニック
- ファイル存在チェックのキャッシュ
- package.jsonのキャッシュ
- 循環参照の早期検出
- 非同期I/Oのバッチ化（将来実装）

---

## トラブルシューティング

### Q: モジュールが見つからない
```
Cannot find module 'xxx'
```

**チェック項目**:
1. ファイルがIndexedDBに存在するか確認
2. パスが正しいか確認（相対パス、絶対パス）
3. npm installが完了しているか確認
4. package.jsonのmain/moduleフィールドが正しいか確認

---

### Q: 循環参照エラー
```
⚠️ Circular dependency detected: /src/a.js
```

**対処法**:
これは警告であり、エラーではありません。Node.jsと同様に部分的にロード済みのexportsを返します。ただし、設計を見直すことを推奨します。

---

### Q: TypeScriptファイルが実行できない
```
⚠️ TypeScript is not fully supported yet
```

**現状**:
型アノテーションの簡易削除のみ対応しています。複雑なTypeScript構文は未対応です。

**回避策**:
1. JavaScriptにトランスパイルしてから実行
2. 将来のSWC wasm対応を待つ

---

## 設計思想

### 1. IndexedDBを唯一の真実の源とする
すべてのファイル読み込みはfileRepositoryを経由し、IndexedDBから取得します。GitFileSystemへの同期はバックグラウンドで自動的に行われます。

### 2. 後方互換性は無視
破壊的変更を許容し、より堅牢で保守性の高い設計を優先します。

### 3. メモリ効率を重視
LRU GCにより、常時一定のメモリフットプリント（±数MB）を維持します。

### 4. 段階的な機能追加
基本的な機能から実装し、徐々に高度な機能を追加していきます。

---

## 今後の拡張予定

1. ✅ **SWC wasm統合**: 本格的なTypeScript/JSXサポート【完了！】
2. ✅ **Web Worker化**: 重い処理をWorkerに移動【完了！】
3. **Source Map統合**: デバッグ体験の向上（SWC対応済み、統合待ち）
4. **Workerプール**: 並列トランスパイルによる高速化
5. **Hot Module Replacement**: 開発効率の向上
6. **プラグインシステム**: カスタムトランスパイラのサポート
7. **キャッシュ最適化**: より賢いキャッシュ戦略

---

**最終更新**: 2025-10-04  
**バージョン**: 2.0 (新アーキテクチャ)
