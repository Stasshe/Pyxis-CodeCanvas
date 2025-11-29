# Node.js Runtime - Browser-Based JavaScript Execution Environment

Pyxis CodeCanvas の Node.js Runtime は、完全にブラウザ内で動作する Node.js 互換の実行環境です。IndexedDB をストレージとして使い、依存関係の事前ロードによる同期的な`require()`、Web Worker による非同期トランスパイル、そして依存グラフを管理するキャッシュシステムを備えています。

---

## System Overview

### Design Goals

1. **Complete Browser Execution**: サーバーを必要とせず、すべてクライアント側で実行
2. **Node.js Compatibility**: CommonJS の require、npm パッケージ、組み込みモジュールの互換性
3. **High Performance**: 依存関係の事前ロードと同期実行による高速化
4. **Smart Caching**: 変更検出と依存グラフによる効率的なキャッシュ管理
5. **Extensibility**: 拡張機能によるトランスパイラのカスタマイズ

### Key Features

- **Synchronous require()**: 依存関係を事前ロードすることで、従来の Node.js と同じ同期的な`require()`を実現
- **Pre-loading Strategy**: エントリーファイル実行前に全依存関係を再帰的にロード
- **Smart Cache Invalidation**: ファイル内容のハッシュによる変更検出と、依存グラフに基づく自動無効化
- **Extension-based Transpilation**: TypeScript/JSX は拡張機能が担当、コアは CJS/ESM 変換のみ
- **npm Packages Support**: node_modules 内のパッケージを完全にサポート
- **Built-in Modules**: `fs`、`path`、`http`、`readline`などを提供

---

## Overall Architecture

```mermaid
graph TB
    User[User Code Execution Request]
    Runtime[NodeRuntime]
    Loader[ModuleLoader]
    
    subgraph PreloadPhase[Pre-loading Phase]
        Entry[Entry File]
        PreloadDeps[preloadDependencies]
        RecursiveLoad[Recursive Load All Dependencies]
        ExecCache[executionCache Population]
    end
    
    subgraph ExecutionPhase[Execution Phase]
        SyncRequire[Synchronous require]
        CacheLookup[executionCache Lookup]
        InstantReturn[Instant Return]
    end
    
    subgraph Resolution[Module Resolution System]
        Resolver[ModuleResolver]
        BuiltinCheck[Built-in Module Check]
        PathResolve[Path Resolution]
        PackageJSON[package.json Parser]
    end
    
    subgraph TranspileSystem[Transpile System]
        Manager[TranspileManager]
        Worker[Web Worker]
        Normalize[normalizeCjsEsm]
        Extension[Extension Transpiler]
    end
    
    subgraph CacheSystem[Smart Cache System]
        ModuleCache[ModuleCache]
        ContentHash[Content Hash Detection]
        DepGraph[Dependency Graph]
        AutoInvalidate[Auto Invalidation]
    end
    
    subgraph Storage[Storage Layer]
        FileRepo[fileRepository]
        IDB[(IndexedDB)]
    end
    
    User --> Runtime
    Runtime --> Loader
    Loader --> PreloadDeps
    PreloadDeps --> Entry
    Entry --> RecursiveLoad
    RecursiveLoad --> ExecCache
    
    ExecCache --> SyncRequire
    SyncRequire --> CacheLookup
    CacheLookup --> InstantReturn
    
    Loader --> Resolver
    Resolver --> BuiltinCheck
    Resolver --> PathResolve
    PathResolve --> PackageJSON
    
    RecursiveLoad --> ModuleCache
    ModuleCache --> ContentHash
    ContentHash --> DepGraph
    DepGraph --> AutoInvalidate
    
    ModuleCache -->|MISS| Manager
    Manager --> Worker
    Worker --> Normalize
    Worker --> Extension
    
    Loader --> FileRepo
    FileRepo --> IDB
    ModuleCache --> IDB
```

---

## Core Component Details

### 1. NodeRuntime

システムのエントリーポイント。依存関係の事前ロードとファイル実行を管理します。

#### Primary Responsibilities

- 依存関係の事前ロード（`preloadDependencies`）
- サンドボックス環境の構築
- グローバルオブジェクトの注入
- 組み込みモジュールの提供
- 同期的な`require()`関数の作成

#### Processing Flow

