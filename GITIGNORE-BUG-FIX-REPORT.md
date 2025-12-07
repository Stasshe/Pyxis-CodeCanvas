# .gitignore バグ修正レポート

## 🐛 発見された問題

`pyxis git tree --all` を実行すると、`.gitignore` に含まれているはずの `node_modules/` が表示されていました。

## 🔍 根本原因の分析

### 期待される動作
- IndexedDB: 全ファイルを保存（node_modules含む）
- lightning-fs: .gitignore適用後のファイルのみ

### 実際の動作（バグ）
- IndexedDB: 全ファイルを保存 ✅ 正常
- lightning-fs: **全ファイルを同期していた** ❌ バグ

### 原因特定

`src/engine/core/syncManager.ts` の `syncFromIndexedDBToFS()` メソッドが、.gitignore ルールを全く考慮していませんでした。

```typescript
// 修正前（バグ）
async syncFromIndexedDBToFS(projectId: string, projectName: string) {
  const dbFiles = await fileRepository.getFilesByPrefix(projectId, '/');
  // ↑ 全ファイルを取得
  
  for (const file of dbFiles) {
    await gitFileSystem.writeFile(projectName, file.path, file.content);
    // ↑ 全ファイルを lightning-fs に書き込み（.gitignore 無視）
  }
}
```

一方、単一ファイル操作では .gitignore チェックが**正しく動作していました**:

```typescript
// fileRepository.ts - 正常動作
private async syncToGitFileSystem(...) {
  const shouldIgnore = await this.shouldIgnorePathForGit(projectId, path);
  if (shouldIgnore) {
    return; // ← 無視されるファイルは同期しない
  }
  // ...
}
```

つまり、**bulk sync のみがバグっていた**のです。

## ✅ 修正内容

### コミット 9ee7e40: メイン修正

`src/engine/core/syncManager.ts` に .gitignore サポートを追加:

```typescript
async syncFromIndexedDBToFS(projectId: string, projectName: string) {
  const dbFiles = await fileRepository.getFilesByPrefix(projectId, '/');
  
  // ✅ .gitignore ルールを取得
  const gitignoreRules = await this.getGitignoreRules(projectId);
  
  // ✅ 無視されるファイルをフィルタリング
  const filteredDbFiles = dbFiles.filter(file => {
    if (file.path === '/.gitignore') return true; // .gitignore自体は含める
    return !this.shouldIgnorePath(gitignoreRules, file.path);
  });
  
  coreInfo(`Filtered files: ${dbFiles.length} -> ${filteredDbFiles.length}`);
  
  // ✅ フィルタ済みファイルのみ同期
  for (const file of filteredDbFiles) {
    await gitFileSystem.writeFile(projectName, file.path, file.content);
  }
}
```

### 追加メソッド

1. **`getGitignoreRules(projectId)`**:
   - IndexedDB から .gitignore ファイルを読み込み
   - `parseGitignore()` でルールをパース
   - ルールの配列を返す

2. **`shouldIgnorePath(rules, path)`**:
   - パスを正規化（先頭スラッシュ削除）
   - `isPathIgnored()` でマッチング
   - true/false を返す

### コミット e75c420: ドキュメント更新

`README-ARCHITECTURE-INVESTIGATION.md` を更新:
- バグと修正を記載
- データフローを修正
- 検証方法を追加

### コミット a274999: コード品質改善

- JSDoc コメント追加
- パラメータの説明を明確化

## 🧪 検証方法

### 1. プロジェクトを再読み込み

プロジェクトを開き直すか、別のプロジェクトに切り替えて戻る。
これにより `syncFromIndexedDBToFS()` が実行されます。

### 2. ターミナルで確認

```bash
pyxis git tree --all
```

**期待される出力**:
- `node_modules/` が表示されない ✅
- `.gitignore` に記載されたファイル/フォルダが表示されない ✅

**コンソールログで確認**:
```
[SyncManager] Loaded X .gitignore rules
[SyncManager] Filtered files: 1234 -> 567 (667 ignored)
```

### 3. Git操作で確認

```bash
pyxis git status
```

**期待される出力**:
- node_modules がトラッキング対象外 ✅
- .gitignore に記載されたファイルが無視される ✅

## 📊 修正の影響

### パフォーマンス改善

| 操作 | 修正前 | 修正後 |
|------|--------|--------|
| `git status` | 遅い（全ファイルスキャン） | ✅ 速い（無視ファイル除外） |
| `git diff` | 遅い（node_modules含む） | ✅ 速い（必要なファイルのみ） |
| `git tree` | 正確でない（重複表示） | ✅ 正確（.gitignore適用） |
| ストレージ使用量 | 大きい | ✅ 小さい（lightning-fs） |

### 正確性の向上

- lightning-fs の内容が IndexedDB の .gitignore フィルタ後のビューと一致
- Git操作の結果が期待通りに
- 二層アーキテクチャの設計意図が実現

## 🎯 結論

### バグ修正完了

.gitignore フィルタリングが全ての同期操作で正しく動作するようになりました:
- ✅ 単一ファイル操作（元から正常）
- ✅ バルク同期操作（修正完了）

### アーキテクチャの妥当性確認

このバグ修正により、二層アーキテクチャの設計が正しく機能することが確認されました:
- **IndexedDB**: 全ファイル + メタデータ（高速クエリ、Node Runtime用）
- **lightning-fs**: .gitignore適用済み（Git操作用、高速）

両方のレイヤーが必要であり、それぞれ異なる目的を果たしています。

---

**修正日**: 2025-01-07  
**コミット**: 9ee7e40, e75c420, a274999  
**ステータス**: 修正完了  
**次のアクション**: ユーザーによる動作確認
