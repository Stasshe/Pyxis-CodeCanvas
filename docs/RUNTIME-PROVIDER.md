# Runtime Provider Architecture

## 概要

Pyxisの新しいランタイムアーキテクチャは、拡張可能で体系的な設計を提供します。このドキュメントでは、RuntimeProviderシステムの設計、使用方法、および拡張方法について説明します。

## 設計原則

1. **拡張性**: 新しいランタイムを拡張機能として追加可能
2. **体系的**: 明確なインターフェースと責任分離
3. **メモリリーク防止**: キャッシュ戦略とクリーンアップの適切な実装
4. **型安全性**: 完全なTypeScriptサポート
5. **後方互換性**: 既存コードとの互換性を維持

## アーキテクチャ

### コアコンポーネント

```
┌─────────────────────────────────────────┐
│         Runtime Architecture            │
├─────────────────────────────────────────┤
│                                         │
│  ┌───────────────────────────────┐     │
│  │    RuntimeProvider            │     │
│  │  - id: string                 │     │
│  │  - name: string               │     │
│  │  - supportedExtensions        │     │
│  │  - execute()                  │     │
│  │  - executeCode()              │     │
│  └───────────────────────────────┘     │
│            ▲                            │
│            │                            │
│  ┌─────────┴────────┬──────────────┐   │
│  │                  │              │   │
│  │  NodeRuntime     │  Python      │   │
│  │  Provider        │  Provider    │   │
│  │  (builtin)       │  (extension) │   │
│  └──────────────────┴──────────────┘   │
│                                         │
│  ┌───────────────────────────────┐     │
│  │   TranspilerProvider          │     │
│  │  - id: string                 │     │
│  │  - supportedExtensions        │     │
│  │  - needsTranspile()           │     │
│  │  - transpile()                │     │
│  └───────────────────────────────┘     │
│            ▲                            │
│            │                            │
│  ┌─────────┴─────────────────────┐     │
│  │  TypeScript Transpiler        │     │
│  │  (extension)                  │     │
│  └───────────────────────────────┘     │
│                                         │
│  ┌───────────────────────────────┐     │
│  │   RuntimeRegistry             │     │
│  │  - registerRuntime()          │     │
│  │  - registerTranspiler()       │     │
│  │  - getRuntimeForFile()        │     │
│  │  - getTranspilerForFile()     │     │
│  └───────────────────────────────┘     │
│                                         │
└─────────────────────────────────────────┘
```

### ファイル構成

```
src/engine/runtime/
├── RuntimeProvider.ts          # インターフェース定義
├── RuntimeRegistry.ts          # レジストリ実装
├── builtinRuntimes.ts         # ビルトインランタイム初期化
├── providers/
│   ├── NodeRuntimeProvider.ts       # Node.jsランタイム
│   └── ExtensionTranspilerProvider.ts # 拡張機能トランスパイラーラッパー
├── nodeRuntime.ts             # 既存のNode.jsランタイム実装
├── moduleLoader.ts            # モジュールローダー（更新済み）
└── transpileManager.ts        # トランスパイルマネージャー
```

## RuntimeProvider インターフェース

### 基本構造

```typescript
export interface RuntimeProvider {
  // 識別子（例: "nodejs", "python"）
  readonly id: string;
  
  // 表示名（例: "Node.js", "Python"）
  readonly name: string;
  
  // サポートするファイル拡張子
  readonly supportedExtensions: string[];
  
  // ファイルが実行可能か判定
  canExecute(filePath: string): boolean;
  
  // ランタイムの初期化（オプション）
  initialize?(projectId: string, projectName: string): Promise<void>;
  
  // ファイルを実行
  execute(options: RuntimeExecutionOptions): Promise<RuntimeExecutionResult>;
  
  // コードスニペットを実行（REPLモード、オプション）
  executeCode?(code: string, options: RuntimeExecutionOptions): Promise<RuntimeExecutionResult>;
  
  // キャッシュをクリア（オプション）
  clearCache?(): void;
  
  // クリーンアップ（オプション）
  dispose?(): Promise<void>;
  
  // 準備完了状態（オプション）
  isReady?(): boolean;
}
```

### 実行オプション

