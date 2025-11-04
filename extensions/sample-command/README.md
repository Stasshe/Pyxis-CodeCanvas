# Sample Command Extension

カスタムターミナルコマンドを追加するサンプル拡張機能

## 概要

この拡張機能は、Pyxisのターミナルに新しいコマンドを追加する方法を示すサンプルです。

## 提供するコマンド

### `hello [name]`

挨拶メッセージを表示します。

**使用例:**
```bash
$ hello
Hello, World!
Project: my-project
Current Directory: /projects/my-project

$ hello Pyxis
Hello, Pyxis!
Project: my-project
Current Directory: /projects/my-project
```

### `fileinfo <filepath>`

指定されたファイルの詳細情報を表示します。

**使用例:**
```bash
$ fileinfo index.js
File Information:
  Path: /projects/my-project/index.js
  Type: File
  Size: 1234 bytes
  Modified: 2025-11-04T12:00:00.000Z
  Mode: 100644

First 5 lines:
  1: import React from 'react';
  2: 
  3: function App() {
  4:   return <div>Hello</div>;
  5: }
  ... (10 more lines)
```

## 開発

```bash
# 拡張機能をビルド
pnpm run setup-build

# 開発サーバー起動
pnpm run dev
```

## 使い方

1. Pyxisを開く
2. 拡張機能パネルから「Sample Command Extension」を有効化
3. ターミナルで `hello` または `fileinfo` コマンドを使用

## 技術詳細

### コマンド登録

```typescript
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  if (context.commands) {
    // コマンドを登録
    context.commands.registerCommand('hello', async (args, ctx) => {
      return `Hello, ${args.join(' ') || 'World'}!`;
    });
  }
  
  return {};
}
```

### コマンドハンドラー

コマンドハンドラーは以下の引数を受け取ります：

- `args: string[]` - コマンドライン引数
- `context: CommandContext` - 実行コンテキスト
  - `projectName: string` - プロジェクト名
  - `projectId: string` - プロジェクトID
  - `currentDirectory: string` - 現在のディレクトリ
  - `fileSystem: any` - Pyxisのファイルシステムインスタンス

ハンドラーは `Promise<string>` を返し、その文字列がターミナルに出力されます。

## ファイル構成

- `index.ts` - メインコード
- `manifest.json` - 拡張機能のメタデータ
- `README.md` - このファイル

## License

MIT
