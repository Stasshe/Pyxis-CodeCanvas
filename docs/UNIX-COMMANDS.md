# Unix Commands Implementation

## 概要

Pyxis CodeCanvasのUnixコマンド実装は、実際のLinux/Ubuntuの動作に可能な限り近づけた設計になっています。新アーキテクチャ（NEW-ARCHITECTURE.md）に基づき、**IndexedDBを唯一の真実の源**として、ファイル操作を自動的にGitFileSystemに同期します。

## アーキテクチャ

```
TerminalUnixCommands.tsx (UI層)
    ↓
UnixCommands (統合クラス)
    ↓
各コマンドクラス (unix-commands/*)
    ↓
UnixCommandBase (共通基底クラス)
    ↓
fileRepository (IndexedDB) ← 書き込み操作
    ↓ 自動同期
gitFileSystem (lightning-fs) ← 読み取り操作
```

## ディレクトリ構造

```
src/engine/cmd/
├── unix.ts                      # UnixCommands統合クラス
└── unix-commands/
    ├── base.ts                  # 共通基底クラス
    ├── index.ts                 # エクスポート
    ├── cat.ts                   # ファイル表示
    ├── cd.ts                    # ディレクトリ変更
    ├── cp.ts                    # コピー
    ├── echo.ts                  # テキスト出力
    ├── find.ts                  # ファイル検索
    ├── grep.ts                  # テキスト検索
    ├── help.ts                  # ヘルプ表示
    ├── ls.ts                    # ディレクトリ一覧
    ├── mkdir.ts                 # ディレクトリ作成
    ├── mv.ts                    # 移動/リネーム
    ├── pwd.ts                   # カレントディレクトリ表示
    ├── rm.ts                    # 削除
    ├── touch.ts                 # ファイル作成
    └── tree.ts                  # ツリー表示
```

## 実装されたコマンド

### ファイル/ディレクトリ操作

#### `ls` - ディレクトリ一覧
```bash
ls [OPTION]... [FILE]...
```
**オプション:**
- `-a, --all`: 隠しファイルも表示
- `-l, --long`: 詳細情報を表示
- `-R, --recursive`: 再帰的に表示
- `--system`: システムファイル（.gitなど）も表示

**特徴:**
- ワイルドカード対応
- lightning-fsから直接読み取り（高速）

---

#### `cd` - ディレクトリ変更
```bash
cd [OPTION]... DIRECTORY
```
**オプション:**
- `--system`: プロジェクト外への移動を許可

**特徴:**
- デフォルトでプロジェクト内に制限
- `cd` のみでプロジェクトルートに移動

---

#### `mkdir` - ディレクトリ作成
```bash
mkdir [OPTION]... DIRECTORY...
```
**オプション:**
- `-p, --parents`: 親ディレクトリも作成

**特徴:**
- IndexedDBに作成 → 自動的にGitFileSystemに同期

---

#### `touch` - ファイル作成
```bash
touch FILE...
```
**特徴:**
- IndexedDBに作成 → 自動的にGitFileSystemに同期

---

#### `rm` - 削除
```bash
rm [OPTION]... FILE...
```
**オプション:**
- `-r, -R, --recursive`: ディレクトリを再帰的に削除
- `-f, --force`: 確認なしで削除
- `-v, --verbose`: 詳細な情報を表示

**特徴:**
- **ワイルドカード完全対応**: `rm *.txt`, `rm src/*.js`
- IndexedDBから削除 → 自動的にGitFileSystemからも削除

---

#### `cp` - コピー
```bash
cp [OPTION]... SOURCE DEST
cp [OPTION]... SOURCE... DIRECTORY
```
**オプション:**
- `-r, -R, --recursive`: ディレクトリを再帰的にコピー
- `-f, --force`: 確認なしで上書き
- `-v, --verbose`: 詳細な情報を表示
- `-n, --no-clobber`: 既存ファイルを上書きしない

**特徴:**
- **ワイルドカード完全対応**: `cp *.txt backup/`, `cp src/* dest/`
- 複数ソース対応
- ArrayBuffer（バイナリファイル）も正しくコピー

---

#### `mv` - 移動/リネーム
```bash
mv [OPTION]... SOURCE DEST
mv [OPTION]... SOURCE... DIRECTORY
```
**オプション:**
- `-f, --force`: 確認なしで上書き
- `-v, --verbose`: 詳細な情報を表示
- `-n, --no-clobber`: 既存ファイルを上書きしない

**特徴:**
- **ワイルドカード完全対応**: `mv *.txt folder/`, `mv src/* dest/`
- 複数ソース対応
- 単一ファイル移動 = リネーム
- 複数ファイル移動 = ディレクトリへ移動

---

### ファイル表示

#### `cat` - ファイル内容を表示
```bash
cat FILE...
```
**特徴:**
- lightning-fsから直接読み取り（Git用ワークスペース）

---

#### `echo` - テキスト出力
```bash
echo [STRING]
echo [STRING] > FILE
echo [STRING] >> FILE
```
**特徴:**
- `>`: 上書き
- `>>`: 追記
- IndexedDBに保存 → 自動的にGitFileSystemに同期

---

#### `pwd` - カレントディレクトリ表示
```bash
pwd
```
**特徴:**
- 現在のディレクトリパスを表示

---

### 検索コマンド

#### `tree` - ディレクトリツリー表示
```bash
tree [OPTION]... [DIRECTORY]
```
**オプション:**
- `-a, --all`: 隠しファイルも表示
- `-L <depth>`: 最大深度を指定

**特徴:**
- lightning-fsから直接読み取り
- 美しいツリー形式で表示

---

