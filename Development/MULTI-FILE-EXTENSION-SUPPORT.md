# 複数ファイル拡張機能サポートの実装

## 概要

Pyxisの拡張機能システムに、複数ファイルに渡る拡張機能のサポートを追加しました。これにより、拡張機能を複数のモジュールに分割し、相対importを使用して互いに参照できるようになります。

## 実装内容

### 1. ビルドシステムの改善 (`build-extensions.js`)

#### 追加機能
- **自動ファイルリスト生成**: トランスパイル後、各拡張機能のディレクトリをスキャンし、エントリーポイント以外の`.js`ファイルを検出
- **Manifest自動更新**: 検出されたファイルを`files`配列として`manifest.json`に自動追加

#### 処理フロー
```
1. TypeScriptファイルをトランスパイル
2. manifest.jsonをコピー
3. 各拡張機能ディレクトリをスキャン
4. エントリーファイル以外の.jsファイルを検出
5. manifest.jsonのfilesフィールドを更新
```

#### 出力例
```json
{
  "id": "pyxis.test-multi-file",
  "entry": "index.js",
  "files": [
    "helper.js",
    "utils.js"
  ]
}
```

### 2. 拡張機能ローダーの拡張 (`extensionLoader.ts`)

#### 主要変更

**シグネチャ変更**:
```typescript
// Before
loadExtensionModule(entryCode: string, context: ExtensionContext)

// After
loadExtensionModule(
  entryCode: string,
  additionalFiles: Record<string, string>,
  context: ExtensionContext
)
```

#### Import Map戦略

追加ファイルごとにBlobURLを生成し、相対パスをマッピング:

```typescript
const importMap: Record<string, string> = {
  './helper.js': 'blob:http://localhost/abc123',
  './helper': 'blob:http://localhost/abc123',  // 拡張子なしも対応
  './utils.js': 'blob:http://localhost/def456',
  './utils': 'blob:http://localhost/def456'
};
```

#### 相対Import解決

エントリーコード内の相対importをBlobURLに書き換え:

```javascript
// Before transformation
import { helper } from './helper';

// After transformation
import { helper } from 'blob:http://localhost/abc123';
```

### 3. Extension Managerの更新 (`extensionManager.ts`)

追加ファイルをローダーに渡すように修正:

```typescript
const exports = await loadExtensionModule(
  installed.cache.entryCode,
  installed.cache.files || {},  // 追加ファイルを渡す
  context
);
```

## テストカバレッジ

### テストファイル: `extensionLoader.multifile.test.ts`

**36個のテストケース**を実装し、以下をカバー:

#### 1. transformImports関数
- React default import変換
- React named import変換
- React default + named import変換
- 複数のReact import
- 非React importの保持

#### 2. 相対Import解決
- `.js`拡張子付きimport
- 拡張子なしimport
- ネストしたディレクトリのimport
- 親ディレクトリへのimport
- 解決できないimportの処理

#### 3. Import Map構築
- 複数ファイルのマッピング
- 異なる拡張子 (`.js`, `.ts`, `.tsx`)
- ネストしたディレクトリ構造

#### 4. エッジケース
- 空のfilesオブジェクト
- 特殊文字を含むファイル名
- 1行に複数のimport
- default export
- 混合import (default + named)
- re-export
- 動的import
- node_modulesからのimport
- 改行を含むimport
- type-only import (トランスパイル後)
- 循環依存
- importなしのファイル
- exportのみのファイル
- コメント内のimport
- 文字列内のimport
- スペースを含むimport

#### 5. Manifest処理
- filesフィールドの処理
- 空のfiles配列
- filesフィールドなし
- ネストしたディレクトリのファイル

#### 6. 統合シナリオ
- 完全なマルチファイル拡張機能
- Reactコンポーネントを含む複数ファイル

### テスト結果
```
Test Suites: 1 passed, 1 total
Tests:       36 passed, 36 total
```

## 使用例

### 拡張機能の構造

```
extensions/
└── my-extension/
    ├── manifest.json
    ├── index.ts         # エントリーポイント
    ├── helper.ts        # ヘルパーモジュール
    └── utils.ts         # ユーティリティモジュール
```

### TypeScriptコード

**helper.ts**:
```typescript
export function helperFunction(): string {
  return "Hello from helper!";
}

export class HelperClass {
  constructor(private message: string) {}
  getMessage(): string {
    return `Helper says: ${this.message}`;
  }
}
```

**utils.ts**:
```typescript
export function add(a: number, b: number): number {
  return a + b;
}

export default {
  add,
  version: "1.0.0"
};
```

**index.ts**:
```typescript
import { helperFunction, HelperClass } from './helper';
import utils from './utils';

export function activate(context: ExtensionContext) {
  const result = helperFunction();
  const sum = utils.add(1, 2);
  
  return {
    services: {
      'my-service': { result, sum }
    }
  };
}
```

### ビルド後

**manifest.json** (自動更新):
```json
{
  "id": "pyxis.my-extension",
  "entry": "index.js",
  "files": [
    "helper.js",
    "utils.js"
  ]
}
```

**public/extensions/my-extension/**:
- `index.js` - トランスパイル済み
- `helper.js` - トランスパイル済み
- `utils.js` - トランスパイル済み
- `manifest.json` - filesフィールド付き

### 実行時の処理

1. **IndexedDBからロード**:
   - エントリーコード: `index.js`
   - 追加ファイル: `{ "helper.js": "...", "utils.js": "..." }`

2. **Import Map生成**:
   ```typescript
   {
     './helper.js': 'blob:...',
     './helper': 'blob:...',
     './utils.js': 'blob:...',
     './utils': 'blob:...'
   }
   ```

3. **Import書き換え**:
   ```javascript
   // Before
   import { helperFunction } from './helper';
   
   // After
   import { helperFunction } from 'blob:http://localhost/abc123';
   ```

4. **動的Import**:
   - 各ファイルをBlobURLとしてブラウザにロード
   - ES Moduleとして実行
   - 相対importが正しく解決される

## 制約と注意点

### サポート範囲

✅ **サポート**:
- 相対import (`./, ../`)
- 名前付きexport/import
- default export/import
- 混合import
- re-export
- ネストしたディレクトリ

❌ **未サポート**:
- 動的import (`import()`)
- CommonJS形式 (`require()`)
- Import assertions
- Import attributes

### パフォーマンス

- **BlobURL生成**: 各ファイルごとに1つ
- **メモリ使用**: 全ファイルがメモリにロード
- **クリーンアップ**: モジュールロード後、全BlobURLを自動解放

### セキュリティ

- **CSP互換**: BlobURLを使用しているため、strict CSPでも動作
- **スコープ分離**: 各拡張機能は独立したモジュールスコープ
- **コード検証**: IndexedDBからのコードのみ実行 (XSS対策)

## まとめ

この実装により、Pyxisの拡張機能システムは以下を実現しました:

1. **モジュール分割**: 拡張機能を複数のファイルに分割可能
2. **型安全性**: TypeScriptの型システムを活用
3. **自動化**: ビルド時の自動検出とmanifest更新
4. **ブラウザネイティブ**: ES Moduleを使用した標準準拠の実装
5. **包括的テスト**: 36個のテストケースでエッジケースまでカバー

これにより、より複雑で保守性の高い拡張機能の開発が可能になります。
