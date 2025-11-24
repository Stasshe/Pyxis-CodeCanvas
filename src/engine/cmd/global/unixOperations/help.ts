import { UnixCommandBase } from './base';

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
  Ctrl+C    - 現在のコマンドをキャンセル

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
    ${VAR}      - 変数の値を参照（明示的）
    例: NAME="John"; echo "Hello, $NAME"
  
  位置パラメータ（スクリプト内）:
    $0          - スクリプト名
    $1, $2, ... - 引数1、引数2、...
    $@          - 全ての引数
  
  算術展開:
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
  pyxis export --indexeddb       - IndexedDBの内容をエクスポート
  pyxis debug-db                 - IndexedDB・Lightning-FSの全データを出力
  pyxis memory-clean             - 不要なデータを削除
  pyxis fs-clean                 - /projects配下を全て削除
  pyxis git tree [--all]         - Gitファイルシステムのツリーを表示
  pyxis npm-size <package>       - パッケージサイズを計算
  pyxis i18n-clear [locale ns]   - 翻訳キャッシュを削除
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
`.trim();
  }

  private getCommandHelp(command: string): string {
    const helpTexts: Record<string, string> = {
      ls: `ls - ディレクトリの内容を一覧表示

使用法:
  ls [OPTION]... [FILE]...

オプション:
  -a, --all           隠しファイルも表示（.で始まるファイル）
  -l, --long          詳細情報を表示（サイズ、日時など）
  -R, --recursive     サブディレクトリも再帰的に表示
  --system            システムファイル（.gitなど）も表示

例:
  ls                  現在のディレクトリの内容を表示
  ls -a               隠しファイルも含めて表示
  ls -l src/          src/ディレクトリの詳細情報を表示
  ls -la              すべてのファイルを詳細表示`,

      cd: `cd - ディレクトリを変更

使用法:
  cd [OPTION]... DIRECTORY

オプション:
  --system            プロジェクト外への移動を許可

例:
  cd src              srcディレクトリに移動
  cd ..               親ディレクトリに移動
  cd                  プロジェクトルートに移動
  cd /projects/myapp  絶対パスで移動`,

      cp: `cp - ファイル/ディレクトリをコピー

使用法:
  cp [OPTION]... SOURCE DEST
  cp [OPTION]... SOURCE... DIRECTORY

オプション:
  -r, -R, --recursive ディレクトリを再帰的にコピー
  -f, --force         既存のファイルを確認なしで上書き
  -v, --verbose       詳細な情報を表示
  -n, --no-clobber    既存のファイルを上書きしない

例:
  cp file.txt backup.txt       ファイルをコピー
  cp -r src/ backup/           ディレクトリを再帰的にコピー
  cp *.txt backup/             複数ファイルをコピー
  cp file1 file2 dir/          複数ソースをディレクトリにコピー
  cp -v file.txt dest/         詳細情報を表示してコピー`,

      mv: `mv - ファイル/ディレクトリを移動またはリネーム

使用法:
  mv [OPTION]... SOURCE DEST
  mv [OPTION]... SOURCE... DIRECTORY

オプション:
  -f, --force         既存のファイルを確認なしで上書き
  -v, --verbose       詳細な情報を表示
  -n, --no-clobber    既存のファイルを上書きしない

