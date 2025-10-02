# GitHub連携ドキュメント

## 概要

Pyxis-CodeCanvasは、Personal Access Token (PAT) を使用したGitHub認証により、完全なGit操作とGitHubへのプッシュ機能を提供します。

## アーキテクチャ

### 主要コンポーネント

1. **authRepository** - 認証情報の管理
2. **githubUserManager** - GitHubユーザー情報の管理
3. **GitCommands** - Git操作の実行
4. **GitHubAPI** - GitHub Git Data APIとの通信
5. **TreeBuilder** - ローカルGitツリーのGitHub上への再構築

---

## 1. 認証システム (AuthRepository)

### ファイル: `src/engine/core/authRepository.ts`

### 機能

Personal Access Token (PAT) を **暗号化** してIndexedDBに保存し、GitHub APIアクセス時に復号化して使用します。

### 主要メソッド

#### `saveAuth(authData: GitHubAuthData): Promise<void>`
- PATとユーザー情報を暗号化して保存
- IndexedDBの `PyxisAuth` データベースに格納
- トークンは暗号化され、平文では保存されない

```typescript
await authRepository.saveAuth({
  accessToken: 'ghp_xxxxxxxxxxxxx',
  user: {
    login: 'username',
    name: 'User Name',
    email: 'user@example.com',
    avatar_url: 'https://...',
    id: 12345,
  },
  createdAt: Date.now(),
});
```

#### `getAccessToken(): Promise<string | null>`
- 保存されたトークンを復号化して取得
- 認証が必要な操作で使用

```typescript
const token = await authRepository.getAccessToken();
if (!token) {
  throw new Error('GitHub authentication required');
}
```

#### `getUser(): Promise<GitHubUser | null>`
- 保存されたユーザー情報を取得

#### `clearAuth(): Promise<void>`
- 認証情報を削除（サインアウト）
- 暗号化キーもクリア

### データ構造

```typescript
interface GitHubUser {
  login: string;           // GitHubユーザー名
  name: string | null;     // 表示名
  email: string | null;    // メールアドレス
  avatar_url: string;      // アバター画像URL
  id: number;              // GitHub ID
}

interface GitHubAuthData {
  accessToken: string;     // Personal Access Token
  user: GitHubUser;        // ユーザー情報
  expiresAt?: number;      // 有効期限（オプション）
  createdAt: number;       // 作成日時
}
```

### セキュリティ

- ✅ トークンは暗号化されて保存（Web Crypto API使用）
- ✅ 暗号化キーはメモリ上に保持
- ✅ サインアウト時に暗号化キーをクリア
- ✅ 復号化失敗時は自動的に認証情報をクリア

---

## 2. ユーザー情報管理 (GitHubUserManager)

### ファイル: `src/engine/core/githubUserManager.ts`

### 機能

GitHub APIからユーザー情報を取得し、**5分間キャッシュ**します。React Context外からもアクセス可能なシングルトンです。

### 主要メソッド

#### `getUser(): Promise<GitHubUser | null>`
- ユーザー情報を取得（キャッシュあり）
- キャッシュが有効な場合はAPIコールなし
- 未認証の場合は `null` を返す

```typescript
const user = await githubUserManager.getUser();
if (user) {
  console.log('Logged in as:', user.login);
}
```

#### `getCommitAuthor(): Promise<GitCommitAuthor>`
- Git コミット用のAuthor情報を取得
- ログイン済みの場合はGitHubユーザー情報を使用
- 未ログインの場合はデフォルト値を返す

```typescript
const author = await githubUserManager.getCommitAuthor();
// => { name: 'User Name', email: 'user@example.com' }
```

#### `refreshUser(): Promise<GitHubUser | null>`
- キャッシュをクリアして強制的にAPIから再取得

#### `getCachedUser(): GitHubUser | null`
- キャッシュされたユーザー情報を即座に取得（APIコールなし）

### データ構造

```typescript
interface GitHubUser {
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  twitter_username: string | null;
  public_repos: number;
  public_gists: number;
  followers: number;
  following: number;
  created_at: string;
  updated_at: string;
}

interface GitCommitAuthor {
  name: string;
  email: string;
}
```

