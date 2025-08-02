# Git ファイル削除検知問題の分析と解決方針

## 問題の概要

現在、ターミナルやファイルツリー経由でファイルを削除しても、Gitで削除ファイルが検知されない問題が発生している。`git status`を実行しても "nothing to commit" と表示される。

## 問題の根本原因

### 1. **`syncFileToFileSystem`での削除処理の欠如**

**現在の実装:**
```typescript
// filesystem.ts の syncFileToFileSystem
await fs.promises.writeFile(fullPath, content); // 常にwriteFileを実行
```

**問題点:**
- 削除時も`writeFile`が実行され、空ファイルが作成される
- 実際のファイル削除が行われない
- Gitが期待する「ファイルの物理的削除」が発生しない

### 2. **`project.ts`での削除同期の誤り**

**現在の実装:**
```typescript
// project.ts の deleteFile
await syncFileToFileSystem(currentProject.name, fileToDelete.path, '');
```

**問題点:**
- 空文字列を渡すことで空ファイルを作成している
- 削除の意図を`syncFileToFileSystem`に伝えられていない

### 3. **`syncTerminalFileOperation`での削除通知の不備**

**現在の実装:**
```typescript
if (type === 'delete') {
  // IndexedDBからのみ削除、ファイルシステムへの削除通知なし
  await projectDB.deleteFile(fileToDelete.id);
  // ← ここでファイルシステムからの削除処理が欠けている
}
```

**問題点:**
- IndexedDBからは削除されるが、ファイルシステムからは削除されない
- Gitが参照するワーキングディレクトリに削除ファイルが残る

## Git削除検知のメカニズム

Gitの`statusMatrix`は以下の基準で削除を検知：
- `HEAD === 1 && workdir === 0` (HEADにあるがworkdirにない)
- `HEAD === 1 && workdir === 0 && stage === 0` → 未ステージの削除
- `HEAD === 1 && workdir === 0 && stage === 3` → ステージ済みの削除

**現在の状況:**
- HEADにファイルは存在（コミット済み）
- workdirにもファイルが存在（削除されていない）
- 結果：`HEAD === 1 && workdir === 1` → 変更なしと判定

## touchコマンドとの比較

**touchコマンドが正常動作する理由:**
1. `onFileOperation`でIndexedDBとファイルシステム両方に通知
2. `flushFileSystemCache()`でGitキャッシュも更新
3. `syncFileToFileSystem`で実際のファイル作成

**削除コマンドで欠けている処理:**
1. ファイルシステムからの物理的削除
2. Git用のファイルシステム同期
3. 削除専用の処理フロー

## 解決方針

### A. `syncFileToFileSystem`を削除対応に拡張

```typescript
// 新しいシグネチャ
export const syncFileToFileSystem = async (
  projectName: string, 
  filePath: string, 
  content: string | null, // null = 削除
  operation?: 'create' | 'update' | 'delete'
) => {
  if (operation === 'delete' || content === null) {
    // ファイル削除処理
    await fs.promises.unlink(fullPath);
  } else {
    // ファイル作成/更新処理
    await fs.promises.writeFile(fullPath, content);
  }
}
```

### B. `project.ts`の`deleteFile`修正

```typescript
// ファイルシステムからも削除（Git変更検知のため）
if (fileToDelete && fileToDelete.type === 'file') {
  const { syncFileToFileSystem } = await import('./filesystem');
  await syncFileToFileSystem(currentProject.name, fileToDelete.path, null, 'delete');
}
```

### C. `syncTerminalFileOperation`での削除同期追加

```typescript
if (type === 'delete') {
  // IndexedDBから削除
  await projectDB.deleteFile(fileToDelete.id);
  
  // ファイルシステムからも削除
  if (fileToDelete.type === 'file') {
    const { syncFileToFileSystem } = await import('./filesystem');
    await syncFileToFileSystem(currentProject.name, path, null, 'delete');
  }
}
```

### D. `rm`コマンド後の同期強化

```typescript
// unix.ts の removeFile
if (this.onFileOperation) {
  const relPath = this.getRelativePathFromProject(normalizedPath);
  await this.onFileOperation(relPath, 'delete');
}
```

## 修正の優先順位

1. **最高優先:** `syncFileToFileSystem`の削除対応
2. **高優先:** `syncTerminalFileOperation`での削除同期
3. **中優先:** `project.ts`の`deleteFile`修正
4. **低優先:** エラーハンドリングの改善

## 検証手順

1. ファイルを作成してコミット
2. `rm`コマンドでファイル削除
3. `git status`で削除が検知されることを確認
4. ファイルツリーからの削除でも同様に検証

## 期待される結果

修正後は以下のようになることを期待：
```bash
$ git status
On branch main
Changes not staged for commit:
  deleted:    example.txt

no changes added to commit (use "git add" to track)
```
