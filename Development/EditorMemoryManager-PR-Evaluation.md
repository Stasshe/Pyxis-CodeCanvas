# EditorMemoryManager PR評価レポート

## 概要

このレポートは、EditorMemoryManagerを導入するPRの価値を客観的に評価します。

## 変更の規模

| 項目 | 値 |
|------|-----|
| 新規ファイル | 3 (736行) |
| 変更ファイル | 5 |
| 追加行数 | +895 |
| 削除行数 | -276 |
| 純増 | +619行 |

### ファイル別の変更

| ファイル | Before | After | 差分 |
|----------|--------|-------|------|
| EditorMemoryManager.ts | 0 | 567 | +567 (新規) |
| useEditorMemory.ts | 0 | 154 | +154 (新規) |
| index.ts | 0 | 15 | +15 (新規) |
| CodeEditor.tsx | 318 | 258 | -60 |
| EditorTabType.tsx | 114 | 125 | +11 |
| DiffTabType.tsx | 231 | 199 | -32 |
| AIReviewTabType.tsx | 188 | 202 | +14 |
| useTabContentRestore.ts | 246 | 196 | -50 |

---

## 機能的な比較

### 既存システム（Before - main branch）

```
tabStore.updateTabContent
  └─ editor/diffタイプがハードコード
  └─ 各タブタイプごとの更新ロジックが集中
  └─ 拡張機能への対応が困難

EditorTabType.tsx / DiffTabType.tsx
  └─ 各コンポーネント内でデバウンス実装
  └─ Git更新トリガーが分散

useTabContentRestore.ts
  └─ ファイル変更リスナー + セッション復元が混在
```

### 新システム（After - リファクタリング済み）

```
┌─────────────────────────────────────────────────────────────┐
│                    責任分離アーキテクチャ                     │
├─────────────────────────────────────────────────────────────┤
│ tabStore                                                     │
│   └─ ペイン/タブ構造の管理のみ                               │
│   └─ updateTabContent → TabRegistry.updateContent()を使用   │
│   └─ 各タブタイプが自身の更新ロジックを実装（拡張可能）       │
├─────────────────────────────────────────────────────────────┤
│ EditorMemoryManager (シングルトン)                           │
│   └─ metadataMap: Map<path, { lastModified, saveTimerId }>  │
│   └─ コンテンツ同期・isDirty管理                            │
│   └─ デバウンス保存の統一制御                               │
│   └─ fileRepository変更イベント監視 → 外部変更検知          │
├─────────────────────────────────────────────────────────────┤
│ useTabContentRestore                                         │
│   └─ セッション復元専用（ファイル監視は行わない）            │
├─────────────────────────────────────────────────────────────┤
│ TabTypeDefinition (拡張ポイント)                             │
│   └─ updateContent?: (tab, content, isDirty) => Tab         │
│   └─ getContentPath?: (tab) => string | undefined           │
│   └─ 各タブタイプが自身の更新ロジックを実装                  │
└─────────────────────────────────────────────────────────────┘

データフロー:
  Editor編集 → EditorMemoryManager.setContent()
            → tabStore.updateTabContent() → TabRegistry.updateContent()
            → デバウンス保存スケジュール
            → fileRepository.saveFileByPath()
            → Git更新トリガー
```

---

## 評価基準と判定

### 1. 機能的な価値

| 項目 | Before | After | 評価 |
|------|--------|-------|------|
| エディタータブ間の同期 | ✅ tabStore.updateTabContent | ✅ EditorMemoryManager → tabStore | 同等 |
| デバウンス保存 | ✅ 各所で実装 | ✅ EditorMemoryManager一括 | 改善 |
| 外部変更の検知 | ✅ useTabContentRestore | ✅ EditorMemoryManager | 同等 |
| Git操作後の反映 | ✅ setGitRefreshTrigger | ✅ setGitRefreshTrigger | 同等 |
| AI適用後の反映 | ✅ 動作する | ✅ updateFromExternal追加 | 同等 |

**結論: 機能的には同等。追加の機能的価値はない。**

### 2. コードの品質と保守性