### 内部動作

1. `authRepository.getAccessToken()` でトークンを取得
2. GitHub API `GET /user` にリクエスト
3. レスポンスをキャッシュ（5分間有効）
4. 次回のアクセスはキャッシュから返す

---

## 3. Git操作 (GitCommands)

### ファイル: `src/engine/cmd/git.ts`

### 機能

isomorphic-gitを使用したローカルGit操作と、GitHubへのプッシュ機能を提供します。

### コミット操作

#### `commit(message: string, author?): Promise<string>`

コミットを作成します。**GitHub認証済みの場合は自動的にGitHubユーザー情報を使用**します。

```typescript
const gitCommands = new GitCommands(projectName, projectId);

// GitHub認証済みの場合、自動的にGitHubユーザー情報が使用される
await gitCommands.commit('feat: add new feature');

// 手動でauthorを指定することも可能
await gitCommands.commit('fix: bug fix', {
  name: 'Custom Name',
  email: 'custom@example.com'
});
```

**内部処理:**
1. `authRepository.getAccessToken()` でトークンを確認
2. トークンがある場合、`GET /user` APIでユーザー情報を取得
3. 取得したユーザー情報を author/committer として使用
4. トークンがない場合はデフォルト値を使用

---

### リモート操作

#### `addRemote(remote: string, url: string): Promise<string>`

リモートリポジトリを追加します。

```typescript
await gitCommands.addRemote('origin', 'https://github.com/owner/repo.git');
// => "Remote 'origin' added: https://github.com/owner/repo.git"
```

#### `listRemotes(): Promise<string>`

登録されているリモートの一覧を取得します。

```typescript
const remotes = await gitCommands.listRemotes();
// => "origin\thttps://github.com/owner/repo.git"
```

#### `deleteRemote(remote: string): Promise<string>`

リモートを削除します。

```typescript
await gitCommands.deleteRemote('origin');
// => "Remote 'origin' deleted."
```

---

### プッシュ操作

#### `push(options?: PushOptions): Promise<string>`

GitHubにプッシュします。**GitHub Git Data APIを使用**した完全なプッシュ実装です。

```typescript
interface PushOptions {
  remote?: string;   // デフォルト: 'origin'
  branch?: string;   // デフォルト: 現在のブランチ
  force?: boolean;   // デフォルト: false
}

// 基本的な使用
await gitCommands.push();
// => "Successfully pushed to origin/main"

// オプション指定
await gitCommands.push({
  remote: 'origin',
  branch: 'develop',
  force: false
});
```

**プッシュの内部フロー:**

1. **認証確認**: `authRepository.getAccessToken()` でPATを取得
2. **リモート確認**: 指定されたリモート（デフォルト: origin）の存在確認
3. **GitHub URL解析**: リモートURLからowner/repoを抽出
4. **ローカルコミット取得**: 現在のブランチの最新コミットを取得
5. **リモート状態確認**: GitHub APIでリモートブランチのHEADを取得
6. **ツリー構築**: `TreeBuilder` でローカルのGitツリーをGitHub上に再構築
7. **コミット作成**: GitHub APIでコミットオブジェクトを作成
8. **参照更新**: GitHub APIでブランチの参照を更新

---

## 4. GitHub API連携 (GitHubAPI)

### ファイル: `src/engine/cmd/gitOperations/github/GitHubAPI.ts`

### 機能

GitHub Git Data API (REST API) を使用して、Git操作を行います。

### 主要メソッド

#### `getRef(branch: string): Promise<GitRef | null>`
- ブランチの参照情報を取得
- `GET /repos/{owner}/{repo}/git/refs/heads/{branch}`

```typescript
const ref = await githubAPI.getRef('main');
// => { ref: 'refs/heads/main', object: { sha: 'abc123...', type: 'commit' } }
```

#### `updateRef(branch: string, sha: string, force: boolean): Promise<GitRef>`
- ブランチの参照を更新（プッシュの最終ステップ）
- `PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}`
- ブランチが存在しない場合は自動的に作成