例:
  mv old.txt new.txt           ファイルをリネーム
  mv file.txt dir/             ファイルを移動
  mv *.txt folder/             複数ファイルを移動
  mv file1 file2 dest/         複数ソースを移動
  mv -v src/* dest/            詳細情報を表示して移動`,

      rm: `rm - ファイル/ディレクトリを削除

使用法:
  rm [OPTION]... FILE...

オプション:
  -r, -R, --recursive ディレクトリを再帰的に削除
  -f, --force         確認なしで削除
  -v, --verbose       削除したファイルを表示

例:
  rm file.txt                  ファイルを削除
  rm -r dir/                   ディレクトリを再帰的に削除
  rm *.log                     パターンにマッチするファイルを削除
  rm -rf temp/                 強制的に削除`,

      mkdir: `mkdir - ディレクトリを作成

使用法:
  mkdir [OPTION]... DIRECTORY...

オプション:
  -p, --parents       親ディレクトリも必要に応じて作成

例:
  mkdir newdir                 ディレクトリを作成
  mkdir -p a/b/c               親ディレクトリも含めて作成`,

      tree: `tree - ディレクトリ構造をツリー表示

使用法:
  tree [OPTION]... [DIRECTORY]

オプション:
  -a, --all           隠しファイルも表示
  -L <depth>          最大表示深度を指定

例:
  tree                         現在のディレクトリをツリー表示
  tree src/                    src/ディレクトリをツリー表示
  tree -L 2                    深度2までのツリーを表示
  tree -a                      隠しファイルも含めて表示`,

      find: `find - ファイルを検索

使用法:
  find [PATH] [OPTION]...

オプション:
  -name <pattern>     名前で検索（ワイルドカード対応）
  -iname <pattern>    大文字小文字を区別せず名前で検索
  -type f|d           タイプで検索（f=ファイル, d=ディレクトリ）

例:
  find . -name "*.txt"         .txtファイルを検索
  find src/ -type f            src/内の全ファイルを検索
  find . -iname "TEST*"        大文字小文字を区別せず検索
  find . -name "test*"         test で始まるファイルを検索`,

      grep: `grep - ファイル内容を検索

使用法:
  grep [OPTION]... PATTERN FILE...
  command | grep [OPTION]... PATTERN

オプション:
  -i, --ignore-case   大文字小文字を区別しない
  -r, --recursive     ディレクトリを再帰的に検索
  -n, --line-number   行番号を表示

例:
  grep "error" log.txt         log.txtから"error"を検索
  grep -i "warning" *.log      大文字小文字を区別せず検索
  grep -rn "TODO" src/         src/内を再帰的に検索（行番号付き）
  cat file.txt | grep "pattern" パイプ経由で検索`,

      cat: `cat - ファイル内容を表示

使用法:
  cat FILE...

例:
  cat file.txt                 ファイルの内容を表示
  cat file1.txt file2.txt      複数ファイルを連結して表示
  cat file.txt | grep "error"  パイプで他のコマンドに渡す`,

      head: `head - ファイルの先頭行を表示

使用法:
  head [OPTION]... [FILE]

オプション:
  -n <N>              先頭N行を表示（デフォルト10行）

例:
  head file.txt                先頭10行を表示
  head -n 5 file.txt           先頭5行を表示
  cat file.txt | head -n 20    パイプ経由で先頭20行を表示`,

      tail: `tail - ファイルの末尾行を表示

使用法:
  tail [OPTION]... [FILE]

オプション:
  -n <N>              末尾N行を表示（デフォルト10行）

例:
  tail file.txt                末尾10行を表示
  tail -n 5 file.txt           末尾5行を表示
  cat file.txt | tail -n 20    パイプ経由で末尾20行を表示`,

      stat: `stat - ファイルの詳細情報を表示

使用法:
  stat FILE

例:
  stat file.txt                ファイルの詳細情報を表示
  stat src/                    ディレクトリの詳細情報を表示`,

      echo: `echo - テキストを出力

使用法:
  echo [STRING]
  echo [STRING] > FILE
  echo [STRING] >> FILE

例:
  echo "Hello World"           テキストを出力
  echo "text" > file.txt       ファイルに書き込み（上書き）
  echo "text" >> file.txt      ファイルに追記
  echo $(date)                 コマンド置換を使用`,

      touch: `touch - 空のファイルを作成

使用法:
  touch FILE...

例:
  touch newfile.txt            空のファイルを作成
  touch file1 file2 file3      複数のファイルを作成`,

      pwd: `pwd - 現在のディレクトリを表示

使用法:
  pwd

例:
  pwd                          現在のディレクトリパスを表示`,

      pipe: `パイプライン - コマンドの出力を別のコマンドの入力に渡す

使用法:
  command1 | command2 | command3

例:
  cat file.txt | grep "error" | head -n 5
    ↑ file.txtの内容から"error"を含む行を抽出し、最初の5行を表示
  
  ls -la | grep ".txt"
    ↑ 現在のディレクトリから.txtファイルのみを表示
  
  find . -name "*.js" | grep -v "node_modules"
    ↑ .jsファイルを検索し、node_modules以外を表示

パイプは複数のコマンドを連結し、データを流すように処理します。
各コマンドの標準出力が次のコマンドの標準入力になります。`,

      redirect: `リダイレクション - ファイル入出力の制御

使用法:
  command > file       標準出力をファイルに書き込み（上書き）
  command >> file      標準出力をファイルに追記
  command < file       標準入力をファイルから読み取り
  command 2> file      標準エラーをファイルに書き込み
  command 2>&1         標準エラーを標準出力にマージ
  command 1>&2         標準出力を標準エラーにマージ
  command &> file      標準出力と標準エラーを同じファイルに書き込み
  command N> file      ファイルディスクリプタNをファイルに書き込み

例:
  echo "Hello" > file.txt      file.txtに書き込み
  echo "World" >> file.txt     file.txtに追記
  cat < input.txt              input.txtから読み取り
  ls non_existent 2> errors.txt エラーをerrors.txtに保存
  ls -la > output.txt 2>&1     出力とエラーをoutput.txtに保存
  command &> all.log           出力とエラーを同じファイルに保存`,

      script: `シェルスクリプト - 複数のコマンドを自動化

使用法:
  sh script.sh [args]
  bash script.sh [args]
  ./script.sh [args]

スクリプト内で使用可能な機能:
  - 変数: VAR=value, $VAR
  - 位置パラメータ: $0, $1, $2, ..., $@
  - 算術展開: $((expr))
  - コマンド置換: $(command), \`command\`
  - 制御構文: if/then/else/fi, for/do/done, while/do/done
  - 条件: test, [ expr ]
  - ループ制御: break, continue

例（script.sh）:
  #!/bin/bash
  echo "Script name: $0"
  echo "First arg: $1"
  
  COUNT=0
  for i in {1..5}; do
    COUNT=$((COUNT + 1))
    echo "Iteration: $COUNT"
  done
  
  if [ -f "file.txt" ]; then
    cat file.txt
  else
    echo "File not found"
  fi

実行:
  sh script.sh arg1 arg2`,

      git: `Git - バージョン管理システム

基本コマンド:
  git status                   - 現在の状態を確認
  git add <file>               - ファイルをステージング
  git commit -m "message"      - コミット
  git log                      - コミット履歴を表示
  git diff                     - 変更差分を表示

ブランチ操作:
  git branch                   - ブランチ一覧を表示
  git branch <name>            - 新しいブランチを作成
  git checkout <branch>        - ブランチを切り替え
  git checkout -b <branch>     - ブランチを作成して切り替え
  git switch <ref>             - ブランチまたはコミットに切り替え
  git merge <branch>           - ブランチをマージ

リモート操作:
  git clone <url>              - リポジトリをクローン
  git fetch                    - リモートから変更を取得
  git pull                     - リモートから取得してマージ
  git push                     - リモートにプッシュ
  git remote -v                - リモート一覧を表示

詳細は 'help git-<command>' で確認してください。`,

      npm: `NPM - Node.jsパッケージマネージャー

基本コマンド:
  npm init                     - package.jsonを作成
  npm install                  - 全ての依存関係をインストール
  npm install <package>        - パッケージをインストール
  npm install <package> -D     - devDependenciesにインストール
  npm uninstall <package>      - パッケージをアンインストール
  npm list                     - インストール済みパッケージ一覧
  npm run <script>             - package.jsonのスクリプトを実行

例:
  npm init                     - package.jsonを対話的に作成
  npm install react            - Reactをインストール
  npm install --save-dev jest  - Jestを開発依存関係として追加
  npm run build                - ビルドスクリプトを実行`,

      node: `Node.js - JavaScriptランタイム

使用法:
  node <file.js> [args(path)]

機能:
  - js, tsの実行`,
    };

    const helpText = helpTexts[command];
    if (helpText) {
      return helpText;
    }

    return `help: '${command}' に関するヘルプはありません。\n'help' で全コマンドのリストを表示します。`;
  }
}
