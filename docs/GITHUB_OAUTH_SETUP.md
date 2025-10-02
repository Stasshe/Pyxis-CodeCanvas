# GitHub OAuth Setup Guide

Pyxis CodeCanvasでGitHubへのPush機能を使用するには、GitHub OAuth Appの設定が必要です。

## 1. GitHub OAuth Appの作成

1. GitHubにログインし、https://github.com/settings/developers にアクセス
2. "OAuth Apps" → "New OAuth App" をクリック
3. 以下の情報を入力:
   - **Application name**: `Pyxis CodeCanvas` (任意)
   - **Homepage URL**: `https://pyxis-code.onrender.com`
   - **Authorization callback URL**: `https://pyxis-code.onrender.com/auth/github/callback`
4. "Register application" をクリック

## 2. Client IDとClient Secretの取得

1. 作成したOAuth Appのページで **Client ID** をコピー
2. "Generate a new client secret" をクリックして **Client Secret** を生成・コピー

## 3. 環境変数の設定

プロジェクトルートに `.env.local` ファイルを作成し、以下を記述:

```bash
# GitHub OAuth Configuration
NEXT_PUBLIC_GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here
NEXT_PUBLIC_REDIRECT_URI=https://pyxis-code.onrender.com/auth/github/callback
```

**注意**: 
- `NEXT_PUBLIC_GITHUB_CLIENT_ID`: ブラウザからアクセス可能（公開OK）
- `GITHUB_CLIENT_SECRET`: サーバーサイドのみ（絶対に公開しない）

## 4. 開発環境の設定（ローカル）

ローカル開発の場合は、以下の設定を使用:

```bash
NEXT_PUBLIC_GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here
NEXT_PUBLIC_REDIRECT_URI=http://localhost:3000/auth/github/callback
```

GitHub OAuth Appの設定で、以下も追加してください:
- **Authorization callback URL**: `http://localhost:3000/auth/github/callback`

## 5. Render.comへのデプロイ設定

Render.comのダッシュボードで環境変数を設定:

1. Render.comのプロジェクトページにアクセス
2. "Environment" タブをクリック
3. 以下の環境変数を追加:
   - `NEXT_PUBLIC_GITHUB_CLIENT_ID`: (Client IDを貼り付け)
   - `GITHUB_CLIENT_SECRET`: (Client Secretを貼り付け)
   - `NEXT_PUBLIC_REDIRECT_URI`: `https://pyxis-code.onrender.com/auth/github/callback`

## 6. 使い方

1. アプリケーションの左サイドバー下部の **ログインアイコン** をクリック
2. GitHubの認証ページにリダイレクトされます
3. "Authorize" をクリックして認証を許可
4. アプリに戻ると、ユーザーアイコンが表示されます
5. Git Panelの "Push to GitHub" ボタンでリモートにプッシュできます

## トラブルシューティング

### "GitHub authentication required" エラー
- MenuBarの下部にあるログインボタンからGitHubにサインインしてください

### "Remote 'origin' not found" エラー
- ターミナルで以下のコマンドを実行してリモートを追加:
  ```bash
  git remote add origin https://github.com/your-username/your-repo.git
  ```

### "Authentication failed" エラー
- 一度サインアウトして、再度サインインしてください
- GitHub OAuth Appの設定が正しいか確認してください

### CORS エラー
- isomorphic-gitは `https://cors.isomorphic-git.org` をCORSプロキシとして使用しています
- 一部のリポジトリではCORS制限により動作しない場合があります

## セキュリティ上の注意

- **Client Secret** は絶対に公開リポジトリにコミットしないでください
- `.env.local` ファイルは `.gitignore` に含まれているため、Gitには含まれません
- アクセストークンは以下の方法で保護されています:
  - **Session Storage**: 認証直後の一時保存（ページを閉じると消える）
  - **暗号化**: Web Crypto APIで暗号化してIndexedDBに保存
  - **暗号化キー**: セッションごとに生成、ブラウザを閉じると消える
- トークンがURLに表示されることはありません（Session Storage経由）

## 権限（Scope）

デフォルトでは以下の権限を要求します:
- `repo`: リポジトリへの読み書きアクセス
- `user`: ユーザー情報の読み取り

追加の権限が必要な場合は、`MenuBar.tsx` の `handleSignIn` 関数内の `scope` パラメータを変更してください。