```mermaid
sequenceDiagram
    participant User
    participant Runtime as NodeRuntime
    participant FS as fs Module
    participant Loader as ModuleLoader
    participant FileRepo as fileRepository
    
    User->>Runtime: execute filePath
    Runtime->>FS: preloadFiles
    Note over FS: Cache ALL files for fs.readFileSync
    FS-->>Runtime: Files Cached
    
    Runtime->>Loader: init
    Loader-->>Runtime: Initialized
    
    Runtime->>Loader: preloadDependencies
    Note over Loader: Recursively load ALL dependencies
    Loader->>FileRepo: Read Dependencies
    Loader->>Loader: Transpile & Execute Each Dependency
    Loader-->>Runtime: All Dependencies Loaded
    
    Runtime->>FileRepo: readFile entryFile
    FileRepo-->>Runtime: Entry File Content
    
    Runtime->>Loader: getTranspiledCodeWithDeps
    Loader-->>Runtime: Transpiled Code
    
    Runtime->>Runtime: createSandbox with sync require
    Runtime->>Runtime: wrapCode
    Runtime->>Runtime: Execute Synchronously
    
    Runtime-->>User: Execution Complete
```

#### Sandbox Environment Components

| Element | Description |
|---------|-------------|
| `console` | デバッグコンソールまたはランタイムロガーへのプロキシ |
| `setTimeout` / `setInterval` | イベントループ追跡機能付きタイマー API |
| `Promise` / `Array` / `Object` | JavaScript の組み込みオブジェクト |
| `global` | グローバルオブジェクト参照 |
| `process` | Node.js の `process` オブジェクトのエミュレーション |
| `Buffer` | バイナリデータ操作用のクラス |
| `require` | **同期的な**モジュール読み込み関数 |

#### Synchronous require() Implementation

依存関係を事前にロードすることで、従来の Node.js と同じ同期的な`require()`を実現しています。

**主な特徴**:
- すべての依存関係は`preloadDependencies()`で事前に`executionCache`にロード済み
- `require()`は`executionCache`から同期的に取得するだけ
- ビルトインモジュールは`builtinResolver`で即座に解決
- モジュール名解決には`moduleNameMap`を使用（npm パッケージの高速解決）

**解決の優先順位**:
1. ビルトインモジュール（`fs`, `path`など）→ 即座に返す
2. `moduleNameMap`をチェック（npm パッケージ名 → パス）
3. 相対パス/絶対パス/エイリアスを解決
4. `executionCache`から exports を取得
5. 見つからない場合はエラー（事前ロードされていない）

**サポートされる利用例**:
```javascript
const fs = require('fs'); // 同期的に動作
const lodash = require('lodash'); // npm パッケージも同期
const utils = require('./utils'); // 相対パスも同期
```

---

### 2. ModuleLoader

モジュールのロードとライフサイクル管理を担当するコアコンポーネント。

#### Primary Responsibilities

- モジュール解決の調整
- 依存関係の事前ロード（`preloadDependencies`）
- トランスパイル処理の管理
- 実行キャッシュの管理
- `moduleNameMap`の構築（npm パッケージ名のマッピング）
- 循環依存の検出とハンドリング

#### Pre-loading Strategy

```mermaid
graph TB
    Entry[Entry File]
    GetDeps[getTranspiledCodeWithDeps]
    ExtractDeps[Extract Dependencies]
    CheckBuiltin{Built-in?}
    Skip[Skip Built-in]
    RecursiveLoad[Recursive load]
    Execute[executeModule]
    Cache[Store in executionCache]
    
    Entry --> GetDeps
    GetDeps --> ExtractDeps
    ExtractDeps --> CheckBuiltin
    CheckBuiltin -->|YES| Skip
    CheckBuiltin -->|NO| RecursiveLoad
    RecursiveLoad --> Execute
    Execute --> Cache
    Cache --> ExtractDeps
```

**重要なポイント**:
- エントリーファイル自体は`preloadDependencies()`では実行しない
- 依存関係のみを再帰的にロード・実行する
- ビルトインモジュールはスキップする
- すべての依存関係が`executionCache`に格納される
- npm パッケージは`moduleNameMap`に登録される

#### Execution Cache Structure

| Field | Type | Description |
|-------|------|-------------|
| `exports` | unknown | モジュールの exports オブジェクト |
| `loaded` | boolean | 読み込み完了フラグ |
| `loading` | boolean | 循環依存検出用の読み込み中フラグ |