```typescript
await githubAPI.updateRef('main', 'abc123...', false);
```

#### `createCommit(data): Promise<GitCommit>`
- コミットオブジェクトを作成
- `POST /repos/{owner}/{repo}/git/commits`

```typescript
const commit = await githubAPI.createCommit({
  message: 'feat: add feature',
  tree: 'tree_sha',
  parents: ['parent_sha'],
  author: {
    name: 'User Name',
    email: 'user@example.com',
    date: '2025-10-02T00:00:00Z'
  },
  committer: {
    name: 'User Name',
    email: 'user@example.com',
    date: '2025-10-02T00:00:00Z'
  }
});
```

#### `createTree(tree: GitTreeEntry[], baseTree?: string): Promise<GitTree>`
- ツリーオブジェクトを作成
- `POST /repos/{owner}/{repo}/git/trees`

```typescript
const tree = await githubAPI.createTree([
  { path: 'file.txt', mode: '100644', type: 'blob', sha: 'blob_sha' },
  { path: 'dir', mode: '040000', type: 'tree', sha: 'tree_sha' }
]);
```

#### `createBlob(content: string, encoding: 'utf-8' | 'base64'): Promise<GitBlob>`
- Blobオブジェクトを作成（ファイル内容）
- `POST /repos/{owner}/{repo}/git/blobs`

```typescript
const blob = await githubAPI.createBlob('console.log("hello")', 'utf-8');
// => { sha: 'blob_sha', ... }
```

### 認証

全てのAPIリクエストに以下のヘッダーを付与します:

```typescript
headers: {
  'Authorization': `Bearer ${token}`,
  'Accept': 'application/vnd.github.v3+json',
  'Content-Type': 'application/json'
}
```

---

## 5. ツリービルダー (TreeBuilder)

### ファイル: `src/engine/cmd/gitOperations/github/TreeBuilder.ts`

### 機能

ローカルのGitツリー構造を、GitHub上に再構築します。

### 主要メソッド

#### `buildTree(commitOid: string): Promise<string>`

コミットのツリーをGitHub上に再帰的に構築し、ルートツリーのSHAを返します。

```typescript
const treeBuilder = new TreeBuilder(fs, dir, githubAPI);
const treeSha = await treeBuilder.buildTree('commit_oid');
// => 'tree_sha_on_github'
```

### 内部処理フロー

1. **コミット読み込み**: ローカルのコミットオブジェクトを読み込む
2. **ツリー走査**: ツリーを再帰的に走査
3. **Blob処理**:
   - ローカルのBlobを読み込む
   - バイナリ判定（UTF-8 or Base64）
   - GitHub APIでBlobを作成
   - SHAをキャッシュ（重複アップロード防止）
4. **サブツリー処理**: 再帰的にサブツリーを構築
5. **ツリー作成**: GitHub APIでツリーオブジェクトを作成

### バイナリ判定

```typescript
private isBinaryContent(content: Uint8Array): boolean {
  // 最初の8000バイトをチェック
  const sample = content.slice(0, Math.min(content.length, 8000));
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return true; // NULL文字が含まれる場合はバイナリ
  }
  return false;
}
```

### Blobキャッシュ

同じ内容のファイルは一度だけアップロードし、SHAを再利用します。

```typescript
private blobCache: Map<string, string> = new Map(); // content -> sha
```

---

## 6. GitHub URL解析

### ファイル: `src/engine/cmd/gitOperations/github/utils.ts`

### 機能

GitリモートURLからowner/repoを抽出します。

```typescript
function parseGitHubUrl(url: string): { owner: string; repo: string } | null
```

### サポートされる形式

```typescript
// HTTPS形式
parseGitHubUrl('https://github.com/owner/repo.git')
// => { owner: 'owner', repo: 'repo' }

parseGitHubUrl('https://github.com/owner/repo')
// => { owner: 'owner', repo: 'repo' }

// SSH形式
parseGitHubUrl('git@github.com:owner/repo.git')
// => { owner: 'owner', repo: 'repo' }

// 非GitHubのURL
parseGitHubUrl('https://gitlab.com/owner/repo.git')
// => null
```

