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
E = mc^2\\
x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}
$

### 複数モニター・テーマ変更
- 設定パネルから「テーマカラー」「個別色設定」を変更できます。

### ファイル操作
- ファイルツリーでドラッグ＆ドロップや右クリックで新規作成・削除・リネーム可能。
- インポート/エクスポートでローカルファイルの追加やダウンロードもできます。

### Git 操作例
```bash
# リポジトリ初期化
git init
# ファイル追加
git add .
# コミット
git commit -m "初期コミット"
# ブランチ作成・切替
git checkout -b feature/new-feature
# マージ
git merge feature/new-feature
```


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
---

> Pyxisで快適な開発をお楽しみください！