#### moduleNameMap

npm パッケージ名 → 解決済みパスのマッピング:

```typescript
// Example:
// "lodash" → "/projects/my-app/node_modules/lodash/lodash.js"
// "chalk" → "/projects/my-app/node_modules/chalk/source/index.js"

this.moduleNameMap[moduleName] = resolvedPath;
```

**用途**: `require('lodash')` のような短い名前から即座にフルパスを解決

---

### 3. ModuleCache

変更検出機能と依存グラフを備えた永続キャッシュシステム。

#### Primary Responsibilities

- トランスパイル結果の保存
- ファイル内容のハッシュによる変更検出
- 依存グラフの双方向管理
- 変更時の自動キャッシュ無効化
- LRU 戦略による自動 GC

#### Cache Strategy Overview

```mermaid
graph TB
    Request[Module Request]
    GetCache[cache.get with contentHash]
    CheckHash{Hash Match?}
    
    Valid[Return Cached Code]
    Invalid[Invalidate Cache]
    Transpile[Transpile & Cache]
    
    Request --> GetCache
    GetCache --> CheckHash
    CheckHash -->|YES| Valid
    CheckHash -->|NO| Invalid
    Invalid --> Transpile
```

**キャッシュキー**: ファイルパスのみ（内容ハッシュは含まない）  
**変更検出**: `contentHash` フィールドで現在の内容と比較

#### Cache Entry Structure

```typescript
interface CacheEntry {
  originalPath: string;      // 元のファイルパス
  contentHash: string;        // ファイル内容のハッシュ (変更検出用)
  code: string;               // トランスパイル済みコード
  sourceMap?: string;         // ソースマップ (将来実装)
  deps: string[];             // このファイルが依存しているファイル
  dependents: string[];       // このファイルに依存しているファイル (逆参照)
  mtime: number;              // 保存時刻
  lastAccess: number;         // 最終アクセス時刻
  size: number;               // コードサイズ (bytes)
}
```

#### Bidirectional Dependency Graph

依存関係を双方向で管理:

```mermaid
graph LR
    A[a.js] -->|deps| B[b.js]
    B -->|dependents| A
    
    B -->|deps| C[c.js]
    C -->|dependents| B
    
    A -->|deps| C
    C -->|dependents| A
```

**変更時の処理**:
1. 変更されたファイル自体のキャッシュを削除
2. `dependents` を辿り、依存する全ファイルのキャッシュも再帰的に無効化
3. 変更されていない依存ファイルはキャッシュ利用可能

#### Content Hash Calculation

```typescript
hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
```

32-bit ローリングハッシュを base-36 文字列に変換。

#### Cache Invalidation Flow

```mermaid
sequenceDiagram
    participant User
    participant Cache as ModuleCache
    participant DepGraph as Dependency Graph
    
    User->>Cache: File a.js changed
    Cache->>Cache: get entry for a.js
    Cache->>Cache: contentHash mismatch detected
    
    Note over Cache: Invalidate a.js
    Cache->>DepGraph: Get dependents of a.js
    DepGraph-->>Cache: [b.js, c.js]
    
    Note over Cache: Recursive invalidation
    Cache->>Cache: invalidate b.js
    Cache->>Cache: invalidate c.js
    
    Cache->>Cache: Remove from memory
    Cache->>Cache: Delete from disk
    
    Cache-->>User: Cache invalidated
```

#### Disk Persistence

IndexedDB のディレクトリ構成:

```
/cache/
  ├── modules/
  │     ├── _src_app.tsx.js
  │     ├── _src_utils.ts.js
  │     └── ...
  └── meta/
        ├── _src_app.tsx.json
        ├── _src_utils.ts.json
        └── ...
```

**ファイル名変換**: `/src/app.tsx` → `_src_app.tsx`  
**メタファイル**: キャッシュエントリ全体を JSON 保存

#### GC Strategy

```mermaid
graph TB
    Check{Total Size > 100MB?}
    Sort[Sort by lastAccess]
    Delete[Delete from Oldest]
    Target{Size < 70MB?}
    Complete[GC Complete]
    
    Check -->|YES| Sort
    Check -->|NO| Complete
    Sort --> Delete
    Delete --> Target
    Target -->|NO| Delete
    Target -->|YES| Complete
```