#### `find` - ファイル検索
```bash
find [PATH] [OPTION]...
```
**オプション:**
- `-name <pattern>`: 名前で検索（ワイルドカード対応）
- `-type f|d`: タイプで検索（f=ファイル, d=ディレクトリ）

**特徴:**
- IndexedDBから検索（高速）
- ワイルドカードパターン対応

---

#### `grep` - テキスト検索
```bash
grep [OPTION]... PATTERN FILE...
```
**オプション:**
- `-i, --ignore-case`: 大文字小文字を区別しない
- `-r, --recursive`: 再帰的に検索
- `-n, --line-number`: 行番号を表示

**特徴:**
- IndexedDBから検索（高速）
- 正規表現対応

---

### ヘルプ

#### `help` - ヘルプ表示
```bash
help [COMMAND]
```
**特徴:**
- 引数なし: 全コマンドのヘルプ
- 引数あり: 指定コマンドの詳細ヘルプ

---

## ワイルドカード対応

### サポートするワイルドカード
- `*`: 任意の文字列（0文字以上）
- `?`: 任意の1文字

### ワイルドカード展開の仕組み

1. **パターン検出**: コマンド引数にワイルドカードが含まれているか確認
2. **ディレクトリ走査**: lightning-fsを使って該当ディレクトリを走査
3. **パターンマッチ**: 正規表現に変換してマッチング
4. **パス展開**: マッチしたすべてのパスを配列として返す

### 実装例（`base.ts`）

```typescript
protected async expandPathPattern(pathPattern: string): Promise<string[]> {
  const resolvedPath = this.resolvePath(pathPattern);
  
  // ワイルドカードが含まれていない場合はそのまま返す
  if (!resolvedPath.includes('*') && !resolvedPath.includes('?')) {
    return [resolvedPath];
  }

  // パスを分割して再帰的に展開
  const parts = resolvedPath.split('/').filter(p => p);
  const results: string[] = [];
  await this.expandPathRecursive(parts, 0, '/', results);
  
  return results;
}
```

### ワイルドカード対応コマンド
- ✅ `rm *.txt`
- ✅ `cp *.js backup/`
- ✅ `mv src/* dest/`
- ✅ `find . -name "*.json"`

---

## データフロー

### 書き込み操作（mkdir, touch, rm, cp, mv, echo）

```
コマンド実行
    ↓
fileRepository.createFile() / saveFile() / deleteFile()
    ↓
IndexedDB（主データストア）
    ↓ 【自動・非同期】
syncManager.syncSingleFileToFS()
    ↓
gitFileSystem.writeFile() / deleteFile()
    ↓
lightning-fs（Git用ワークスペース）
```

### 読み取り操作（ls, cat, tree）

```
コマンド実行
    ↓
gitFileSystem.readFile() / fs.promises.readdir()
    ↓
lightning-fs（Git用ワークスペース）
```

---

## 新規コマンドの追加方法

### 1. コマンドクラスを作成

```typescript
// src/engine/cmd/global/git-commands/newcommand.ts
import { UnixCommandBase } from './base';

export class NewCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { options, positional } = this.parseOptions(args);
    
    // コマンドロジックを実装
    
    return 'result';
  }
}
```

### 2. `index.ts`にエクスポート追加

```typescript
export { NewCommand } from './newcommand';
```

### 3. `unix.ts`に統合

```typescript
import { NewCommand } from './unix-commands';

// コンストラクタ
this.newCmd = new NewCommand(projectName, this.currentDir, projectId);

// メソッド追加
async newCommand(args: string[]): Promise<string> {
  return await this.newCmd.execute(args);
}
```

### 4. `TerminalUnixCommands.tsx`にハンドラ追加

```typescript
case 'newcommand':
  const result = await unix.newCommand(args);
  await writeOutput(result);
  break;
```

---

## ベストプラクティス

### ✅ 推奨

1. **書き込みは常に`fileRepository`経由**
   ```typescript
   await fileRepository.createFile(projectId, path, content, 'file');
   ```

2. **読み取りは`lightning-fs`から**
   ```typescript
   const content = await this.fs.promises.readFile(path, { encoding: 'utf8' });
   ```

3. **ワイルドカード展開を活用**
   ```typescript
   const sources = await this.expandPathPattern(sourceArg);
   ```

4. **エラーメッセージはLinux風に**
   ```typescript
   throw new Error(`mv: cannot stat '${source}': No such file or directory`);
   ```

### ❌ 避けるべき

1. **`gitFileSystem.writeFile()`を直接呼ぶ**
   - IndexedDBと同期が取れなくなる

2. **同期処理を使う**
   - すべて非同期（async/await）で実装

3. **ハードコードされたパス**
   - 常に`normalizePath()`と`resolvePath()`を使用

---

## トラブルシューティング

### Q: ファイルがGitFileSystemに反映されない
A: `fileRepository`を使用していますか？`gitFileSystem.writeFile()`を直接呼んでいる場合、IndexedDBと同期が取れません。

### Q: ワイルドカードが動作しない
A: `expandPathPattern()`を使用していますか？また、lightning-fsにファイルが存在することを確認してください。

### Q: パスの解決がおかしい
A: `normalizePath()`と`resolvePath()`を正しく使用していますか？相対パスは常に`resolvePath()`で絶対パスに変換してください。

---

## 今後の拡張予定

- [ ] `ln` - シンボリックリンク作成
- [ ] `chmod` - パーミッション変更（制限付き）
- [ ] `head` / `tail` - ファイルの一部表示
- [ ] `wc` - 行数・単語数カウント
- [ ] `sed` - テキスト変換
- [ ] `awk` - テキスト処理
- [ ] `tar` - アーカイブ作成
- [ ] Tab補完機能

---

**最終更新**: 2025-10-03  
**バージョン**: 2.0 (新アーキテクチャ対応)
