# GitHub Push機能 実装完了 🚀

## 実装内容

### 1. 認証システム (`authRepository.ts`)
- IndexedDBにGitHub認証情報を保存
- アクセストークン、ユーザー情報を管理
- サインイン/サインアウト機能

### 2. Push機能 (`push.ts`)
- `git push` コマンドの実装
- `git remote add/remove` コマンドの実装
- isomorphic-gitを使用したリモート操作
- OAuth tokenを使用した認証

### 3. UI/UX
- **MenuBar**: 
  - 下部にGitHubサインインボタン追加
  - 認証後はユーザーアバター表示
  - ドロップダウンメニューでサインアウト
- **GitPanel**:
  - "Push to GitHub" ボタン追加
  - プッシュ状態の表示

### 4. API Routes
- `/api/auth/github/callback/route.ts`: OAuth callbackハンドラー
- codeをaccess_tokenに交換
- ユーザー情報を取得してフロントエンドに返す

### 5. ターミナルコマンド
- `git push [remote] [branch] [--force]`
- `git remote add <name> <url>`
- `git remote remove <name>`
- `git remote [-v]`

## セットアップ手順

### 1. GitHub OAuth Appの作成
詳細は `/docs/GITHUB_OAUTH_SETUP.md` を参照

### 2. 環境変数の設定
`.env.local` を作成:
```bash
NEXT_PUBLIC_GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
NEXT_PUBLIC_REDIRECT_URI=https://pyxis-code.onrender.com/auth/github/callback
```

### 3. Render.comでの環境変数設定
- `NEXT_PUBLIC_GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `NEXT_PUBLIC_REDIRECT_URI`

## 使い方

### サインイン
1. 左サイドバー下部のログインアイコンをクリック
2. GitHubで認証を許可
3. アプリに戻ると自動的にサインイン完了

### リモートの設定
```bash
git remote add origin https://github.com/username/repo.git
```

### プッシュ
1. GitPanelで変更をコミット
2. "Push to GitHub" ボタンをクリック
3. 自動的にリモートにプッシュされます

または、ターミナルから:
```bash
git push
git push origin main
git push --force
```

## アーキテクチャ

### NEW-ARCHITECTURE準拠
- Git操作は `gitFileSystem` を直接使用
- 認証情報は `authRepository` (IndexedDB) に保存
- Push操作は `gitOperations/push.ts` に実装
- `GitCommands` クラスに統合

### データフロー
```
ユーザー操作
    ↓
MenuBar/GitPanel (UI)
    ↓
GitCommands.push()
    ↓
gitOperations/push.ts
    ↓
isomorphic-git + authRepository
    ↓
GitHub API (OAuth token)
```

## セキュリティ

### 現在の実装
- アクセストークンはIndexedDBに平文保存
- HTTPSで通信
- Client Secretはサーバーサイドでのみ使用

### 今後の改善案
- トークンの暗号化
- トークンのリフレッシュ機能
- より安全なコールバック処理（セッションストレージ経由）

## 制限事項

### CORS制限
- isomorphic-gitは `https://cors.isomorphic-git.org` を使用
- 一部のGitHubリポジトリではCORS制限により動作しない場合がある

### iPad対応
- リダイレクトベースの認証フローで完全対応
- ポップアップブロックの影響を受けない

## ファイル一覧

### 新規作成
- `src/engine/core/authRepository.ts`
- `src/engine/cmd/gitOperations/push.ts`
- `src/app/api/auth/github/callback/route.ts`
- `docs/GITHUB_OAUTH_SETUP.md`
- `.env.example`

### 修正
- `src/components/MenuBar.tsx`
- `src/components/Left/GitPanel.tsx`
- `src/components/Bottom/TerminalGitCommands.tsx`
- `src/engine/cmd/git.ts`
- `src/engine/cmd/gitOperations/merge.ts`

## テスト

### 動作確認項目
- [ ] GitHubサインイン
- [ ] ユーザーアバター表示
- [ ] サインアウト
- [ ] `git remote add` コマンド
- [ ] `git push` コマンド
- [ ] GitPanelの "Push to GitHub" ボタン
- [ ] エラーハンドリング（認証失敗、ネットワークエラー）

## 次のステップ

1. GitHub OAuth Appを作成
2. 環境変数を設定
3. 動作確認
4. 必要に応じてトークン暗号化を実装

---

実装完了日: 2025-10-02