**実行条件**: キャッシュ合計サイズが 100MB を超えたとき  
**削減目標**: LRU で 70MB まで削減

---

### 3. ModuleResolver

Node.js 互換のモジュールパス解決システム。

#### Primary Responsibilities

- 組み込みモジュールの検出
- 相対パスの解決
- `node_modules` の検索
- `package.json` の解析
- `exports` フィールドのサポート
- `imports` フィールドのサポート（`#`で始まるパス）

#### Resolution Priority

```mermaid
graph TB
    Start[Module Name Input]
    BuiltIn{Built-in?}
    PackageImports{Starts with hash?}
    Absolute{Absolute Path?}
    Relative{Relative Path?}
    Alias{Starts with at slash?}
    NodeMods[node_modules Search]
    
    BuiltInReturn[Return Built-in Marker]
    ImportsResolve[Resolve package.json imports]
    AbsoluteResolve[Add Extension If Needed]
    RelativeResolve[Resolve Relative Path]
    AliasResolve[Resolve Alias]
    PkgJSON[Parse package.json]
    
    Start --> BuiltIn
    BuiltIn -->|YES| BuiltInReturn
    BuiltIn -->|NO| PackageImports
    PackageImports -->|YES| ImportsResolve
    PackageImports -->|NO| Absolute
    Absolute -->|YES| AbsoluteResolve
    Absolute -->|NO| Relative
    Relative -->|YES| RelativeResolve
    Relative -->|NO| Alias
    Alias -->|YES| AliasResolve
    Alias -->|NO| NodeMods
    NodeMods --> PkgJSON
```

#### Built-in Modules List

`fs`, `fs/promises`, `path`, `os`, `util`, `http`, `https`, `buffer`, `readline`, `crypto`, `stream`, `events`, `url`, `querystring`, `assert`, `child_process`, `cluster`, `dgram`, `dns`, `domain`, `net`, `tls`, `tty`, `zlib`

#### Path Resolution Examples

| Input | Resolution Result |
|-------|-------------------|
| `fs` | 組み込みマーカーが返される |
| `./utils` | `/projects/my-app/src/utils.js` |
| `../config` | `/projects/my-app/config.ts` |
| `@/components/Button` | `/projects/my-app/src/components/Button.tsx` |
| `lodash` | `/projects/my-app/node_modules/lodash/lodash.js` |
| `@vue/runtime-core` | `/projects/my-app/node_modules/@vue/runtime-core/dist/runtime-core.esm-bundler.js` |
| `#internal/utils` | `package.json` の `imports` フィールドから解決される |

#### package.json Parsing Logic

エントリポイント決定の優先順位:

1. `module` フィールド — ES モジュール版を優先
2. `main` フィールド — CommonJS 版
3. `exports` フィールド — 条件付きエクスポート対応
4. `index.js` — フォールバック

#### Extension Completion

ファイルパスに拡張子がない場合、次の順で試します:

1. そのままのパスで存在チェック（拡張子なしのスクリプト用、例: bin/cowsay）
2. `.js`, `.mjs`, `.ts`, `.mts`, `.tsx`, `.jsx`, `.json`
3. `/index.js`, `/index.mjs`, `/index.ts`, `/index.mts`, `/index.tsx`

---

### 4. TranspileManager & Web Worker

高速トランスパイルシステム。

#### Primary Responsibilities

- Web Worker の作成と管理
- トランスパイルリクエストの処理
- タイムアウト管理（10 秒）
- 自動メモリ管理

#### Worker Processing Flow

```mermaid
sequenceDiagram
    participant Main as Main Thread
    participant Manager as TranspileManager
    participant Worker as Web Worker
    participant Normalize as normalizeCjsEsm
    
    Main->>Manager: transpile code options
    Manager->>Worker: new Worker
    
    Manager->>Worker: postMessage request
    Note over Manager: Set 10s timeout
    
    Worker->>Normalize: normalizeCjsEsm code
    Note over Normalize: Extract dependencies
    Note over Normalize: Transform import/export/require
    Normalize-->>Worker: code and dependencies array
    
    Worker->>Manager: postMessage result
    Worker->>Worker: self.close
    Note over Worker: Immediate Memory Release
    
    Manager-->>Main: TranspileResult code dependencies
```

#### normalizeCjsEsm Transform

