# シングルレイヤー（lightning-fs のみ）の実現可能性分析

## 現状の理解

### IndexedDB の主な用途

1. **プロジェクト・ファイルメタデータの保存**
   - projects テーブル: プロジェクト情報
   - files テーブル: ファイル情報 + メタデータ
   - chatSpaces テーブル: チャット履歴

2. **高速クエリ**
   - `getFileByPath(projectId, path)`: パス検索（インデックス使用）
   - `getFilesByPrefix(projectId, prefix)`: プレフィックス検索
   - `getProjectFiles(projectId)`: プロジェクト全ファイル取得

3. **メタデータ管理**
   - createdAt, updatedAt
   - aiReviewStatus, aiReviewComments
   - isBufferArray, bufferContent

## シングルレイヤーへの移行案

### 方針A: lightning-fs のみを使用

#### メリット
- アーキテクチャがシンプルになる
- 同期の複雑性がなくなる
- ストレージ層が一つだけ

#### デメリット・課題

1. **インデックスベースクエリが不可能**
   - `getFileByPath()` → 毎回ディレクトリをスキャン必要
   - `getFilesByPrefix()` → 再帰的にディレクトリスキャン
   - ファイル数が多いと極端に遅くなる

2. **メタデータの保存場所がない**
   - lightning-fs は単なるファイルシステム
   - 作成日時、AIレビュー状態などを保存できない
   - 解決策: メタデータを別ファイルに保存？（例: .pyxis-meta/ ディレクトリ）

3. **トランザクションサポートがない**
   - 複数ファイルの一括操作で、途中失敗すると不整合になる
   - 解決策: 手動でロールバック処理を実装？

4. **プロジェクト情報の保存**
   - projects テーブルの代替が必要
   - 解決策: `/projects/{name}/.pyxis-project.json` に保存？

5. **チャット履歴の保存**
   - chatSpaces テーブルの代替が必要
   - 解決策: `/projects/{name}/.pyxis-chat/` ディレクトリに保存？

6. **Node.js Runtime のモジュール解決**
   - 現在は IndexedDB から直接読み込み（高速）
   - lightning-fs からの読み込みは遅い可能性がある
   - 解決策: メモリキャッシュを強化？

### 方針B: lightning-fs + localStorage

#### メリット
- lightning-fs をプライマリストレージに
- localStorage でメタデータ管理

#### デメリット
- localStorage は容量制限が厳しい（5-10MB）
- 大量のファイルメタデータを保存できない

### 方針C: lightning-fs + 独自メタデータファイル

#### 実装案

```
/projects/
  my-project/
    .pyxis/
      project.json          # プロジェクト情報
      files-meta.json       # 全ファイルのメタデータ
      chat/                 # チャット履歴
        space-1.json
        space-2.json
    src/
      index.ts
    package.json
```

#### メリット
- メタデータもファイルシステムに統一
- バックアップ・エクスポートが簡単

#### デメリット
- メタデータファイルが大きくなる
- 更新のたびにファイル全体を読み書き
- インデックスクエリは依然として遅い

## パフォーマンス比較

### ケース1: ファイルツリー表示（1000ファイル）

**IndexedDB:**
- `getProjectFiles(projectId)`: インデックスクエリ → 50-100ms

**lightning-fs のみ:**
- ディレクトリを再帰的にスキャン → 300-500ms

### ケース2: パス検索（特定ファイル取得）

**IndexedDB:**
- `getFileByPath(projectId, '/src/index.ts')`: インデックスクエリ → 5-10ms

**lightning-fs のみ:**
- `fs.promises.readFile('/projects/my-project/src/index.ts')`: 直接読み込み → 10-20ms
- ただし、メタデータ取得のために files-meta.json も読む必要 → 追加で 50ms

### ケース3: プレフィックス検索（ディレクトリ下の全ファイル）

**IndexedDB:**
- `getFilesByPrefix(projectId, '/src/')`: 範囲クエリ → 50-100ms

**lightning-fs のみ:**
- ディレクトリを再帰的にスキャン + メタデータ読み込み → 200-400ms

## 結論

### lightning-fs 単体での実現は**技術的に可能だが、パフォーマンスが大幅に劣化する**

主な問題点:
1. インデックスクエリの代替がない → ディレクトリスキャン必須
2. メタデータ管理が複雑になる
3. パフォーマンスが2-5倍遅くなる

### 推奨案: 現状の二層アーキテクチャを維持

理由:
- パフォーマンスが最適
- メタデータ管理が明確
- トランザクションサポート
- 実装がすでに安定している

### 代替案: 二層だが .gitignore を IndexedDB にも適用

もし「重複」が気になる場合:
- IndexedDB にも .gitignore を適用して、node_modules を保存しない
- ただし、Node.js Runtime が機能しなくなる可能性
- この案は**推奨しない**

---

**作成日**: 2025-01-07  
**ステータス**: 分析中
