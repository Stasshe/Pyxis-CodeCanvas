export const initialFileContents: Record<string, string> = {
  '.gitignore': `# 依存関係
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# ビルド出力
dist/
build/

# 環境変数
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

`,
  'README.md': `# プロジェクトへようこそ

このプロジェクトはPyxisで作成されました。

---

## 使い方例

### Node.js コード例
\`\`\`javascript
const fs = require('fs');
fs.writeFileSync('hello.txt', 'Pyxisからこんにちは！');
const content = fs.readFileSync('hello.txt', 'utf8');
console.log(content);
\`\`\`

### LaTeX 数式例
$
E = mc^2\\\\
x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}
$

### 複数モニター・テーマ変更
- 設定パネルから「テーマカラー」「個別色設定」を変更できます。

### ファイル操作
- ファイルツリーでドラッグ＆ドロップや右クリックで新規作成・削除・リネーム可能。
- インポート/エクスポートでローカルファイルの追加やダウンロードもできます。

### Git 操作例
\`\`\`bash
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
\`\`\`


## Mermaid記法のリアルタイム編集
\`\`\`mermaid
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
\`\`\`
---

## よく使うコマンド
- \`ls\`, \`cd\`, \`cat\`, \`touch\`, \`mkdir\`, \`rm\`, \`cp\`, \`mv\`, \`echo\`, \`clear\`
- 詳細は \`/docs/unix-commands.md\` を参照

## 便利機能
- LaTeXプレビュー
- 複数モニター対応
- テーマカラー変更
- ファイルのインポート/ダウンロード
- Git/プロジェクトファイルのダウンロード
- Mermaid記法のリアルタイム編集
---

> Pyxisで快適な開発をお楽しみください！
`,
  'docs_getting-started.md': `# スタートガイド

このプロジェクトの使用方法について説明します。

1. コードエディタでファイルを編集
2. ターミナルでコマンド実行
3. Gitパネルで履歴管理
`,
  'docs_git-commands.md': `# Gitコマンドの使い方

Pyxisでは以下のGitコマンドが利用できます。

- **git init**: 新しいリポジトリを初期化
- **git add [ファイル]**: ファイルをステージに追加
- **git commit -m "メッセージ"**: 変更をコミット
- **git status**: 現在の状態を表示
- **git log**: コミット履歴を表示
- **git branch**: ブランチ一覧を表示
- **git checkout [ブランチ名]**: ブランチを切り替え
- **git checkout -b [新ブランチ名]**: 新しいブランチを作成して切り替え
- **git merge [ブランチ名]**: ブランチをマージ
- **git reset --hard [コミットID]**: 指定コミットまで巻き戻し
- **git revert [コミットID]**: 指定コミットを打ち消すコミットを作成

詳細は画面のGitパネルやヒストリーをご参照ください。
`,
  'docs_unix-commands.md': `# ターミナルで使えるUnixコマンド

Pyxisのターミナルでは以下のコマンドが利用できます（一部制限あり）。

- **ls**: ディレクトリの内容を表示
- **cd [ディレクトリ]**: ディレクトリを移動
- **pwd**: 現在のパスを表示
- **cat [ファイル]**: ファイルの内容を表示
- **touch [ファイル]**: 空ファイルを作成
- **mkdir [ディレクトリ]**: ディレクトリを作成
- **rm [ファイル/ディレクトリ]**: ファイルやディレクトリを削除
- **cp [元] [先]**: ファイルをコピー
- **mv [元] [先]**: ファイルを移動/リネーム
- **echo [文字列]**: 文字列を表示
- **clear**: 画面をクリア

※ npmコマンドは現在開発中です。

詳細はターミナルで**help**コマンドを実行してください。
`,
  'src_fileOperationg.js': `const fs = require('fs').promises;
const triviaList = [
  'カンガルーの赤ちゃんは生まれたとき2cmしかない！',
  '富士山は1707年に噴火している！',
  'バナナは実はベリー類に分類される！',
  '日本では縦書きが一般的だけど、横書きの起源はタイプライターにあると言われてる！'
];

async function saveRandomTrivia() {
  const randomTrivia = triviaList[Math.floor(Math.random() * triviaList.length)];
  const data = { date: new Date().toISOString(), trivia: randomTrivia };
  try {
    await fs.writeFile('trivia.json', JSON.stringify(data, null, 2), 'utf8');
    console.log('今日の豆知識を保存しました:');
    console.log(randomTrivia);
  } catch (error) {
    console.error('保存中にエラーが発生しました:', error.message);
  }
}

saveRandomTrivia();
`,
  'src_index.js': `// メインエントリーポイント
console.log("Hello, World!");

// 配列処理の例
const arr = [1, 2, 3, 4];
const squared = arr.map(x => x * x);
console.log("二乗した配列:", squared);

// 非同期処理の例
async function getData() {
  return await new Promise(res => setTimeout(() => res("1秒経ちました。"), 1000));
}
getData().then(console.log);

// プロジェクトのコードをここに記述してください
`,
};