---

## 実際の使用例

### 1. ユーザー認証

```typescript
// MenuBar.tsx で実装済み
import { authRepository } from '@/engine/core/authRepository';

// PATでサインイン
const response = await fetch('https://api.github.com/user', {
  headers: {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github+json',
  },
});

const userData = await response.json();

await authRepository.saveAuth({
  accessToken: pat,
  user: {
    login: userData.login,
    name: userData.name,
    email: userData.email,
    avatar_url: userData.avatar_url,
    id: userData.id,
  },
  createdAt: Date.now(),
});
```

### 2. コミット作成

```typescript
// GitPanel.tsx で実装済み
const gitCommands = new GitCommands(projectName, projectId);

// ファイルをステージング
await gitCommands.add('src/file.ts');

// コミット（GitHub認証済みなら自動的にユーザー情報が使われる）
await gitCommands.commit('feat: add new feature');
```

### 3. GitHubへのプッシュ

```typescript
const gitCommands = new GitCommands(projectName, projectId);

// リモートを追加（初回のみ）
await gitCommands.addRemote('origin', 'https://github.com/owner/repo.git');

// プッシュ
try {
  const result = await gitCommands.push();
  console.log(result); // => "Successfully pushed to origin/main"
} catch (error) {
  console.error('Push failed:', error.message);
}
```

### 4. エラーハンドリング

```typescript
try {
  await gitCommands.push();
} catch (error) {
  if (error.message.includes('authentication required')) {
    // 認証が必要
    alert('GitHubにサインインしてください');
  } else if (error.message.includes('not found')) {
    // リモートが見つからない
    alert('リモートリポジトリが設定されていません');
  } else {
    // その他のエラー
    alert(`プッシュに失敗しました: ${error.message}`);
  }
}
```

---

## セキュリティ考慮事項

### 1. トークンの保護

- ✅ **暗号化**: PATはWeb Crypto APIで暗号化されてIndexedDBに保存
- ✅ **メモリ保持**: 暗号化キーはメモリ上のみに保持
- ✅ **自動クリア**: サインアウト時に暗号化キーをクリア
- ✅ **HTTPS通信**: 全てのGitHub API通信はHTTPS

### 2. トークンのスコープ

PATには以下のスコープが必要です:

- `repo` - プライベートリポジトリへのフルアクセス
  - `repo:status` - コミットステータスへのアクセス
  - `repo_deployment` - デプロイステータスへのアクセス
  - `public_repo` - パブリックリポジトリへのアクセス
  - `repo:invite` - リポジトリへの招待

### 3. トークンの有効期限

- GitHub PATには有効期限があります（7日、30日、60日、90日、カスタム、無期限）
- 有効期限切れの場合は再度サインインが必要
- 将来的には `expiresAt` フィールドを使用した自動チェックを実装予定

---

## トラブルシューティング

### プッシュが失敗する

**症状**: `Push failed: GitHub authentication required`

**解決策**:
1. MenuBarのLogInアイコンをクリック
2. GitHubでPATを作成（`repo`スコープ）
3. PATを入力してサインイン

---

**症状**: `Push failed: Remote 'origin' not found`

**解決策**:
```typescript
await gitCommands.addRemote('origin', 'https://github.com/owner/repo.git');
```

---

**症状**: `Push failed: Only GitHub repositories are supported`

**解決策**:
- 現在はGitHubのみサポート
- GitLabやBitbucketはサポートされていません

---

### コミットのAuthor情報が正しくない

**症状**: コミットのAuthorが `User <user@pyxis.dev>` になる

**解決策**:
1. GitHubにサインインする
2. コミット時に自動的にGitHubユーザー情報が使用されます

---

## 参考リンク

- [GitHub REST API - Git Database](https://docs.github.com/en/rest/git)
- [GitHub Personal Access Tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [isomorphic-git Documentation](https://isomorphic-git.org/)
- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