```typescript
export interface RuntimeExecutionOptions {
  projectId: string;
  projectName: string;
  filePath: string;
  argv?: string[];
  debugConsole?: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    clear: () => void;
  };
  onInput?: (prompt: string, callback: (input: string) => void) => void;
  terminalColumns?: number;
  terminalRows?: number;
}
```

### 実行結果

```typescript
export interface RuntimeExecutionResult {
  stdout?: string;
  stderr?: string;
  result?: unknown;
  exitCode?: number;
}
```

## TranspilerProvider インターフェース

```typescript
export interface TranspilerProvider {
  readonly id: string;
  readonly supportedExtensions: string[];
  
  needsTranspile(filePath: string, content?: string): boolean;
  
  transpile(code: string, options: {
    filePath: string;
    isTypeScript?: boolean;
    isESModule?: boolean;
    isJSX?: boolean;
  }): Promise<{
    code: string;
    map?: string;
    dependencies?: string[];
  }>;
}
```

## RuntimeRegistry

RuntimeRegistryは、すべてのランタイムプロバイダーとトランスパイラープロバイダーを管理するシングルトンです。

### 主要メソッド

```typescript
// ランタイムプロバイダーを登録
registerRuntime(provider: RuntimeProvider): void

// トランスパイラープロバイダーを登録
registerTranspiler(provider: TranspilerProvider): void

// ファイルパスからランタイムを取得
getRuntimeForFile(filePath: string): RuntimeProvider | null

// ファイルパスからトランスパイラーを取得
getTranspilerForFile(filePath: string): TranspilerProvider | null

// IDでランタイムを取得
getRuntime(id: string): RuntimeProvider | null

// IDでトランスパイラーを取得
getTranspiler(id: string): TranspilerProvider | null

// すべてのランタイムを取得
getAllRuntimes(): RuntimeProvider[]

// すべてのトランスパイラーを取得
getAllTranspilers(): TranspilerProvider[]
```

## 使用例

### ビルトインランタイム（Node.js）

Node.jsランタイムは常にビルトインとして利用可能です：

```typescript
import { runtimeRegistry } from '@/engine/runtime/RuntimeRegistry';

// Node.jsランタイムを取得
const nodeRuntime = runtimeRegistry.getRuntime('nodejs');

// ファイルを実行
if (nodeRuntime) {
  await nodeRuntime.execute({
    projectId: 'my-project',
    projectName: 'my-project',
    filePath: '/index.js',
    debugConsole: {
      log: console.log,
      error: console.error,
      warn: console.warn,
      clear: () => {},
    },
  });
}
```

### 拡張機能でトランスパイラーを登録

TypeScript拡張機能の例：

```typescript
export async function activate(context: ExtensionContext) {
  // トランスパイラーを登録
  await context.registerTranspiler?.({
    id: 'typescript',
    supportedExtensions: ['.ts', '.tsx', '.mts', '.cts', '.jsx'],
    needsTranspile: (filePath: string) => {
      return /\.(ts|tsx|mts|cts|jsx)$/.test(filePath);
    },
    transpile: async (code: string, options: any) => {
      // Babel standaloneなどでトランスパイル
      const result = await transpileWithBabel(code, options);
      return {
        code: result.code,
        map: result.map,
        dependencies: extractDependencies(result.code),
      };
    },
  });

  return { runtimeFeatures: { /* ... */ } };
}
```

### 拡張機能でランタイムを登録（将来の拡張）

Pythonランタイムを拡張機能として実装する例：

```typescript
import type { RuntimeProvider } from '@/engine/runtime/RuntimeProvider';

export class PythonRuntimeProvider implements RuntimeProvider {
  readonly id = 'python';
  readonly name = 'Python';
  readonly supportedExtensions = ['.py'];

  canExecute(filePath: string): boolean {
    return filePath.endsWith('.py');
  }

  async initialize(projectId: string, projectName: string): Promise<void> {
    // Pyodideの初期化
    await initPyodide();
    await setCurrentProject(projectId, projectName);
  }

  async execute(options: RuntimeExecutionOptions): Promise<RuntimeExecutionResult> {
    // Pythonコードの実行
    const result = await runPythonWithSync(code, options.projectId);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      result: result.result,
      exitCode: result.stderr ? 1 : 0,
    };
  }

  // ... その他のメソッド
}

export async function activate(context: ExtensionContext) {
  // Pythonランタイムを登録
  const pythonProvider = new PythonRuntimeProvider();
  
  // 将来的にcontext.registerRuntime が追加される予定
  // await context.registerRuntime?.(pythonProvider);
  
  return {};
}
```