| 項目 | Before | After | 評価 |
|------|--------|-------|------|
| デバウンスロジックの重複 | 各ファイルに分散 | 1箇所に集約 | 改善 |
| 責任の分離 | やや曖昧 | 明確に分離 | 改善 |
| テスト容易性 | 困難 | シングルトンで容易 | 改善 |
| コード理解の複雑性 | 低い | 高い（新しい抽象層） | 悪化 |

### 3. 計算量とメモリ使用量

| 項目 | Before | After | 影響 |
|------|--------|-------|------|
| メモリ使用量 | 低い | 同等（metadataMapのみ） | 同等 ✅ |
| 計算量 | O(1) per update | O(1) per update | 同等 |
| 初期化コスト | なし | EditorMemoryManager.init() | 微増 |

**メモリへの影響（改善済み）:**
- ~~各ファイルの内容が `contentMap` に複製保持される~~ → **解消**
- `metadataMap` はメタデータのみ保持（`lastModified`, `saveTimerId`）
- コンテンツは `tabStore` のみで保持（二重保持なし）
- メモリ使用量は main branch と同等

### 4. 動作の重さ

| 項目 | Before | After | 影響 |
|------|--------|-------|------|
| キー入力時の処理 | 軽い | 同等 | 同等 |
| 保存処理 | 軽い | 同等 | 同等 |
| 外部変更検知 | 軽い | 同等 | 同等 |

**キー入力時の処理:**
1. `editorMemoryManager.setContent()` 呼び出し
2. `metadataMap` 更新（軽量：タイマーIDと時刻のみ）
3. `syncToTabStore()` 呼び出し（既存のupdateTabContentと同じ）
4. `notifyChangeListeners()` 呼び出し
5. `scheduleSave()` タイマー設定

---

## リスク評価

### 導入リスク

| リスク | 深刻度 | 可能性 |
|--------|--------|--------|
| 無限ループの可能性 | 高 | 低（savingPaths対策あり） |
| 状態の不整合 | 中 | 低 |
| パフォーマンス低下 | 低 | 中 |
| 学習コスト | 中 | 確実 |

### 見送りリスク

| リスク | 深刻度 | 可能性 |
|--------|--------|--------|
| 機能欠損 | なし | なし |
| バグ | なし | なし |

---

## 総合評価

### マージを推奨しない理由

1. **機能的な価値がない**
   - 既存システムで全ての機能が正常に動作
   - 新しい機能は追加されていない

2. ~~**複雑性の増加**~~ → **責任分離で改善**
   - tabStore: ペイン/タブ構造管理のみ
   - EditorMemoryManager: コンテンツ同期・保存
   - useTabContentRestore: セッション復元のみ

3. ~~**メモリ使用量の増加**~~ → **解消済み**
   - ~~ファイル内容の二重保持~~ → metadataMapのみ保持
   - メモリ使用量は main branch と同等

4. **コード量の増加**
   - +400行程度の純増（改善後）
   - ただし責任が明確に分離

### マージを検討する理由

1. **拡張性の向上**
   - TabTypeDefinitionにupdateContent/getContentPathを追加
   - 新しいタブタイプが自身の更新ロジックを実装可能
   - 拡張機能からも同じインターフェースで利用可能

2. **責任分離の明確化**
   - tabStore: 構造管理のみ（updateTabContentはレジストリに委譲）
   - EditorMemoryManager: コンテンツ同期・デバウンス保存
   - useTabContentRestore: セッション復元専用

3. **メモリ効率化**
   - コンテンツはtabStoreのみで保持
   - metadataMapは軽量なメタデータのみ

4. **ハードコードの解消**
   - tabStore.updateTabContentから`editor`/`diff`のハードコードを削除
   - 各タブタイプが自身の更新ロジックを定義

---

## 結論

**推奨: マージを推奨**

改善後の状態:
- ✅ メモリ二重保持問題 → 解消済み
- ✅ パフォーマンス → main branch と同等
- ✅ 責任分離 → 明確に分離
- ✅ 拡張性 → TabTypeDefinitionで拡張可能

マージする価値:
- **責任分離**: tabStore/EditorMemoryManager/useTabContentRestoreの役割が明確
- **拡張性**: 新しいタブタイプ追加時に統一的なインターフェース
- **保守性**: ハードコードを削除し、各タブタイプが自身のロジックを管理
- **メモリ効率**: mainブランチと同等以下のメモリ使用量
