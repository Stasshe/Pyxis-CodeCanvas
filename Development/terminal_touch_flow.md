# ターミナルから `touch` コマンドでファイル作成時の関数実行フロー

---

## 1. ユーザーがターミナルで `touch ファイル名` を入力
- 例: `touch test.txt`

## 2. Terminal.tsx の processCommand 関数がコマンドをパース
- `case 'touch': ...` に分岐
- `unixCommandsRef.current.touch(args[0])` を呼び出す

## 3. UnixCommands クラスの `touch` メソッドが実行
- ファイルパスを正規化
- 既存ファイルチェック
- 存在しなければ親ディレクトリ作成
- `fs.promises.writeFile(normalizedPath, '')` で空ファイル作成
- `flushFileSystemCache()` でキャッシュ同期
- **IndexedDB同期**: `onFileOperation(relativePath, 'file', '')` を呼び出す
    - `onFileOperation` は Terminal コンポーネントの props で渡されている

## 4. Terminal.tsx の onFileOperation が呼ばれる
- 実体は `handleFileOperation` (src/utils/handleFileOperation.ts)
- 引数: path, type='file', content='', ...
- IndexedDBへファイル保存 (`saveFile`)
- UIのタブ・ファイルリスト更新
- 必要に応じて `setGitRefreshTrigger` などでUI再描画

## 5. 完了
- ファイルは IndexedDBに保存され、UIにも反映される
- ターミナルには "File created: ..." と出力

---

## 関連ファイル・関数
- src/components/Terminal.tsx
    - processCommand
    - onFileOperation
- src/utils/cmd/unix.ts
    - UnixCommands.touch
- src/utils/handleFileOperation.ts
    - handleFileOperation

---

## 補足
- `onFileOperation` の流れは FileTree からの操作でも同じだが、呼び出し元が異なる
- UI反映は `handleFileOperation` 内の `saveFile` と `refreshProjectFiles` などで行われる
