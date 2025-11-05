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
=== 利用可能なコマンド ===

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
    ワイルドカード対応: cp *.txt backup/
  
  mv <src> <dest> [options] - ファイル/ディレクトリを移動・リネーム
    -f, --force       - 確認なしで上書き
    -v, --verbose     - 詳細な情報を表示
    ワイルドカード対応: mv *.txt folder/, mv src/* dest/
  
  cat <file>          - ファイル内容を表示
  
  echo <text> [> file] - テキストを出力/ファイルに書き込み
    echo "text"       - テキストを出力
    echo "text" > file - ファイルに書き込み（上書き）
    echo "text" >> file - ファイルに追記
  
  tree [path] [options] - ディレクトリツリーを表示
    -a, --all         - 隠しファイルも表示
    -L <depth>        - 最大深度を指定 (例: tree -L 3)
  
  find [path] [options] - ファイルを検索
    -name <pattern>   - 名前で検索 (ワイルドカード対応)
    -type f|d         - タイプで検索 (f=ファイル, d=ディレクトリ)
  
  grep <pattern> <files> [options] - ファイル内容を検索
    -i, --ignore-case - 大文字小文字を区別しない
    -r, --recursive   - 再帰的に検索
    -n, --line-number - 行番号を表示

Export Commands:
  export --page <file or folder> - ページをエクスポート
  export --indexeddb             - IndexedDBの内容をエクスポート
  debug-db                       - IndexedDB・Lightning-FSの全データを出力
  memory-clean                   - 不要なデータを削除

Git Commands:
  git status                     - ステータスを確認
  git add <file|.|*>             - ファイルをステージング
  git commit -m "message"        - コミット
  git log [options]              - コミット履歴を表示
  git branch [name] [-d]         - ブランチ操作
  git checkout <branch> [-b]     - ブランチ切り替え
  git merge <branch> [options]   - ブランチをマージ
  git revert <commit>            - コミットを取り消し
  git reset [options] [file]     - リセット
  git diff [options] [file]      - 変更差分を表示
  git push [remote] [branch] [--force] - リモートへプッシュ
  git remote [options]           - リモートリポジトリ管理

NPM Commands: (開発中)
  npm init [--force]             - package.jsonを作成
  npm install [package] [flags]  - パッケージをインストール
  npm uninstall <package>        - パッケージをアンインストール
  npm list                       - インストール済みパッケージ一覧
  npm run <script>               - スクリプトを実行
  npm-size <package>             - パッケージサイズを計算

ヒント:
  - 'help <command>' で各コマンドの詳細ヘルプを表示
  - ワイルドカード（*, ?）が使用可能
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
  -type f|d           タイプで検索（f=ファイル, d=ディレクトリ）

例:
  find . -name "*.txt"         .txtファイルを検索
  find src/ -type f            src/内の全ファイルを検索
  find . -name "test*"         test で始まるファイルを検索`,

      grep: `grep - ファイル内容を検索

使用法:
  grep [OPTION]... PATTERN FILE...

オプション:
  -i, --ignore-case   大文字小文字を区別しない
  -r, --recursive     ディレクトリを再帰的に検索
  -n, --line-number   行番号を表示

例:
  grep "error" log.txt         log.txtから"error"を検索
  grep -i "warning" *.log      大文字小文字を区別せず検索
  grep -rn "TODO" src/         src/内を再帰的に検索（行番号付き）`,

      cat: `cat - ファイル内容を表示

使用法:
  cat FILE...

例:
  cat file.txt                 ファイルの内容を表示
  cat file1.txt file2.txt      複数ファイルを連結して表示`,

      echo: `echo - テキストを出力

使用法:
  echo [STRING]
  echo [STRING] > FILE
  echo [STRING] >> FILE

例:
  echo "Hello World"           テキストを出力
  echo "text" > file.txt       ファイルに書き込み（上書き）
  echo "text" >> file.txt      ファイルに追記`,

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
    };

    const helpText = helpTexts[command];
    if (helpText) {
      return helpText;
    }

    return `help: '${command}' に関するヘルプはありません。\n'help' で全コマンドのリストを表示します。`;
  }
}
