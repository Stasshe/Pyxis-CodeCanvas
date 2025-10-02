# GitHub Personal Access Token (PAT) 認証実装 🔐

## 概要
Device Flow認証からPersonal Access Token (PAT) 認証への移行を完了しました。
PATは完全にクライアントサイドで動作し、OAuth Appの登録が不要です。

## 変更内容

### 削除されたファイル
- ✅ `/src/engine/core/githubDeviceFlow.ts` - Device Flow実装を削除
- ✅ `/Development/DEVICE_FLOW_IMPLEMENTATION.md` - 旧ドキュメントを削除

### 修正されたファイル
- ✅ `/src/engine/core/authRepository.ts` - `GitHubUser`型を内部で定義
- ✅ `/src/components/MenuBar.tsx` - PAT入力UIに変更
- ✅ `.env.example` - Device Flow設定を削除

## 🔑 Personal Access Token の使い方

### ユーザー向け手順

1. **MenuBar の LogIn アイコンをクリック**
2. **PAT入力ダイアログが表示される**
3. **「ここをクリック」リンクから GitHub で PAT を作成**
   - 必要なスコープ: `repo` (プライベートリポジトリへのアクセス)
4. **生成されたトークン（`ghp_xxx...`）をコピー**
5. **ダイアログに貼り付けて「サインイン」をクリック**

### トークンの保存方法

- IndexedDB に**暗号化**されて保存されます
- ブラウザのローカルストレージに安全に保管
- セッション間で永続化されます

## 🚀 技術仕様

### 認証フロー

```
1. ユーザーが PAT を入力
2. GitHub API でユーザー情報を取得 (GET /user)
3. トークンとユーザー情報を暗号化して IndexedDB に保存
4. ログイン完了
```

### セキュリティ

- ✅ トークンは暗号化されて保存
- ✅ メモリ上での一時保存のみ
- ✅ HTTPS通信（Render.com等の本番環境）
- ✅ スコープ制御（repoのみ）

### API エンドポイント

```typescript
// ユーザー情報取得
GET https://api.github.com/user
Headers: {
  Authorization: `Bearer ${pat}`,
  Accept: 'application/vnd.github+json'
}
```

## 📝 使用例

### Git Push with PAT

```typescript
const token = await authRepository.getAccessToken();
if (token) {
  // Git remote URL with token
  const remoteUrl = `https://${token}@github.com/owner/repo.git`;
  // または credential helper経由
  await git.push({ 
    username: token, 
    password: 'x-oauth-basic' 
  });
}
```

## 🎨 UI/UX

### PAT入力ダイアログ
- MenuBarの下部からポップアップ
- パスワード形式の入力フィールド
- GitHub PATの作成リンク付き
- キャンセルボタンあり
- Enterキーでサインイン可能

### ユーザーメニュー
- サインイン後はアバター表示
- クリックでメニュー表示
- ユーザー名とログイン名表示
- サインアウト機能

## ⚠️ 注意事項

1. **PATの有効期限管理**
   - GitHubのPATには有効期限があります
   - 期限切れの場合は再度サインインが必要

2. **スコープの確認**
   - `repo`スコープが必須
   - プライベートリポジトリへのpush/pull権限

3. **トークンの取り扱い**
   - 絶対に公開しないでください
   - .gitignoreに追加不要（UIから入力）

## 🔄 移行理由

### Device Flow の課題
- ❌ OAuth App登録が必要（GitHub Developer Settings）
- ❌ Client IDの管理が必要
- ❌ callbackサーバーの設定が複雑
- ❌ ポーリングによる認証待機

### PAT のメリット
- ✅ OAuth App登録不要
- ✅ 即座に利用可能
- ✅ シンプルな実装
- ✅ 完全クライアントサイド

## 📚 参考リンク

- [GitHub PAT作成ページ](https://github.com/settings/tokens/new?scopes=repo)
- [GitHub REST API - Authentication](https://docs.github.com/en/rest/authentication)
- [GitHub Scopes Documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
