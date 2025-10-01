# Pyxis CodeCanvas - 新アーキテクチャガイド

## 概要

新アーキテクチャでは、**IndexedDBを唯一の真実の源（Single Source of Truth）**とし、GitFileSystemへの同期は自動的にバックグラウンドで実行されます。

## データフロー

```
ユーザー操作
    ↓
アプリケーション層（UI/Commands）
    ↓
FileRepository（IndexedDB管理）← 【ここだけ呼ぶ】
    ↓
IndexedDB（主データストア）
    ↓
【自動・非同期・バックグラウンド】
    ↓
SyncManager（同期調整）
    ↓
GitFileSystem（lightning-fs管理）
    ↓
lightning-fs（Git用ワークスペース）
```

## core/* ファイル一覧と役割

### 1. `fileRepository.ts` ★ 主要API
**役割**: IndexedDBを管理する統一的なファイル操作API  
**使用場面**: **全てのファイル操作はここを経由する**  
**自動同期**: ✅ 有効（保存・削除時にGitFileSystemへ自動同期）

#### 主なメソッド:
```typescript
// プロジェクト管理
await fileRepository.createProject(name, description)
await fileRepository.getProjects()
await fileRepository.deleteProject(projectId)

// ファイル操作（これらを使えば自動でGitFileSystemに同期される）
await fileRepository.createFile(projectId, path, content, type, isBufferArray?, bufferContent?)
await fileRepository.saveFile(file)
await fileRepository.deleteFile(fileId)
await fileRepository.getProjectFiles(projectId)

// チャット管理
await fileRepository.createChatSpace(projectId, name)
await fileRepository.addMessageToChatSpace(spaceId, message)
```

#### 使用例:
```typescript
import { fileRepository } from '@/engine/core/fileRepository';

// ファイル作成（自動的にGitFileSystemに同期される）
await fileRepository.createFile(
  projectId,
  '/src/hello.ts',
  'console.log("Hello");',
  'file'
);

// ファイル削除（自動的にGitFileSystemからも削除される）
await fileRepository.deleteFile(fileId);
```

---

### 2. `gitFileSystem.ts` 🔧 低レベルAPI
**役割**: lightning-fsを管理し、Git操作専用のファイルシステムAPI  
**使用場面**: 通常は直接使用しない（SyncManagerが使用）  
**自動同期**: ❌ なし（FileRepositoryが内部的に使用）

#### 主なメソッド:
```typescript
gitFileSystem.init()                    // 初期化
gitFileSystem.getFS()                   // FSインスタンス取得
gitFileSystem.getProjectDir(name)       // プロジェクトディレクトリパス取得
gitFileSystem.writeFile(project, path, content)
gitFileSystem.readFile(project, path)
gitFileSystem.deleteFile(project, path)
gitFileSystem.getAllFiles(project)      // 全ファイル取得
gitFileSystem.flush()                   // キャッシュフラッシュ
```

#### 使用場面:
- ✅ Terminal.tsx: ターミナル初期化時
- ✅ UnixCommands: ls/cat等の読み取り操作
- ❌ ファイル作成/更新/削除: `fileRepository`を使用すること

---

### 3. `syncManager.ts` 🔄 自動同期エンジン
**役割**: FileRepositoryとGitFileSystemの差分同期を調整  
**使用場面**: 通常は直接使用しない（FileRepositoryが内部的に使用）  
**自動同期**: ✅ FileRepositoryから自動的に呼ばれる

#### 主なメソッド:
```typescript
// プロジェクト全体の同期
await syncManager.syncFromIndexedDBToFS(projectId, projectName)
await syncManager.initializeProject(projectId, projectName)

// 単一ファイルの同期（FileRepositoryが自動的に呼ぶ）
await syncManager.syncSingleFileToFS(projectName, path, content, operation, bufferContent?)
```

