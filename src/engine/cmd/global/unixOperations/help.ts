import { UnixCommandBase } from './base';
import { commandHelpTexts } from './helpTexts';

/**
 * help - ヘルプメッセージを表示
 *
 * 使用法:
 *   help [command]
 *
 * オプション:
 *   なし
 *
 * 動作:
 *   - 引数なし: 全コマンドのヘルプを表示
 *   - 引数あり: 指定されたコマンドの詳細ヘルプを表示
 */
export class HelpCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    if (args.length > 0) {
      return this.getCommandHelp(args[0]);
    }

    return this.getGeneralHelp();
  }

  private getGeneralHelp(): string {
    return `
=== Pyxis IDE Terminal - 利用可能なコマンド ===

Basic Commands:
  clear     - 画面をクリア
  help      - このヘルプを表示
  date      - 現在の日時を表示
  whoami    - ユーザー名を表示

Navigation:
  ↑/↓ 矢印キー - コマンド履歴を操作

File System Commands:
  pwd       - 現在のディレクトリを表示
  
  ls [path] [options] - ファイル一覧を表示
    -a, --all         - 隠しファイルも表示
    -l, --long        - 詳細リスト表示
    -R, --recursive   - 再帰的に全て表示
    --system          - システム全体（.gitも含む）表示
  
  cd <path> [options] - ディレクトリを変更
    --system          - システム全体への移動を許可
  
  mkdir <dir> [options] - ディレクトリを作成
    -p, --parents     - 親ディレクトリも作成
  
  touch <file>        - 空のファイルを作成
  
  rm <file> [options] - ファイル/ディレクトリを削除
    -r, -R, --recursive - ディレクトリを再帰的に削除
    -f, --force       - 確認なしで削除
    -v, --verbose     - 詳細な情報を表示
    ワイルドカード対応: rm *.txt, rm src/*.js
  
  cp <src> <dest> [options] - ファイル/ディレクトリをコピー
    -r, -R, --recursive - ディレクトリを再帰的にコピー
    -f, --force       - 確認なしで上書き
    -v, --verbose     - 詳細な情報を表示
    複数ソース対応: cp file1 file2 dir/, cp *.txt backup/
  
  mv <src> <dest> [options] - ファイル/ディレクトリを移動・リネーム
    -f, --force       - 確認なしで上書き
    -v, --verbose     - 詳細な情報を表示
    複数ソース対応: mv *.txt folder/, mv src/* dest/
  
  rename <old> <new>  - ファイル/ディレクトリをリネーム（mvのエイリアス）
  
  cat <file>          - ファイル内容を表示
  head <file> [-n N]  - ファイルの先頭N行を表示（デフォルト10行）
  tail <file> [-n N]  - ファイルの末尾N行を表示（デフォルト10行）
  stat <file>         - ファイルの詳細情報を表示
  
  echo <text>         - テキストを出力
    echo "text"       - テキストを出力
    echo "text" > file - ファイルに書き込み（上書き）
    echo "text" >> file - ファイルに追記
  
  tree [path] [options] - ディレクトリツリーを表示
    -a, --all         - 隠しファイルも表示
    -L <depth>        - 最大深度を指定 (例: tree -L 3)
  
  find [path] [options] - ファイルを検索
    -name <pattern>   - 名前で検索 (ワイルドカード対応)
    -iname <pattern>  - 大文字小文字を区別せず名前で検索
    -type f|d         - タイプで検索 (f=ファイル, d=ディレクトリ)
  
  grep <pattern> <files> [options] - ファイル内容を検索
    -i, --ignore-case - 大文字小文字を区別しない
    -r, --recursive   - 再帰的に検索
    -n, --line-number - 行番号を表示
    パイプ対応: cat file.txt | grep "pattern"
  
  unzip <archive> [dest] - ZIPファイルを解凍

Shell Features (StreamShell):
  パイプライン:
    command1 | command2 | command3
    例: cat file.txt | grep "error" | head -n 5
  
  リダイレクション:
    >  file     - 標準出力をファイルに書き込み（上書き）
    >> file     - 標準出力をファイルに追記
    <  file     - 標準入力をファイルから読み取り
    2> file     - 標準エラーをファイルに書き込み
    2>&1        - 標準エラーを標準出力にマージ
    1>&2        - 標準出力を標準エラーにマージ
    &> file     - 標準出力と標準エラーを同じファイルに書き込み
    3> file     - ファイルディスクリプタ3をファイルに書き込み
    例: ls -la > output.txt 2>&1
  
  ブレース展開:
    {a,b,c}     - a b c に展開
    {1..5}      - 1 2 3 4 5 に展開（数値範囲）
    {03..05}    - 03 04 05 に展開（ゼロパディング）
    file{.txt,.md,.js} - file.txt file.md file.js に展開
    例: echo {a,b}{1,2} → a1 a2 b1 b2
  
  コマンド置換:
    $(command)  - コマンドの出力を展開
    \`command\`  - コマンドの出力を展開（バッククォート）
    例: echo "Current dir: $(pwd)"
  
  変数:
    VAR=value   - 変数に値を代入
    $VAR        - 変数の値を参照
    例: NAME="John"; echo "Hello, $NAME"
  
  位置パラメータ（スクリプト内）:
    $0          - スクリプト名
    $1, $2, ... - 引数1、引数2、...
    $@          - 全ての引数
  
  算術展開: （対応中）
    $((expr))   - 算術式を評価
    例: echo $((5 + 3)) → 8
        COUNT=$((COUNT + 1))
  
  論理演算子:
    &&          - 前のコマンドが成功したら次を実行
    ||          - 前のコマンドが失敗したら次を実行
    例: mkdir dir && cd dir
        test -f file.txt || touch file.txt
  
  制御構文（シェルスクリプト内）:
    if condition; then
      commands
    elif condition; then
      commands
    else
      commands
    fi
    
    for var in list; do
      commands
    done
    
    while condition; do
      commands
    done
    
    break       - ループを抜ける
    continue    - 次のループへ
    
    例: 
      for i in {1..5}; do echo "Number: $i"; done
      if [ -f file.txt ]; then cat file.txt; else echo "File not found"; fi
  
  テスト演算子:
    test expr   - 条件式を評価
    [ expr ]    - 条件式を評価（testのエイリアス）
    -f file     - ファイルが存在するか
    -d dir      - ディレクトリが存在するか
    -n str      - 文字列が空でないか
    -z str      - 文字列が空か
    str1 = str2 - 文字列が等しいか
    n1 -eq n2   - 数値が等しいか
    n1 -gt n2   - n1 > n2
    n1 -lt n2   - n1 < n2
    !           - 条件を否定
  
  スクリプト実行:
    sh script.sh [args]  - シェルスクリプトを実行
    bash script.sh       - シェルスクリプトを実行（bashエイリアス）
    ./script.sh          - 実行可能スクリプトを実行
  
  ビルトインコマンド:
    type <cmd>  - コマンドの種類を表示
      -a        - 全ての定義を表示
      -t        - 種類のみ表示
      -p        - パスのみ表示
    true        - 常に成功（終了コード0）
    [           - testコマンドのエイリアス

Git Commands:
  git init                       - リポジトリ初期化（プロジェクト作成時に自動実行）
  git clone <url> [dir]          - リモートリポジトリをクローン
  git status                     - ステータスを確認
  git add <file|.|*>             - ファイルをステージング
  git commit -m "message"        - コミット
  git log [options]              - コミット履歴を表示
  git branch [name] [-d|-a|-r]   - ブランチ操作
    -d                           - ブランチを削除
    -a                           - 全てのブランチを表示（ローカル+リモート）
    -r                           - リモートブランチのみ表示
  git checkout <branch> [-b]     - ブランチ切り替え
  git switch <ref> [-c|--detach] - ブランチまたはコミットに切り替え
    -c, --create                 - 新しいブランチを作成して切り替え
    --detach                     - detached HEAD状態で切り替え
    origin/main                  - リモートブランチに切り替え
    <commit-hash>                - 特定のコミットに切り替え
  git merge <branch> [options]   - ブランチをマージ
    --no-ff                      - Fast-forwardを無効化
    -m "message"                 - マージコミットメッセージ
    --abort                      - マージを中断
  git revert <commit>            - コミットを取り消し
  git reset [options] [file]     - リセット
    --hard <commit>              - 指定コミットまでハードリセット
    <file>                       - ファイルをアンステージング
  git diff [options] [file]      - 変更差分を表示
    --staged, --cached           - ステージされた変更を表示
    <branch>                     - ブランチとの差分
    <commit1> <commit2>          - コミット間の差分
  git show <ref> [file]          - コミット情報またはファイル内容を表示
  git push [remote] [branch] [--force] - リモートへプッシュ
  git pull [remote] [branch] [--rebase] - リモートから取得してマージ
  git fetch [remote] [branch]    - リモートから変更を取得
    --all                        - 全てのリモートから取得
    --prune                      - 削除されたブランチを整理
    --tags                       - タグも取得
  git remote [options]           - リモートリポジトリ管理
    -v                           - リモート一覧を表示
    add <name> <url>             - リモートを追加
    remove <name>                - リモートを削除

NPM Commands:
  npm init [--force]             - package.jsonを作成
  npm install [package] [flags]  - パッケージをインストール
    --save-dev, -D               - devDependenciesに追加
    （引数なし）                 - package.jsonの全依存関係をインストール
  npm uninstall <package>        - パッケージをアンインストール
  npm list                       - インストール済みパッケージ一覧
  npm run <script>               - スクリプトを実行

Pyxis Commands:
  pyxis export --page <path>     - ページをエクスポート
  pyxis runtime-cache clear      - Node runtime の ~/.cache/pyxis を削除
  pyxis tmp clear                - Node runtime の /tmp を削除
  pyxis debug-db                 - IndexedDB・OPFSの情報を出力
  pyxis git tree [--all]         - Gitワークスペースのツリーを表示（--allは/全体）
  pyxis npm-size <package>       - パッケージサイズを計算
  pyxis i18n clear [locale namespace] - 翻訳キャッシュを削除
  pyxis storage-tree             - Pyxis Storageの内容を表示
  pyxis storage-clear [store]    - ストアを削除
  pyxis storage-get <store> <id> - エントリを取得
  pyxis storage-delete <store> <id> - エントリを削除
  pyxis storage-clean            - 期限切れエントリを削除
  pyxis storage-stats            - ストレージ統計を表示

Node Runtime:
  node <file.js> [args]          - Node.jsスクリプトを実行
    相対パス対応: node ./src/index.js
    標準入力対応: スクリプト内でreadlineを使用可能

ヒント:
  - 'help <command>' で各コマンドの詳細ヘルプを表示
  - ワイルドカード（*, ?, [...]）が使用可能
  - パイプ（|）で複数コマンドを連結
  - リダイレクション（>, >>, <, 2>&1）でファイル入出力
  - ブレース展開（{a,b}, {1..5}）で複数引数を生成
  - コマンド置換（$(cmd), \`cmd\`）でコマンド出力を埋め込み
  - シェルスクリプト（.sh）で複雑な処理を自動化
  - Tab キーでファイル名補完（実装予定）
`;
  }

  private getCommandHelp(command: string): string {
    const helpText = commandHelpTexts[command];
    if (helpText) {
      return helpText;
    }

    return `help: '${command}' に関するヘルプはありません。\n'help' で全コマンドのリストを表示します。`;
  }
}
