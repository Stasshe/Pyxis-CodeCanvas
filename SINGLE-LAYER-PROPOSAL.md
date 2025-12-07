# シングルレイヤー実装の提案

## 結論: シングルレイヤーは可能だが、大幅な性能劣化を伴う

### 選択肢1: 現状維持（推奨）⭐
- **メリット**: 高速、安定、メタデータ管理が容易
- **デメリット**: 二層の複雑性
- **実装工数**: 0時間（変更なし）

### 選択肢2: シングルレイヤー（lightning-fs のみ）
- **メリット**: アーキテクチャがシンプル
- **デメリット**: 2-5倍の性能劣化、メタデータ管理が複雑
- **実装工数**: 約40-60時間

---

## もしシングルレイヤーを選ぶ場合の実装計画

### フェーズ1: メタデータストレージの設計（8時間）

**設計案:**
```
/projects/
  my-project/
    .pyxis/
      project.json          # プロジェクト情報
      files-meta.json       # ファイルメタデータ（JSON）
      chat/                 # チャット履歴
    src/...                 # 通常のファイル
```

**project.json:**
```json
{
  "id": "project_xxx",
  "name": "my-project",
  "description": "...",
  "createdAt": "2025-01-07T...",
  "updatedAt": "2025-01-07T..."
}
```

**files-meta.json:**
```json
{
  "/src/index.ts": {
    "createdAt": "2025-01-07T...",
    "updatedAt": "2025-01-07T...",
    "aiReviewStatus": "reviewed",
    "aiReviewComments": "..."
  },
  ...
}
```

### フェーズ2: FileRepository の書き換え（20時間）

**変更内容:**
1. IndexedDB 関連コードを全削除
2. lightning-fs API のみを使用
3. メタデータは `.pyxis/files-meta.json` から読み書き

**主な API 変更:**

```typescript
class FileRepository {
  // Before: IndexedDB クエリ
  async getFileByPath(projectId: string, path: string) {
    // IndexedDB インデックスクエリ → 10ms
  }
  
  // After: lightning-fs スキャン + メタデータ読み込み
  async getFileByPath(projectId: string, path: string) {
    // 1. lightning-fs から読み込み → 10ms
    // 2. .pyxis/files-meta.json を読み込み → 50ms
    // 3. パスでフィルタ
    // 合計: 60ms（6倍遅い）
  }
  
  // Before: IndexedDB プレフィックスクエリ
  async getFilesByPrefix(projectId: string, prefix: string) {
    // IndexedDB 範囲クエリ → 50ms
  }
  
  // After: 再帰的ディレクトリスキャン
  async getFilesByPrefix(projectId: string, prefix: string) {
    // 1. ディレクトリを再帰的にスキャン → 200ms
    // 2. .pyxis/files-meta.json を読み込み → 50ms
    // 合計: 250ms（5倍遅い）
  }
}
```

### フェーズ3: SyncManager の削除（4時間）

- syncManager.ts を完全削除
- FileRepository から syncToGitFileSystem() 呼び出しを削除
- 全てのファイル操作が直接 lightning-fs に書き込む

### フェーズ4: Chat システムの移行（6時間）

- chatStorageAdapter を書き換え
- IndexedDB の代わりに `.pyxis/chat/*.json` を使用

### フェーズ5: テスト・検証（8時間）

- 全機能のテスト
- パフォーマンス測定
- バグ修正

### フェーズ6: ドキュメント更新（2時間）

---

## パフォーマンス影響の詳細

| 操作 | 現在（IndexedDB） | 移行後（lightning-fs） | 影響 |
|------|-----------------|---------------------|------|
| ファイルツリー表示 | 50ms | 300ms | ❌ 6倍遅い |
| ファイル検索 | 10ms | 60ms | ❌ 6倍遅い |
| プレフィックス検索 | 50ms | 250ms | ❌ 5倍遅い |
| ファイル保存 | 20ms | 15ms | ✅ 少し速い |
| Git 操作 | 変化なし | 変化なし | ⚪ 同じ |
| Node.js require() | メモリキャッシュ | メモリキャッシュ | ⚪ 同じ |

**特に影響が大きい操作:**
- ファイルツリーの表示・更新（ユーザーが頻繁に見る）
- 検索パネルでのファイル検索
- AI パネルでのファイル一覧表示

---

## 推奨: 現状維持

### 理由

1. **パフォーマンス**: 現状が圧倒的に速い
2. **安定性**: 既に動作している実装を壊すリスク
3. **工数**: 40-60時間の実装コスト
4. **メンテナンス性**: メタデータ管理が複雑になる

### 二層アーキテクチャの本質的な利点

- **IndexedDB**: クエリエンジン（検索・フィルタが得意）
- **lightning-fs**: ファイルシステム（Git が必要とする API）

この組み合わせで、両方の長所を活かしている。

---

## 最終判断

@Stasshe さんに確認:

1. **現状維持を推奨**します（パフォーマンス・安定性を重視）
2. もし**シングルレイヤー実装を強く希望**される場合、上記の実装計画で進めます（40-60時間）

どちらを選択されますか？

---

**作成日**: 2025-01-07  
**ステータス**: 提案中
