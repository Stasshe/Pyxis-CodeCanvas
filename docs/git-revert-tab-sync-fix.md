# Git Revert Tab Synchronization Fix

## 問題の概要 (Problem Summary)

Git revertを実行した際に、コードエディタに変更が強制反映されない問題が発生していました。
リバート前のデータが使用され、タブを開き直しても問題は解決しませんでした。

When executing git revert, changes were not forcefully reflected in the code editor.
Pre-revert data was being used, and reopening tabs didn't resolve the issue.

## 原因分析 (Root Cause Analysis)

### データフロー

1. **Git操作の実行**:
   - `git revert`コマンドが`lightning-fs`でファイルを変更
   - `syncManager.syncFromFSToIndexedDB()`が呼び出される

2. **同期処理**:
   - `syncManager`がlightning-fs → IndexedDBへファイルを同期
   - `fileRepository.saveFile()`がchange eventを発火

3. **タブ更新**:
   - `useTabContentRestore`がfileRepositoryのイベントをリッスン
   - タブストアの内容を更新

4. **問題点**:
   - タブストアは更新されるが、Monaco/CodeMirrorエディタが変更を検知せず
   - UIに古いコンテンツが表示され続ける

### Data Flow

1. **Git Operation Execution**:
   - `git revert` command modifies files in `lightning-fs`
   - `syncManager.syncFromFSToIndexedDB()` is called

2. **Synchronization Process**:
   - `syncManager` syncs files from lightning-fs → IndexedDB
   - `fileRepository.saveFile()` emits change events

3. **Tab Update**:
   - `useTabContentRestore` listens to fileRepository events
   - Updates tab store content

4. **Issue**:
   - Tab store is updated but Monaco/CodeMirror editors don't detect changes
   - Old content continues to display in UI

## 解決策 (Solution)

### 実装された変更

#### 1. Git操作後の強制リフレッシュ機構

`src/hooks/useTabContentRestore.ts`に新しいeffectを追加:

```typescript
// 3. Git操作後の強制リフレッシュ（git revert, reset, checkout等）
useEffect(() => {
  if (!isRestored) return;

  const handleSyncStop = (event: any) => {
    // fs->db方向の同期（git操作後）のみ処理
    if (event.direction !== 'fs->db' || !event.success) return;

    console.log('[useTabContentRestore] Git operation detected, force refreshing all tabs');

    const refreshAllTabs = async () => {
      // IndexedDBから最新のファイル内容を取得
      // 全タブのコンテンツを強制的に更新
      // Monaco/CodeMirrorの強制再描画をトリガー
    };

    refreshAllTabs();
  };

  syncManager.on('sync:stop', handleSyncStop);
  return () => syncManager.off('sync:stop', handleSyncStop);
}, [isRestored, store, normalizePath]);
```

#### 2. 対象タブの拡張

- **Editorタブ**: コンテンツを直接更新
- **Diffタブ**: `editable=true`のタブの`latterContent`を更新
- **AIReviewタブ**: 必要に応じて対応可能

#### 3. エディタの強制再描画

既存の`pyxis-force-monaco-refresh`イベントを利用:

```typescript
window.dispatchEvent(new CustomEvent('pyxis-force-monaco-refresh'));
```

### Implementation Changes

#### 1. Forced Refresh Mechanism After Git Operations

Added new effect in `src/hooks/useTabContentRestore.ts`:

- Listens to `syncManager`'s `sync:stop` event
- Filters for `fs->db` direction (git operations)
- Fetches latest content from IndexedDB for all open tabs
- Updates tab store state
- Triggers editor refresh

#### 2. Extended Tab Coverage

- **Editor tabs**: Direct content update
- **Diff tabs**: Update `latterContent` for `editable=true` tabs
- **AIReview tabs**: Can be supported as needed

#### 3. Editor Forced Redraw

Utilizes existing `pyxis-force-monaco-refresh` event:
- MonacoEditor already listens to this event
- CodeMirror handles content updates via useEffect

## 動作フロー (Operation Flow)

```
[Git Revert実行]
    ↓
[lightning-fs ファイル変更]
    ↓
[syncManager.syncFromFSToIndexedDB()]
    ↓
[fileRepository イベント発火]
    ↓
[useTabContentRestore が sync:stop 検知]
    ↓
[IndexedDB から最新コンテンツ取得]
    ↓
[全タブのストア更新]
    ↓
[pyxis-force-monaco-refresh イベント]
    ↓
[Monaco/CodeMirror 再描画]
    ↓
[最新コンテンツが表示される ✓]
```

## タブコンテンツの一元管理 (Centralized Tab Content Management)

### 設計原則

1. **単一の真実の源 (Single Source of Truth)**:
   - すべてのタブの状態は`useTabStore`で管理
   - `updateTabContent()`で同じパスの全タブを同期更新

2. **タイプ別の対応**:
   - **CodeEditor**: 編集可能、リアルタイム同期
   - **DiffTab**: 編集可能/読み取り専用、Git差分表示
   - **AIReviewTab**: 読み取り専用、AI分析結果

3. **イベント駆動**:
   - ファイル変更 → `fileRepository` イベント
   - Git操作 → `syncManager` イベント
   - タブ更新 → `useTabContentRestore` が処理

### Design Principles

1. **Single Source of Truth**:
   - All tab states managed in `useTabStore`
   - `updateTabContent()` syncs all tabs with same path

2. **Type-Specific Handling**:
   - **CodeEditor**: Editable, real-time sync
   - **DiffTab**: Editable/readonly, Git diff display
   - **AIReviewTab**: Readonly, AI analysis results

3. **Event-Driven**:
   - File changes → `fileRepository` events
   - Git operations → `syncManager` events
   - Tab updates → processed by `useTabContentRestore`

## テスト手順 (Testing Procedure)

### 手動テスト

1. プロジェクトを開く
2. ファイルを編集してコミット
3. 別の編集を行いコミット
4. `git revert HEAD`を実行
5. 開いているタブが自動的に前の状態に戻ることを確認
6. 複数のタブで同じファイルを開いている場合、すべて更新されることを確認

### Manual Testing

1. Open a project
2. Edit a file and commit
3. Make another edit and commit
4. Execute `git revert HEAD`
5. Verify open tabs automatically revert to previous state
6. If same file is open in multiple tabs, verify all are updated

## 今後の改善 (Future Improvements)

1. **AIReviewタブの対応**:
   - Git操作後のAIレビュー結果の更新

2. **パフォーマンス最適化**:
   - 大量のタブがある場合の差分更新
   - IndexedDB読み込みのバッチ処理

3. **エラーハンドリング**:
   - ファイル取得失敗時の詳細なエラー表示
   - リトライ機構の追加

## 関連ファイル (Related Files)

- `src/hooks/useTabContentRestore.ts`: タブコンテンツ復元・同期ロジック
- `src/stores/tabStore.ts`: タブ・ペイン管理ストア
- `src/engine/core/syncManager.ts`: ファイル同期マネージャー
- `src/engine/core/fileRepository.ts`: IndexedDBファイル管理
- `src/engine/cmd/global/gitOperations/revert.ts`: Git revert実装

## 設計上の注意点 (Design Considerations)

1. **ストアの肥大化**:
   - `tabStore.ts`は1071行あるが、機能が密結合
   - 分割は慎重に行う必要がある
   - 包括的なドキュメントで保守性を確保

2. **イベントの順序**:
   - `syncManager`の同期完了を待ってからタブ更新
   - 競合状態を避けるため`async/await`を使用

3. **エディタの特性**:
   - Monaco: 明示的な`setValue()`が必要
   - CodeMirror: `useEffect`で自動的に反映