#### 使用場面:
- ✅ FileRepository内部: 保存/削除時の自動同期
- ✅ Terminal.tsx: プロジェクト全体の初期同期
- ✅ project.ts: プロジェクト初期化時
- ❌ 通常のファイル操作: FileRepositoryが自動的に呼ぶので不要

---

### 4. `database.ts` 🔄 後方互換ラッパー
**役割**: 旧projectDB APIの後方互換性を提供  
**使用場面**: レガシーコード（徐々にfileRepositoryに移行予定）  
**推奨**: ❌ 新規コードでは使用しない

#### 構造:
```typescript
export const projectDB = {
  init: () => fileRepository.init(),
  createProject: (...) => fileRepository.createProject(...),
  getProjects: () => fileRepository.getProjects(),
  // ... 全てfileRepositoryに委譲
}
```

---

### 5. `filesystem.ts` 🔄 後方互換ラッパー
**役割**: 旧filesystem APIの後方互換性を提供  
**使用場面**: レガシーコード（徐々にgitFileSystemに移行予定）  
**推奨**: ❌ 新規コードでは使用しない

#### 構造:
```typescript
export const getFileSystem = () => gitFileSystem.getFS()
export const initializeFileSystem = () => gitFileSystem.init()
export const getProjectDir = (name) => gitFileSystem.getProjectDir(name)
```

---

### 6. `project.ts` 📦 React Hook
**役割**: プロジェクト管理用のカスタムフック  
**使用場面**: Reactコンポーネントからのプロジェクト操作  
**内部実装**: fileRepository、syncManager、gitFileSystemを使用

#### 提供するAPI:
```typescript
const {
  currentProject,
  projectFiles,
  loadProject,
  saveFile,
  deleteFile,
  createProject,
  syncTerminalFileOperation,
  refreshProjectFiles,
  clearAIReview,
} = useProject();
```

---

## 新規コードの書き方

### ✅ 推奨パターン

#### 1. ファイル作成
```typescript
import { fileRepository } from '@/engine/core/fileRepository';

// これだけでIndexedDBに保存され、自動的にGitFileSystemに同期される
await fileRepository.createFile(
  projectId,
  '/src/newFile.ts',
  'const x = 1;',
  'file'
);
```

#### 2. ファイル更新
```typescript
import { fileRepository } from '@/engine/core/fileRepository';

const files = await fileRepository.getProjectFiles(projectId);
const file = files.find(f => f.path === '/src/hello.ts');

if (file) {
  // これだけでIndexedDBが更新され、自動的にGitFileSystemに同期される
  await fileRepository.saveFile({
    ...file,
    content: 'console.log("Updated");',
    updatedAt: new Date(),
  });
}
```

#### 3. ファイル削除
```typescript
import { fileRepository } from '@/engine/core/fileRepository';

// これだけでIndexedDBから削除され、自動的にGitFileSystemからも削除される
await fileRepository.deleteFile(fileId);
```

#### 4. ファイル読み取り（表示用）
```typescript
import { fileRepository } from '@/engine/core/fileRepository';

// IndexedDBから読み取る（最新データ）
const files = await fileRepository.getProjectFiles(projectId);
const file = files.find(f => f.path === '/src/hello.ts');
console.log(file?.content);
```

#### 5. ファイル読み取り（Git/ターミナル用）
```typescript
import { gitFileSystem } from '@/engine/core/gitFileSystem';

// GitFileSystem（lightning-fs）から直接読み取る
const content = await gitFileSystem.readFile(projectName, '/src/hello.ts');
console.log(content);
```

---

### ❌ 避けるべきパターン

