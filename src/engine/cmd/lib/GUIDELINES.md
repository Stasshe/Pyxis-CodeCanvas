# Pyxis Shell Library Guidelines

## 概要

`src/engine/cmd/lib/` は、Unix/POSIXコマンド実装のための共通ライブラリです。
各コマンドはこのライブラリを使用して、一貫性のある動作と高品質な実装を実現します。

## ライブラリ構成

```
lib/
├── index.ts      # エクスポート集約
├── fnmatch.ts    # パターンマッチング (POSIX fnmatch)
├── getopt.ts     # オプションパーサー (POSIX getopt)
├── expr.ts       # 式評価 (find, test, [ 用)
└── GUIDELINES.md # このドキュメント
```

## 使用方法

### 1. fnmatch - パターンマッチング

POSIX `fnmatch(3)` 準拠のワイルドカードマッチング。

```typescript
import { fnmatch, fnmatchBasename, FNM_CASEFOLD, FNM_PATHNAME } from '../../lib';

// 基本的な使用
fnmatch('*.ts', 'file.ts');        // 0 = マッチ
fnmatch('*.ts', 'file.js');        // 1 = 不一致

// フラグ
fnmatch('*.TS', 'file.ts', FNM_CASEFOLD);  // 大文字小文字無視
fnmatchBasename('*.ts', '/path/to/file.ts'); // basename のみマッチ
```

**使用するコマンド**: find, ls, tree, grep, case文

### 2. getopt/parseArgs - オプションパーサー

POSIX `getopt(3)` 準拠のオプション解析。

```typescript
import { parseArgs, GetOpt } from '../../lib';

// シンプルな使用法
const { flags, values, positional } = parseArgs(args, ['-n', '-L', '-I']);
if (flags.has('-r')) { /* recursive */ }
const count = values.get('-n') || '10';

// 高度な使用法（GNU getopt互換）
const parser = new GetOpt('abc:d::', ['help', 'verbose', 'file=']);
for (const opt of parser.parse(args)) {
  switch (opt.option) {
    case 'c': console.log(opt.argument); break;
    case 'help': showHelp(); break;
  }
}
```

**使用するコマンド**: 全コマンド

### 3. expr - 式評価

find, test, `[` などで使用する論理式評価。

```typescript
import { ExprParser, ExprBuilder, evaluate, type Expression } from '../../lib';

// カスタムパーサーの実装
class MyExprParser extends ExprParser<MyContext> {
  protected parsePredicate(): Expression | null {
    const tok = this.stream.peek();
    if (tok === '-name') {
      this.stream.consume();
      const pattern = this.stream.consume();
      return ExprBuilder.predicate('-name', [pattern], (ctx) => {
        return fnmatch(pattern, ctx.name) === 0;
      });
    }
    return null;
  }
}

// 評価
const result = evaluate(expr, context);
```

**使用するコマンド**: find, test, `[`

## 実装ガイドライン

### 1. オプション処理

すべてのコマンドは `parseArgs` または `GetOpt` を使用する。

```typescript
// 良い例
const { flags, values, positional } = parseArgs(args, ['-n', '-c']);

// 悪い例（直接パース）
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-n') { ... }
}
```

### 2. パターンマッチング

glob パターンには必ず `fnmatch` を使用する。

```typescript
// 良い例
import { fnmatch } from '../../lib';
if (fnmatch(pattern, filename) === 0) { ... }

// 悪い例（独自実装）
const regex = pattern.replace(/\*/g, '.*');
if (new RegExp(regex).test(filename)) { ... }
```

### 3. エラーメッセージ

POSIXスタイルのエラーメッセージを使用する。

```typescript
// 良い例
throw new Error(`ls: ${path}: No such file or directory`);
throw new Error(`grep: ${file}: Is a directory`);

// 悪い例
throw new Error(`File not found: ${path}`);
```

### 4. 終了コード

POSIX準拠の終了コードを返す。

| コード | 意味 |
|--------|------|
| 0 | 成功 |
| 1 | 一般的なエラー |
| 2 | 使用法エラー（不正なオプション等） |

## 対応オプション一覧

### ls
- `-a` : 隠しファイルを表示
- `-l` : 詳細表示
- `-R` : 再帰的に表示
- `-h` : サイズを人間可読形式で
- `-S` : サイズでソート
- `-t` : 更新日時でソート
- `-r` : 逆順ソート
- `-1` : 1行1ファイル

### grep
- `-i` : 大文字小文字無視
- `-v` : マッチしない行を表示
- `-n` : 行番号を表示
- `-c` : マッチ数のみ表示
- `-l` : ファイル名のみ表示
- `-r` : 再帰検索
- `-E` : 拡張正規表現
- `-F` : 固定文字列
- `-w` : 単語単位でマッチ
- `-H` : ファイル名を表示
- `-h` : ファイル名を非表示

### find
- `-name` : 名前でマッチ
- `-iname` : 大文字小文字無視で名前マッチ
- `-path` : パスでマッチ
- `-type` : タイプでフィルタ (f/d)
- `-maxdepth` : 最大深度
- `-mindepth` : 最小深度
- `-prune` : ディレクトリをスキップ
- `!`, `-not` : 否定
- `-o`, `-or` : OR
- `-a`, `-and` : AND
- `\(`, `\)` : グループ化

### tree
- `-a` : 隠しファイルを表示
- `-d` : ディレクトリのみ
- `-L` : 最大深度
- `-I` : 除外パターン（パイプ区切り可）
- `-P` : 表示パターン
- `-f` : フルパス表示
- `--noreport` : 統計非表示

### wc
- `-l` : 行数
- `-w` : 単語数
- `-c` : バイト数
- `-m` : 文字数

### head/tail
- `-n` : 行数指定
- `-c` : バイト数指定

### cat
- `-n` : 行番号表示
- `-b` : 非空行に行番号
- `-s` : 連続空行を圧縮
- `-E` : 行末に$表示

## 新規コマンド追加手順

1. `unixOperations/` に新しいコマンドファイルを作成
2. `UnixCommandBase` を継承
3. `../../lib` から必要なユーティリティをインポート
4. `index.ts` にエクスポートを追加
5. `unix.ts` にコマンドインスタンスとメソッドを追加
6. `builtins.ts` にシェルコマンドとして登録

## 参考資料

- POSIX.1-2017 Shell & Utilities
- GNU Coreutils
- BusyBox