**役割**: 正規表現ベースの軽量な CJS/ESM 変換と依存関係の抽出

**import 文の変換例**

- `import foo from 'bar'` → `const foo = (tmp => tmp && tmp.default !== undefined ? tmp.default : tmp)(require('bar'))`
- `import { named } from 'bar'` → `const { named } = require('bar')`
- `import * as ns from 'bar'` → `const ns = require('bar')`
- `import 'bar'` → `require('bar')`

**export 文の変換例**

- `export default foo` → `module.exports.default = foo`
- `export const bar = 1` → `const bar = 1; module.exports.bar = bar;`
- `export { baz }` → `module.exports.baz = baz`
- `export { a as b }` → `module.exports.b = a;`

**require 呼び出し**

- `require('foo')` → そのまま（同期的に動作）

**依存関係の抽出**

- すべての`import`、`require`、動的`import()`から依存関係を抽出
- 重複を除去してユニークなリストを返す
- `{ code: string, dependencies: string[] }`の形式で返す

#### Extension Transpiler Integration

TypeScript/JSX のトランスパイルは拡張機能の責任です:

```mermaid
graph TB
    Loader[ModuleLoader]
    CheckTS{TypeScript or JSX?}
    Extension[Extension Transpiler]
    Core[Core normalizeCjsEsm]
    Result[code and dependencies]
    
    Loader --> CheckTS
    CheckTS -->|YES| Extension
    CheckTS -->|NO| Core
    Extension --> Result
    Core --> Result
```

拡張機能の例（`extensions/typescript-runtime`）:
- TypeScript の型情報を削除
- JSX を React 関数呼び出しに変換
- 依存関係を抽出
- `{ code: string, map?: string, dependencies?: string[] }`を返す

#### Memory Management Strategy

- トランスパイル完了後に `self.close()` を呼んで Worker を終了させる
- Worker のヒープは即座に解放される
- メインスレッドのメモリへ影響は与えない
- 各リクエストごとに新しい Worker を生成する

---

### 5. ModuleCache

トランスパイル結果の永続キャッシュシステム。

#### Primary Responsibilities

- トランスパイル結果の保存
- 内容ハッシュによる変更検出
- 依存グラフの双方向管理
- ファイル変更時の自動無効化
- LRU 戦略による自動 GC
- IndexedDB への永続化

#### Cache Structure

IndexedDB のディレクトリ構成:

```
/cache/
    ├── modules/
    │     ├── _src_app_tsx.js
    │     ├── _src_utils_ts.js
    │     └── ...
    └── meta/
          ├── _src_app_tsx.json
          ├── _src_utils_ts.json
          └── ...
```

#### Cache Entry Format

| Field | Type | Description |
|-------|------|-------------|
| `originalPath` | string | 元のファイルパス |
| `contentHash` | string | ファイル内容のハッシュ（変更検出用） |
| `code` | string | トランスパイル済みコード |
| `sourceMap` | string | ソースマップ（オプション） |
| `deps` | string[] | このファイルが依存しているファイル一覧 |
| `dependents` | string[] | このファイルに依存しているファイル一覧（逆参照） |
| `mtime` | number | トランスフォームのタイムスタンプ |
| `lastAccess` | number | 最終アクセスのタイムスタンプ |
| `size` | number | コードのバイトサイズ |

#### Smart Invalidation Strategy

```mermaid
graph TB
    FileChange[File Changed]
    ComputeHash[Compute Content Hash]
    Compare{Hash Changed?}
    NoOp[No Action]
    Invalidate[invalidate file]
    GetDependents[Get dependents array]
    RecursiveInvalidate[Recursively invalidate each dependent]
    DeleteCache[Delete from cache and disk]
    RemoveLinks[Remove dependency graph links]
    
    FileChange --> ComputeHash
    ComputeHash --> Compare
    Compare -->|NO| NoOp
    Compare -->|YES| Invalidate
    Invalidate --> GetDependents
    GetDependents --> RecursiveInvalidate
    RecursiveInvalidate --> DeleteCache
    DeleteCache --> RemoveLinks
```

**重要なポイント**:
- ファイル内容のハッシュで変更を検出
- 変更されたファイルのキャッシュを削除
- そのファイルに依存するすべてのファイルも再帰的に無効化
- 依存グラフの双方向リンク（`deps`と`dependents`）を維持
- 変更されていない依存ファイルはキャッシュ利用可能

