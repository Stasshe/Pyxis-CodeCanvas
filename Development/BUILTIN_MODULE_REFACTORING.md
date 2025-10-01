# Built-in Module Refactoring - 新アーキテクチャ対応

## 概要

`builtInModule.ts`を新アーキテクチャに対応させ、複数のモジュールファイルに分割しました。

## 主な変更点

### 1. **破壊的変更: `onFileOperation`コールバックを完全に削除**

- 旧API: `createFSModule(projectDir, onFileOperation, unixCommands)`
- 新API: `createFSModule({ projectDir, projectId, projectName })`

### 2. **fileRepositoryを直接使用**

- ファイル操作は`fileRepository`を通じてIndexedDBに保存
- GitFileSystemへの同期は自動的に実行される
- UnixCommandsへの依存を削除

### 3. **モジュールの分割**

- `src/engine/node/modules/`ディレクトリに各モジュールを分離
- 保守性と可読性の向上

## ファイル構成

```
src/engine/node/
├── builtInModule_new.ts      # 新しいエントリーポイント（統合）
└── modules/
    ├── fsModule.ts            # fsモジュール（新アーキテクチャ対応）
    ├── pathModule.ts          # pathモジュール
    ├── osModule.ts            # osモジュール
    ├── utilModule.ts          # utilモジュール
    ├── httpModule.ts          # http/httpsモジュール
    ├── bufferModule.ts        # Bufferクラス
    └── readlineModule.ts      # readlineモジュール
```

## 使用方法

### 基本的な使い方

```typescript
import { createBuiltInModules } from '@/engine/node/builtInModule_new';

const modules = createBuiltInModules({
  projectDir: '/projects/my-project',
  projectId: 'project-123',
  projectName: 'my-project',
});

// fsモジュールを使用（自動的にIndexedDBに保存される）
await modules.fs.writeFile('/test.txt', 'Hello World');

// ファイルを読み取る
const content = await modules.fs.readFile('/test.txt');
console.log(content); // "Hello World"

// ファイルを削除（自動的にIndexedDBからも削除される）
await modules.fs.unlink('/test.txt');
```

### NodeJSRuntimeでの使用

```typescript
import { NodeJSRuntime } from '@/engine/runtime/nodeRuntime';

const runtime = new NodeJSRuntime(
  projectName,
  projectId,
  (output, type) => {
    console.log(`[${type}]`, output);
  }
);

await runtime.executeFile('main.js');
```

## 移行ガイド

### 旧コード（非推奨）

```typescript
import { createFSModule } from '@/engine/node/builtInModule';

const fs = createFSModule(projectDir, onFileOperation, unixCommands);
await fs.writeFile('/test.txt', 'Hello');
```

### 新コード（推奨）

```typescript
import { createBuiltInModules } from '@/engine/node/builtInModule_new';

const modules = createBuiltInModules({ projectDir, projectId, projectName });
await modules.fs.writeFile('/test.txt', 'Hello');
// IndexedDBへの保存とGitFileSystemへの同期は自動的に実行される
```

## データフロー

```
ユーザー操作（fs.writeFile等）
    ↓
fsModule (builtInModule_new)
    ↓
GitFileSystemに書き込み
    ↓
fileRepository.saveFile/createFile
    ↓
IndexedDBに保存（主データストア）
    ↓
【自動・非同期】
    ↓
GitFileSystemに同期（syncManagerが実行）
```

## 後方互換性

**破壊的変更**: 後方互換性は完全に無視しています。

- `builtInModule.ts`は将来的に削除予定
- すべての新規コードは`builtInModule_new.ts`を使用してください
- 既存のコードは段階的に移行が必要です

## 今後の作業

1. `builtInModule.ts`を使用している箇所をすべて`builtInModule_new.ts`に移行
2. 移行完了後、`builtInModule.ts`を削除
3. `builtInModule_new.ts`を`builtInModule.ts`にリネーム（最終段階）

## 関連ファイル

- `src/engine/core/fileRepository.ts` - IndexedDB管理（主要API）
- `src/engine/core/gitFileSystem.ts` - GitFileSystem管理
- `src/engine/core/syncManager.ts` - 自動同期エンジン
- `src/engine/runtime/nodeRuntime.ts` - Node.jsランタイム（新アーキテクチャ対応済み）
- `Development/NEW-ARCHITECTURE.md` - 新アーキテクチャの詳細ドキュメント

## テスト

現時点でエラーなし:

```bash
✅ src/engine/node/builtInModule_new.ts
✅ src/engine/node/modules/fsModule.ts
✅ src/engine/node/modules/pathModule.ts
✅ src/engine/node/modules/osModule.ts
✅ src/engine/node/modules/utilModule.ts
✅ src/engine/node/modules/httpModule.ts
✅ src/engine/node/modules/bufferModule.ts
✅ src/engine/node/modules/readlineModule.ts
✅ src/engine/runtime/nodeRuntime.ts
✅ src/components/Bottom/Terminal.tsx
```

---

**更新日**: 2025年10月1日  
**作成者**: AgentGPT
