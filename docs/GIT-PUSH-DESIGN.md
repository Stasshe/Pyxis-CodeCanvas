# Git Push設計ドキュメント

## 問題の本質

isomorphic-gitとGitHub APIを使用したGit実装において、以下の根本的な問題があります:

```
1. ローカルでコミット作成 → SHA: abc123 (isomorphic-git)
2. GitHub APIでコミット作成 → SHA: def456 (GitHub API)
3. 同じ内容でも異なるSHAが生成される
```

## 設計の検討

### 試行錯誤した方法

#### ❌ 方法A: push後にfetchしてローカルブランチを上書き
```typescript
// push後
await fetch(fs, dir, { remote, branch });
await git.writeRef({ ref: `refs/heads/${branch}`, value: remoteSha });
```

**問題点:**
- ローカルの全履歴が消える
- fetchに時間がかかる
- 元のローカルコミットへの参照が失われる

#### ❌ 方法B: GitHub APIのコミットSHAでローカルオブジェクトを作成
```typescript
// GitHub APIで作成したSHAでローカルにコミットオブジェクトを書き込む
await git.writeObject({ type: 'commit', object: commitData, oid: remoteSha });
```

**問題点:**
- `git.writeObject`はOIDを指定しても、内容からSHAを再計算する
- GitHub APIのSHAと一致しない
- 低レベルAPIの直接操作が必要で複雑

### ✅ 採用した方法: ローカルとリモートの分離管理

## 最終設計

### 基本方針

1. **push後、ローカルブランチは更新しない**
   - `refs/heads/main` → ローカルコミットSHA (abc123)
   - ローカルの履歴を完全に保持

2. **リモート追跡ブランチのみ更新**
   - `refs/remotes/origin/main` → リモートコミットSHA (def456)
   - リモートの状態を記録

3. **次回のpull/fetchで同期**
   - リモートから最新のコミットを取得
   - ローカルとマージまたはrebase

### 実装

```typescript
export async function push(fs: FS, dir: string, options: PushOptions = {}) {
  // 1. ローカルコミット情報を取得
  const localCommit = await git.log({ fs, dir, depth: 1 });
  
  // 2. GitHub APIでツリーとコミットを作成
  const treeSha = await treeBuilder.buildTree(...);
  const remoteSha = await githubAPI.createCommit({...});
  
  // 3. GitHubのブランチ参照を更新
  await githubAPI.updateRef(branch, remoteSha, force);
  
  // 4. ローカルのリモート追跡ブランチのみ更新（重要!）
  await git.writeRef({
    fs, dir,
    ref: `refs/remotes/origin/${branch}`,
    value: remoteSha,
    force: true,
  });
  
  // ローカルブランチ (refs/heads/main) は更新しない!
}
```

### 状態の例

#### Push直後
```
Local:
  refs/heads/main → abc123 (ローカルコミット)
  refs/remotes/origin/main → def456 (リモートコミット)

Remote (GitHub):
  refs/heads/main → def456
```

#### 次回のPull後
```
Local:
  refs/heads/main → ghi789 (マージコミット)
  refs/remotes/origin/main → def456

コミット履歴:
  ghi789 (マージ)
   ├─ abc123 (ローカル)
   └─ def456 (リモート)
```

## 利点

### ✅ ローカル履歴の保持
- pushしても`git log`でローカルの履歴が見える
- 過去のコミットが消えない
- ローカルでの作業履歴が保護される

### ✅ 高速
- fetch不要
- リモート追跡ブランチの参照更新だけ（一瞬）

### ✅ 標準的なGitの動作
- VS Code, GitHub Desktop, git CLIと同じ動作
- `git push`後、ローカルブランチはそのまま
- リモート追跡ブランチだけが更新される

### ✅ 次回のpull/fetchで自動解決
- リモートから最新のコミットを取得
- isomorphic-gitの`merge`で自動マージ
- 競合がなければ自動的にfast-forward

## VS Code / vscode.devとの比較

### VS Code (Native Git)
```bash
$ git push
# ローカルブランチ: そのまま
# リモート追跡ブランチ: 更新
```

### Pyxis-CodeCanvas (isomorphic-git)
```typescript
await push(fs, dir, { remote: 'origin', branch: 'main' });
// ローカルブランチ: そのまま
// リモート追跡ブランチ: 更新
```

→ **同じ動作**

## 注意点

### diffの表示
- ローカルコミット (abc123) とリモートコミット (def456) で内容は同じだが、SHAが異なる
- `git diff abc123 def456` → 差分なし（内容が同じため）
- GitHistoryでは両方のコミットが表示されるが、内容は同じ

### 解決策
GitHistoryで重複コミットを検出:
```typescript
// コミットのツリーSHAとメッセージが同じ場合は同じコミットとみなす
if (commit1.tree === commit2.tree && commit1.message === commit2.message) {
  // 重複とみなして1つだけ表示
}
```

## 今後の改善

### オプション1: Pull時にローカルコミットをrebase
```typescript
// pull時に、ローカルコミットをリモートコミットに置き換え
await git.fetch(...);
await git.rebase({
  fs, dir,
  onto: 'origin/main',
  theirs: 'origin/main',
  ours: 'main',
});
```

### オプション2: Commit時にGitHub APIで直接作成
```typescript
// commitコマンド自体でGitHub APIを使用
// ローカルとリモートで最初から同じSHAになる
```

## まとめ

**現在の設計**は、シンプルで高速、かつ標準的なGitの動作を再現しています。

- ローカルとリモートで異なるSHAを持つことは問題ではない
- リモート追跡ブランチで状態を記録
- 次回のfetch/pullで自然に解決される

この設計により:
- ✅ ローカルの履歴が保持される
- ✅ push操作が高速
- ✅ 標準的なGitワークフローと一致
- ✅ VS Codeと同じ動作