#### GC Strategy

```mermaid
graph TB
    Check{Total Size over 100MB?}
    Sort[Sort by lastAccess]
    Delete[Delete from Oldest]
    Target{Size under 70MB?}
    Complete[GC Complete]
    
    Check -->|YES| Sort
    Check -->|NO| Complete
    Sort --> Delete
    Delete --> Target
    Target -->|NO| Delete
    Target -->|YES| Complete
```

**GC 実行条件**: キャッシュ合計サイズが 100MB を超えたとき  
**削減目標**: 最終アクセスが古いものから削除して 70MB まで減らす

---

## Data Flow Details

### Complete Module Loading Flow

```mermaid
sequenceDiagram
    participant User
    participant Runtime as NodeRuntime
    participant FS as fs Module
    participant Loader as ModuleLoader
    participant Cache as ModuleCache
    participant Manager as TranspileManager
    participant FileRepo as fileRepository
    
    User->>Runtime: execute index.js
    Runtime->>FS: preloadFiles
    FS->>FileRepo: Load ALL files
    FileRepo-->>FS: All Files Cached
    
    Runtime->>Loader: init
    Loader->>Cache: init and load from disk
    Cache-->>Loader: Cache Ready
    
    Runtime->>Loader: preloadDependencies index.js
    
    Loader->>FileRepo: readFile index.js
    FileRepo-->>Loader: File Content
    
    Loader->>Loader: getTranspiledCodeWithDeps
    Loader->>Cache: get with contentHash
    
    alt Cache HIT
        Cache-->>Loader: code and deps
    else Cache MISS
        Loader->>Manager: transpile
        Manager-->>Loader: code and deps
        Loader->>Cache: set with deps
    end
    
    Note over Loader: Extract dependencies array
    
    loop For Each Dependency
        Loader->>Loader: Check if built-in
        alt Not Built-in
            Loader->>Loader: Recursive load dependency
            Loader->>Loader: executeModule
            Loader->>Loader: Store in executionCache
            Loader->>Loader: Register in moduleNameMap
        end
    end
    
    Loader-->>Runtime: All Dependencies Loaded
    
    Runtime->>FileRepo: readFile index.js
    FileRepo-->>Runtime: Entry File Content
    
    Runtime->>Loader: getTranspiledCodeWithDeps
    Loader-->>Runtime: Transpiled Code
    
    Runtime->>Runtime: Execute Entry File
    
    Note over Runtime: Code calls require lodash
    
    Runtime->>Runtime: Check moduleNameMap
    Runtime->>Runtime: Get from executionCache
    Runtime-->>Runtime: Return Synchronously
    
    Runtime-->>User: Execution Complete
```

### Transpile Detail Flow

#### Step 1: Language Detection

入力: ファイルパスとコード内容

判定基準:

1. 拡張子が `.ts`, `.tsx`, `.mts`, `.cts` → TypeScript（拡張機能が処理）
2. 拡張子が `.jsx`, `.tsx` → JSX（拡張機能が処理）
3. 拡張子が `.mjs` → ESM（常にトランスパイル）
4. コードに `import` / `export` を含む → ESM
5. コードに `require()` を含む → CJS

#### Step 2: Transpiler Selection

```mermaid
graph TB
    Input[File Info]
    CheckTSorJSX{TypeScript or JSX?}
    FindExtension[Find Active Extension]
    ExtensionTranspile[Extension Transpiler]
    CoreTranspile[Core normalizeCjsEsm]
    Result[code and dependencies]
    
    Input --> CheckTSorJSX
    CheckTSorJSX -->|YES| FindExtension
    CheckTSorJSX -->|NO| CoreTranspile
    FindExtension --> ExtensionTranspile
    ExtensionTranspile --> Result
    CoreTranspile --> Result
```

#### Step 3: Transform and Extract

**拡張機能の処理**（TypeScript/JSX の場合）:
1. TypeScript の型情報を削除
2. JSX を React 関数呼び出しに変換
3. import/export を抽出（依存関係として）
4. `{ code, map?, dependencies? }`を返す

**コアの処理**（通常の JS の場合）:
1. `normalizeCjsEsm`で import/export/require を変換
2. 依存関係を抽出
3. `{ code, dependencies }`を返す

#### Step 4: Cache Save

メモリとディスクの両方に保存:

- メモリ: 即時アクセス用の Map 構造
- ディスク: IndexedDB（次回起動時に有効）
- 依存グラフ: `deps`と`dependents`を双方向に更新

---

## Performance Characteristics

### First Execution Timing

| Phase | Time | Description |
|-------|------|-------------|
| File Pre-loading (fs) | ~10-20ms | すべてのファイルをメモリキャッシュ |
| Dependency Pre-loading | ~100-200ms | 依存関係の再帰的ロードと実行 |
| Entry File Transpilation | ~50-100ms | エントリーファイルのトランスパイル |
| Entry File Execution | ~5-10ms | エントリーファイルの同期実行 |
| **Total** | **~165-330ms** | 初回のみの目安 |

### Second and Later (Cache HIT)

| Phase | Time | Description |
|-------|------|-------------|
| File Pre-loading (fs) | ~10-20ms | ファイルキャッシュロード |
| Dependency Pre-loading | ~20-40ms | キャッシュから高速ロード |
| Entry File Cache Load | ~1-5ms | メモリからの取得 |
| Entry File Execution | ~5-10ms | 同期実行 |
| **Total** | **~36-75ms** | **約 5 倍高速** |

### Memory Footprint

```mermaid
graph LR
    Init[Startup: 10MB]
    FSCache[File Cache: +20MB]
    ExecCache[Execution Cache: +10MB]
    TransCache[Transpile Cache: +30MB]
    Peak[Peak: 100MB]
    GC[GC Triggered]
    Stable[Stable: 50-70MB]
    
    Init --> FSCache
    FSCache --> ExecCache
    ExecCache --> TransCache
    TransCache --> Peak
    Peak --> GC
    GC --> Stable
    Stable --> Peak
```

**メモリ使用量**: LRU GC により概ね 50-70MB に落ち着く

---

## Built-in Modules

### Support Status

| Module | Implementation | Description |
|--------|----------------|-------------|
| `fs` | ✅ | fileRepository を通したファイル操作、`preloadFiles`によるメモリキャッシュ |
| `fs/promises` | ✅ | Promise ベースの FS API |
| `path` | ✅ | パス操作ユーティリティ |
| `os` | ✅ | OS 情報のエミュレーション |
| `util` | ✅ | ユーティリティ関数群 |
| `http` | ✅ | fetch をラップした HTTP 通信 |
| `https` | ✅ | HTTPS 通信 |
| `buffer` | ✅ | Buffer クラス |
| `readline` | ✅ | 対話入力のサポート |
| `assert` | ✅ | アサーション関数 |
| `events` | ✅ | EventEmitter クラス |
| `module` | ✅ | Module オブジェクト |
| `url` | ✅ | URL パース |
| `stream` | ✅ | Stream クラス |

### fs Module Implementation Features

**設計方針**: IndexedDB を単一の真実のソース（single source of truth）として利用し、`preloadFiles`でメモリキャッシュを構築

```mermaid
graph TB
    Startup[Startup]
    PreloadFiles[preloadFiles]
    IDB[(IndexedDB)]
    MemoryCache[Memory Cache]
    UserCode[User Code]
    ReadFileSync[readFileSync]
    InstantReturn[Instant Return]
    
    Startup --> PreloadFiles
    PreloadFiles --> IDB
    IDB --> MemoryCache
    UserCode --> ReadFileSync
    ReadFileSync --> MemoryCache
    MemoryCache --> InstantReturn
```

**重要なポイント**:
- `preloadFiles()`ですべてのファイルをメモリにキャッシュ
- `readFileSync()`は同期的にメモリキャッシュから読み取る
- IndexedDB は非同期だが、事前ロードにより同期的な API を実現
- 書き込みは IndexedDB に保存され、GitFS に自動同期

---

## References

### Related Documents

- [CORE-ENGINE.md](./CORE-ENGINE.md) - Core engine design
- [DATA-FLOW.md](./DATA-FLOW.md) - Overall data flow
- [SYSTEM-OVERVIEW.md](./SYSTEM-OVERVIEW.md) - System overview

### External Links

- [Babel Documentation](https://babeljs.io/docs/)
- [Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)
- [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [Node.js Built-in Modules](https://nodejs.org/api/)

---

**Last Updated**: 2025-01-06  
**Version**: 5.0  
**Status**: ✅ Accurate documentation based on implementation