```typescript
// ❌ syncManagerを直接呼ぶ（FileRepositoryが自動的に呼ぶ）
import { syncManager } from '@/engine/core/syncManager';
await syncManager.syncSingleFileToFS(...); // 不要！

// ❌ gitFileSystemで直接書き込む（同期が取れなくなる）
import { gitFileSystem } from '@/engine/core/gitFileSystem';
await gitFileSystem.writeFile(projectName, path, content); // NG！

// ❌ database.ts（projectDB）を使う（後方互換のみ）
import { projectDB } from '@/engine/core/database';
await projectDB.createFile(...); // 古いAPI、fileRepositoryを使うべき

// ❌ filesystem.tsの関数を使う（後方互換のみ）
import { getFileSystem } from '@/engine/core/filesystem';
const fs = getFileSystem(); // 古いAPI、gitFileSystemを使うべき
```

---

## コマンド実装例（UnixCommands）

### 新アーキテクチャ版
```typescript
import { fileRepository } from '@/engine/core/fileRepository';
import { gitFileSystem } from '@/engine/core/gitFileSystem';

export class UnixCommands {
  async touch(fileName: string): Promise<string> {
    const relativePath = this.getRelativePathFromProject(fileName);
    
    // IndexedDBに作成（自動的にGitFileSystemに同期される）
    await fileRepository.createFile(this.projectId, relativePath, '', 'file');
    
    return `File created: ${fileName}`;
  }

  async rm(fileName: string): Promise<string> {
    const relativePath = this.getRelativePathFromProject(fileName);
    
    // IndexedDBから取得
    const files = await fileRepository.getProjectFiles(this.projectId);
    const file = files.find(f => f.path === relativePath);
    
    if (!file) {
      throw new Error(`No such file: ${fileName}`);
    }
    
    // IndexedDBから削除（自動的にGitFileSystemからも削除される）
    await fileRepository.deleteFile(file.id);
    
    return `removed '${fileName}'`;
  }

  async cat(fileName: string): Promise<string> {
    const fullPath = this.normalizePath(fileName);
    
    // GitFileSystemから直接読み取る（Git用ワークスペース）
    const content = await this.fs.promises.readFile(fullPath, { encoding: 'utf8' });
    return content as string;
  }
}
```

---

## まとめ

### 基本ルール
1. **ファイル作成/更新/削除**: `fileRepository`を使う
2. **ファイル読み取り（表示用）**: `fileRepository`を使う
3. **ファイル読み取り（Git/ターミナル用）**: `gitFileSystem`を使う
4. **同期**: 自動的に実行されるので気にしない
5. **プロジェクト管理**: Reactでは`useProject()`、それ以外では`fileRepository`

### ファイル優先度
- 🥇 **fileRepository.ts**: 主要API（常に使用）
- 🥈 **gitFileSystem.ts**: 読み取り専用で使用（書き込みは避ける）
- 🥉 **project.ts**: Reactコンポーネントから使用
- 🔄 **syncManager.ts**: 内部的に使用（直接呼ばない）
- 🚫 **database.ts**: 使用しない（後方互換のみ）
- 🚫 **filesystem.ts**: 使用しない（後方互換のみ）

### 開発時の心構え
- **IndexedDBが主データストア**: 全ての変更はまずIndexedDBに
- **自動同期を信頼する**: GitFileSystemへの同期は自動で実行される
- **シンプルに保つ**: 複雑な同期ロジックは書かない
- **エラーは無視される**: バックグラウンド同期のエラーはコンソールに警告のみ

---

## トラブルシューティング

### Q: ファイルがGitFileSystemに反映されない
A: FileRepositoryを使用していますか？`gitFileSystem.writeFile()`を直接呼んでいる場合、IndexedDBと同期が取れません。

### Q: 同期が遅い
A: 同期は非同期・バックグラウンドで実行されます。`await`で待つ必要はありませんが、Git操作の直前に少し待つ必要がある場合は、`gitFileSystem.flush()`を使用できます（ただし通常は不要）。

### Q: レガシーコードからの移行
A: `projectDB.*` → `fileRepository.*` に置き換えるだけです。APIはほぼ同じです。

---

**最終更新**: 2025-10-01  
**バージョン**: 2.0 (新アーキテクチャ)