## ModuleLoaderとの統合

ModuleLoaderは自動的にRuntimeRegistryを使用してトランスパイラーを検索します：

```typescript
// moduleLoader.ts内
const transpiler = runtimeRegistry.getTranspilerForFile(filePath);
if (transpiler) {
  const result = await transpiler.transpile(content, {
    filePath,
    isTypeScript,
    isJSX,
  });
  // ...
}
```

## RunPanelとの統合

RunPanelは自動的にRuntimeRegistryを使用してランタイムを選択します：

```typescript
// RunPanel.tsx内
const runtime = runtimeRegistry.getRuntimeForFile(filePath);
if (runtime) {
  const result = await runtime.execute({
    projectId,
    projectName,
    filePath,
    debugConsole,
    onInput,
  });
  // ...
}
```

## メモリリーク防止

RuntimeProviderは以下の方法でメモリリークを防止します：

1. **キャッシュのクリア**: `clearCache()`メソッドの実装
2. **適切なクリーンアップ**: `dispose()`メソッドでリソース解放
3. **インスタンス管理**: 必要に応じてインスタンスを再作成
4. **イベントループ追跡**: タイマーなどの追跡と適切なクリーンアップ

例（NodeRuntimeProvider）：

```typescript
async execute(options: RuntimeExecutionOptions): Promise<RuntimeExecutionResult> {
  const key = `${projectId}-${filePath}`;
  
  // 既存のキャッシュはメモリリーク防止のためクリア
  if (this.runtimeInstances.has(key)) {
    const existing = this.runtimeInstances.get(key)!;
    existing.clearCache();
    this.runtimeInstances.delete(key);
  }

  // 新しいインスタンスを作成
  const runtime = new NodeRuntime(options);
  
  // 実行
  await runtime.execute(filePath, argv);
  await runtime.waitForEventLoop();
  
  return { exitCode: 0 };
}
```

## テスト

RuntimeRegistryのテストは`tests/runtimeRegistry.test.ts`にあります：

```typescript
describe('RuntimeRegistry', () => {
  test('should register a runtime provider', () => {
    const mockProvider: RuntimeProvider = {
      id: 'test-runtime',
      name: 'Test Runtime',
      supportedExtensions: ['.test'],
      canExecute: (filePath: string) => filePath.endsWith('.test'),
      execute: async () => ({ exitCode: 0 }),
    };

    registry.registerRuntime(mockProvider);
    const retrieved = registry.getRuntime('test-runtime');
    expect(retrieved).toBe(mockProvider);
  });
});
```

## ベストプラクティス

1. **ランタイムプロバイダーの実装**
   - 必須メソッドのみを実装し、オプションメソッドは必要に応じて追加
   - `canExecute()`で正確な判定を行う
   - `clearCache()`と`dispose()`でメモリリークを防止

2. **トランスパイラープロバイダーの実装**
   - `needsTranspile()`で正確な判定を行う
   - 依存関係を正確に抽出して返す
   - エラーハンドリングを適切に行う

3. **拡張機能の実装**
   - `context.registerTranspiler()`で早期に登録
   - エラー時は適切にログを出力
   - `deactivate()`でクリーンアップ（将来実装予定）

## まとめ

RuntimeProvider アーキテクチャは、Pyxisのランタイムシステムを拡張可能で体系的にします：

- ✅ **拡張性**: 新しいランタイムを拡張機能として追加可能
- ✅ **体系的**: 明確なインターフェースと責任分離
- ✅ **メモリリーク防止**: 既存のキャッシュ戦略を維持
- ✅ **型安全性**: 完全なTypeScriptサポート
- ✅ **後方互換性**: 既存コードとの互換性を維持

この設計により、開発者は新しいランタイムを簡単に追加でき、コアコードを変更することなく言語サポートを拡張できます。
