export const commandHelpTexts: Record<string, string> = {
  ls: `ls - ディレクトリの内容を一覧表示

使用法:
  ls [OPTION]... [FILE]...

オプション:
  -a, --all           隠しファイルも表示（.で始まるファイル）
  -l, --long          詳細情報を表示（サイズ、日時など）
  -h, --human-readable サイズを人間が読みやすい形式で表示（-lと併用）
  -R, --recursive     サブディレクトリも再帰的に表示
  -t                  更新時刻でソート
  -r, --reverse       逆順でソート
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
  cd /absolute/path  絶対パスで移動`,

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
  -i, --interactive   上書き前に確認（実装は簡易）
  -n, --no-clobber    既存のファイルを上書きしない
  -v, --verbose       詳細な情報を表示

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

  help: `help - コマンドのヘルプを表示

使用法:
  help [command]

説明:
  引数なしで全コマンドの概要を表示します。引数にコマンド名を指定すると、そのコマンドの詳細な使用法を表示します。`,

  clear: `clear - 画面をクリア

使用法:
  clear

説明:
  ターミナル出力を消去してプロンプトを上に戻します。`,

  date: `date - 現在の日時を表示

使用法:
  date

説明:
  システムの現在日時を表示します。`,

  whoami: `whoami - 現在のユーザー名を表示

使用法:
  whoami

説明:
  実行中のセッションのユーザー名を出力します。`,

  unzip: `unzip - ZIPアーカイブを展開する

使用法:
  unzip [OPTION]... ARCHIVE [DEST]

オプション:
  -d <dir>           展開先ディレクトリを指定
  -l                 アーカイブ内容の一覧を表示

例:
  unzip archive.zip           カレントディレクトリに展開
  unzip -d out archive.zip    outディレクトリに展開
  unzip -l archive.zip        アーカイブ内容を表示`,

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

詳細は 'help git <command>' で確認してください。`,

  'git clone': `git clone - リモートリポジトリをクローン

使用法:
  git clone <repository-url> [directory]

説明:
  指定したリポジトリをプロジェクト内にクローンします。URLは http(s):// または git:// で始まる必要があります。
  クローン後、ファイルは IndexedDB に同期されます。`,

  'git status': `git status - 作業ツリーの状態を表示

使用法:
  git status

説明:
  変更されたファイルやステージされたファイルの一覧を表示します。`,

  'git add': `git add - ファイルをステージングエリアに追加

使用法:
  git add <path>

説明:
  指定ファイルを次回のコミット対象に追加します。ワイルドカード対応。`,

  'git commit': `git commit - コミットを作成

使用法:
  git commit -m "message"

説明:
  ステージ済みの変更をコミットします。-m でメッセージを指定してください。`,

  'git log': `git log - コミット履歴を表示

使用法:
  git log

説明:
  リポジトリのコミット履歴を表示します。`,

  'git checkout': `git checkout - ブランチまたはコミットに切り替え

使用法:
  git checkout <branch>
  git checkout -b <new-branch>

説明:
  既存ブランチに切り替えるか、-b で新規作成して切り替えます。`,

  'git switch': `git switch - ブランチを切り替える（新オプション）

使用法:
  git switch <branch>
  git switch -c <new-branch>

説明:
  より直感的にブランチを切り替えるためのコマンドです。`,

  'git branch': `git branch - ブランチ一覧/作成/削除

使用法:
  git branch [-d|-D|-a|-r] [name]

説明:
  ブランチを一覧表示、作成、または -d/-D で削除します。-a で全て、-r でリモートのみを表示します。`,

  'git revert': `git revert - コミットを取り消す新しいコミットを作成

使用法:
  git revert <commit>

説明:
  指定コミットの変更を打ち消す新しいコミットを作成します。`,

  'git reset': `git reset - インデックス/作業ツリーをリセット

使用法:
  git reset [--hard <commit>] [file]

説明:
  --hard を指定すると指定コミットまで作業ツリーとインデックスを強制的に戻します。`,

  'git diff': `git diff - 変更差分を表示

使用法:
  git diff [options] [commit1 commit2] [-- file]

説明:
  ステージ前の差分やコミット間の差分を表示します。--staged/--cached オプション対応。`,

  'git merge': `git merge - ブランチをマージ

使用法:
  git merge [--no-ff] [-m "message"] <branch>

説明:
  指定ブランチを現在のブランチにマージします。--no-ff や -m に対応。`,

  'git push': `git push - リモートにプッシュ

使用法:
  git push [remote] [branch] [--force]

説明:
  コミットをリモートに送信します。--force で強制プッシュを行います。`,

  'git remote': `git remote - リモートリポジトリ操作

使用法:
  git remote -v
  git remote add <name> <url>
  git remote remove <name>

説明:
  リモートの追加/削除/一覧表示を行います。`,

  'git show': `git show - コミットやファイルの詳細表示

使用法:
  git show <commit|file>

説明:
  指定コミットやファイルの内容・差分を表示します。`,

  'git fetch': `git fetch - リモートの更新を取得

使用法:
  git fetch [remote] [branch]

説明:
  指定リモート/ブランチの更新を取得します。`,

  'git pull': `git pull - リモートから取得してマージ

使用法:
  git pull [remote] [branch]

説明:
  fetch と merge を連続で実行します。`,

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

  'npm-install': `npm install - パッケージをインストール

使用法:
  npm install [package] [--save-dev|-D]

説明:
  package.json の依存関係を IndexedDB 内に反映し、必要なパッケージをダウンロードして node_modules 配下に配置します（シミュレート/最適化実装）。`,

  'npm-uninstall': `npm uninstall - パッケージをアンインストール

使用法:
  npm uninstall <package>

説明:
  package.json と node_modules（IndexedDB）から指定パッケージを削除します。`,

  'npm-list': `npm list - 依存関係一覧を表示

使用法:
  npm list

説明:
  package.json に記載された依存関係をツリー形式で表示します（IndexedDB ベース）。`,

  'npm-init': `npm init - package.json を作成

使用法:
  npm init [--force]

説明:
  プロジェクトの package.json を作成します。--force で上書きします。`,

  'npm-run': `npm run - package.json のスクリプト実行

使用法:
  npm run <script>

説明:
  package.json の scripts に定義されたコマンドを StreamShell 上で実行します。`,

  node: `Node.js - JavaScriptランタイム

使用法:
  node <file.js> [args(path)]

機能:
  - js, tsの実行`,
};
