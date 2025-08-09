# AI Agent実装計画

## 概要
VSCode GitHub Copilot Chatライクなコードエディタ内AIシステムの実装

## 実装スコープ
- 右サイドバーにAIチャットコンポーネント
- Gemini APIを使用したコード編集機能
- 複数ファイルコンテキスト対応
- AIレビューシステム（差分表示・採用/破棄機能）
- データベース直接編集対応

## 必要な型定義の追加

### 1. ProjectFile型の拡張
```typescript
interface ProjectFile {
  // 既存のフィールド...
  isAiAgentReview?: boolean; // AIエージェントによるレビュー中フラグ
  aiAgentCode?: string; // AIが提案するコード
}
```

### 2. Tab型の拡張（AIレビュータブ用）
```typescript
interface Tab {
  // 既存のフィールド...
  aiReviewProps?: {
    originalContent: string;
    suggestedContent: string;
    filePath: string;
  };
}
```

### 3. AI関連の新しい型定義
```typescript
interface AIMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  fileContext?: string[]; // 参照されたファイルパス
}

interface AIEditRequest {
  files: Array<{
    path: string;
    content: string;
  }>;
  instruction: string;
}

interface AIEditResponse {
  changedFiles: Array<{
    path: string;
    originalContent: string;
    suggestedContent: string;
    explanation: string;
  }>;
  message: string;
}
```

## ファイル構成計画

### 1. AI関連コンポーネント
```
src/components/AI/
├── AIAgent.tsx              # メインのAIチャットコンポーネント
├── ChatMessage.tsx          # チャットメッセージ表示
├── FileSelector.tsx         # ファイル選択コンポーネント（再利用）
├── ContextFileList.tsx      # 選択されたファイルコンテキスト表示
├── EditRequestForm.tsx      # 編集依頼フォーム
├── ChangedFilesList.tsx     # 変更されたファイル一覧
└── AIReview/
    ├── AIReviewTab.tsx      # AIレビュータブ
    ├── DiffViewer.tsx       # 差分表示コンポーネント
    ├── CodeBlock.tsx        # コードブロック表示（採用/破棄ボタン付き）
    └── ReviewActions.tsx    # レビューアクション（全適用/全破棄など）
```

### 2. AI関連ユーティリティ
```
src/utils/ai/
├── geminiClient.ts          # Gemini API クライアント
├── prompts.ts              # プロンプトテンプレート
├── diffProcessor.ts        # 差分処理ユーティリティ
└── contextBuilder.ts       # ファイルコンテキスト構築
```

### 3. AI関連フック
```
src/hooks/
├── useAIAgent.ts           # AIエージェントメインロジック
├── useAIReview.ts          # AIレビュー処理
└── useFileContext.ts       # ファイルコンテキスト管理
```

## 実装フェーズ

### Phase 1: 基盤実装
1. **型定義の拡張**
   - ProjectFile, Tab型の拡張
   - AI関連型定義の追加

2. **データベース拡張**
   - database.tsにAI関連フィールド対応追加
   - マイグレーション処理

3. **基本AIチャットコンポーネント**
   - AIAgent.tsx（基本チャット機能）
   - ChatMessage.tsx
   - geminiClient.ts（APIクライアント）
   - prompts.ts（プロンプト管理）

### Phase 2: ファイル選択・コンテキスト管理
1. **ファイル選択機能**
   - FileSelector.tsx（既存FileSelectModalの再利用・拡張）
   - ContextFileList.tsx
   - useFileContext.ts

2. **編集機能基盤**
   - EditRequestForm.tsx
   - contextBuilder.ts

### Phase 3: AI編集機能
1. **AI編集実装**
   - useAIAgent.ts（編集ロジック）
   - ChangedFilesList.tsx
   - データベース直接編集機能

### Phase 4: AIレビューシステム
1. **レビュータブ実装**
   - AIReviewTab.tsx
   - DiffViewer.tsx
   - CodeBlock.tsx
   - ReviewActions.tsx

2. **レビューロジック**
   - useAIReview.ts
   - diffProcessor.ts
   - タブ開き処理の統合

### Phase 5: 統合・UI最適化
1. **右サイドバー統合**
   - RightSidebar.tsx修正
   - page.tsx統合

2. **テーマ適用・UI調整**
   - ThemeContext対応
   - VSCodeライクなスタイリング

## 技術的考慮事項

### 1. セキュリティ
- Gemini APIキーの安全な管理
- プロンプトインジェクション対策

### 2. パフォーマンス
- 大きなファイルの処理最適化
- APIレスポンス時の非同期処理
- メモリ使用量の最適化

### 3. エラーハンドリング
- API接続エラー処理
- 不正なレスポンス処理
- ユーザーフレンドリーなエラーメッセージ

### 4. ユーザビリティ
- ローディング状態の表示
- キャンセル機能
- 元に戻す機能

## 拡張性の考慮

### エージェントモード準備
- メッセージ履歴の永続化
- マルチターン対話のサポート
- 実行計画の表示・承認機能
- プロジェクト全体の理解・編集機能

### 将来的な機能
- コードレビュー機能の拡張
- テスト自動生成
- ドキュメント生成
- リファクタリング提案

## 実装順序の詳細

1. **型定義とデータベース拡張** (30分)
2. **基本AIチャットコンポーネント** (60分)
3. **Gemini APIクライアント** (30分)
4. **ファイル選択・コンテキスト管理** (45分)
5. **AI編集機能** (60分)
6. **AIレビューシステム** (90分)
7. **統合・UI最適化** (45分)

**合計推定時間: 約6時間**

## 質問・確認事項

1. **Gemini APIキーの管理方法**: localStorage? 環境変数? 設定画面での入力?
2. **ファイルサイズ制限**: どの程度のサイズまでのファイルをコンテキストに含めるか?
3. **差分表示ライブラリ**: react-diff-viewerなど既存ライブラリの使用可否?
4. **isomorphic-git使用**: 差分処理でgitライブラリを使用するか、独自実装か?
5. **レビュータブの表示方法**: 専用タブタイプ? 既存diffタブの拡張?

この計画で実装を進めてよろしいでしょうか？
