# プロジェクトへようこそ

このプロジェクトはPyxisで作成されました。

---

## 使い方例

### Node.js コード例
```javascript
const fs = require('fs');
fs.writeFileSync('hello.txt', 'Pyxisからこんにちは！');
const content = fs.readFileSync('hello.txt', 'utf8');
console.log(content);
```

### LaTeX 数式例
$
E = mc^2
$
$
x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}
$

### 複数モニター・テーマ変更
- 設定パネルから「テーマカラー」「個別色設定」を変更できます。

### ファイル操作
- ファイルツリーでドラッグ＆ドロップや右クリックで新規作成・削除・リネーム可能。
- インポート/エクスポートでローカルファイルの追加やダウンロードもできます。

### Git 操作例
```bash
# ファイル追加
git add .
# コミット
git commit -m "初期コミット"
# ブランチ作成・切替
git checkout -b feature/new-feature
# マージ
git merge feature/new-feature
# diff
git diff [branchName]
```


### WebPreview機能でのリアルタイムプレビュー
Pyxisでは、`homepage` や `text-editor` フォルダなど、Webアプリのエントリポイントとなるフォルダを長押し（または右クリック）し、「WebPreview」を選択することで、埋め込みiframe内でリアルタイムにサイトをプレビューできます。


---

## Mermaid記法のリアルタイム編集
```mermaid
graph TB
    subgraph "ブラウザ IndexedDB"
        subgraph "pyxis-fs (lightning-fs)"
            GitFS[Git仮想ファイルシステム]
            GitObjects[.git/objects/]
            GitRefs[.git/refs/]
            GitHead[.git/HEAD]
            GitIndex[.git/index]
        end
        
        subgraph "PyxisProjects"
            Projects[projects テーブル]
            Files[files テーブル]
        end
    end
    
    subgraph "React メモリ状態"
        ProjectFiles[projectFiles state]
        Tabs[tabs state]
        ActiveTab[activeTabId state]
        NodeRuntimeFlag[nodeRuntimeOperationInProgress]
    end
    
    subgraph "UI コンポーネント"
        Terminal[Terminal.tsx]
        FileTree[FileTree.tsx]
        Editor[CodeEditor.tsx]
        RunPanel[RunPanel.tsx]
    end
    
    GitFS --> Terminal
    Projects --> ProjectFiles
    Files --> ProjectFiles
    ProjectFiles --> FileTree
    ProjectFiles --> Tabs
    Tabs --> Editor
    
    Terminal --> GitFS
    Editor --> Tabs
    RunPanel --> GitFS
    RunPanel --> Files
```
---

## よく使うコマンド
- `ls`, `cd`, `cat`, `touch`, `mkdir`, `rm`, `cp`, `mv`, `echo`, `clear`
- 詳細は `/docs/unix-commands.md` を参照

## 便利機能
- LaTeXプレビュー
- 複数モニター対応
- テーマカラー変更
- ファイルのインポート/ダウンロード
- Git/プロジェクトファイルのダウンロード
- Mermaid記法のリアルタイム編集

## 新機能

#### AI Agent (Edit/Ask)
- AIと対話してコードの編集や質問が可能。

#### iframeを用いたHMRライクな開発環境
- 埋め込みiframe内でリアルタイムに変更をプレビュー可能。(ファイル一覧から、WebPreviewを押してください)

#### インポート機能の強化
- zipファイル、画像、PDFなどのバッファコンテンツをインポート可能。
- unzipコマンド対応でファイルを展開可能。
---

> Pyxisで快適な開発をお楽しみください！
