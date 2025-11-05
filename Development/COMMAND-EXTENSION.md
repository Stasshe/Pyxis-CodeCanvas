
# Pyxis カスタムコマンド拡張機能 最新ガイド


## 概要

Pyxisの拡張機能システムでは、ターミナルに独自コマンドを追加できます。コマンドはExtensionContext経由で型安全に登録・実行され、Pyxisのファイルシステムやシステムモジュールにもアクセス可能です。

## 基本構造


### 1. マニフェストファイル (`manifest.json`)

```json
{
  "id": "pyxis.sample-command",
  "name": "Sample Command Extension",
  "version": "1.0.0",
  "type": "tool",
  "description": "ターミナルコマンドを追加するサンプル拡張機能",
  "author": "Pyxis Team",
  "entry": "index.js",
  "metadata": {
    "publishedAt": "2025-11-04T00:00:00.000Z",
    "updatedAt": "2025-11-04T00:00:00.000Z",
    "tags": ["command", "tool"]
  }
}
```


### 2. エントリーファイル (`index.ts`)

最新のサンプル実装（sample-command拡張機能）:

```typescript
import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

/**
 * helloコマンドの実装
 */
async function helloCommand(args: string[], context: any): Promise<string> {
  const name = args.length > 0 ? args.join(' ') : 'World';
  return `Hello, ${name}!\nProject: ${context.projectName}\nCurrent Directory: ${context.currentDirectory}`;
}

/**
 * fileinfoコマンドの実装
 * 指定されたファイルの情報を表示
 * SSOT: fileRepository を使用
 */
async function fileinfoCommand(args: string[], context: any): Promise<string> {
  if (args.length === 0) {
    return 'Usage: fileinfo <filepath>';
  }

  const filePath = args[0];

  if (!context.getSystemModule) {
    return 'Error: System modules not available';
  }

  try {
    // fileRepositoryを取得（SSOT）
    const fileRepository = await context.getSystemModule('fileRepository');

    // ファイルパスを正規化（相対パスを絶対パスに）
    let normalizedPath = filePath;
    if (!filePath.startsWith('/')) {
      // 現在のディレクトリからの相対パス
      const relativeCurrent = context.currentDirectory.replace(`/projects/${context.projectName}`, '');
      normalizedPath = relativeCurrent === '' 
        ? `/${filePath}` 
        : `${relativeCurrent}/${filePath}`;
    } else {
      // 絶対パスの場合、プロジェクトルートからの相対パスに変換
      normalizedPath = filePath.replace(`/projects/${context.projectName}`, '');
    }

    // プロジェクトの全ファイルを取得
    const files = await fileRepository.getProjectFiles(context.projectId);
    
    // 指定されたファイルを検索
    const file = files.find((f: any) => f.path === normalizedPath);

    if (!file) {
      return `Error: File not found: ${normalizedPath}\nSearched in project: ${context.projectName}`;
    }

    // ファイル情報を表示
    let output = `File Information (from FileRepository):\n`;
    output += `  Path: ${file.path}\n`;
    output += `  Type: ${file.language}\n`;
    output += `  Size: ${file.content ? file.content.length : 0} bytes\n`;
    output += `  Created: ${new Date(file.createdAt).toLocaleString()}\n`;
    output += `  Modified: ${new Date(file.updatedAt).toLocaleString()}\n`;

    // ファイルの内容の最初の数行を表示
    if (file.content) {
      const lines = file.content.split('\n').slice(0, 5);
      output += `\nFirst 5 lines:\n`;
      lines.forEach((line: string, i: number) => {
        output += `  ${i + 1}: ${line}\n`;
      });
      if (file.content.split('\n').length > 5) {
        output += `  ... (${file.content.split('\n').length - 5} more lines)\n`;
      }
    } else {
      output += `\n(File is empty)\n`;
    }

    return output;
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

/**
 * activate関数
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('Sample Command Extension activating...');

  // コマンドを登録
  if (context.commands) {
    // helloコマンド
    context.commands.registerCommand('hello', helloCommand);
    context.logger.info('Registered command: hello');

    // fileinfoコマンド
    context.commands.registerCommand('fileinfo', fileinfoCommand);
    context.logger.info('Registered command: fileinfo');
  } else {
    context.logger.warn('Commands API not available');
  }

  context.logger.info('Sample Command Extension activated');

  return {};
}

/**
 * deactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('Sample Command Extension deactivated');
}
```


## コマンドハンドラーの詳細

### 引数

- `args: string[]` : コマンドライン引数（コマンド名は含まれません）
- `context: CommandContext` : 実行コンテキスト
  - `projectName: string` : プロジェクト名
  - `projectId: string` : プロジェクトID
  - `currentDirectory: string` : 現在のディレクトリ（絶対パス）
  - `getSystemModule: <T>(moduleName: T) => Promise<SystemModuleMap[T]>` : システムモジュールへの型安全アクセス

### 戻り値

- `Promise<string>` : ターミナルに出力される文字列


## システムモジュールの使用

コマンドハンドラーでは、`context.getSystemModule`を使ってPyxisの内部API（fileRepository等）に型安全にアクセスできます。

```typescript
const fileRepository = await context.getSystemModule('fileRepository');
const files = await fileRepository.getProjectFiles(context.projectId);
```




## テンプレートから作成

`pnpm run create-extension` で対話的にテンプレートを生成できます。

## ビルドとテスト


### ビルド

```bash
pnpm run setup-build
```

これにより:
- TypeScript/TSXがバンドル済みJSに変換
- `public/extensions/` にビルド済みファイルが配置
- `registry.json` が自動更新


### テスト

1. Pyxisを起動: `pnpm run dev`
2. ブラウザで開く: `http://localhost:3000`
3. 拡張機能パネルから有効化
4. ターミナルでコマンドを実行


## 実例：Sample Command Extension

Pyxisには、完全なサンプルとして `sample-command` 拡張機能が含まれています：

- **hello [name]** - 挨拶メッセージを表示
- **fileinfo <filepath>** - ファイル情報を表示

実装例は `extensions/sample-command/index.ts` を参照してください。


## ベストプラクティス

### 1. エラーハンドリング

```typescript
async function fileinfoCommand(args: string[], context: any): Promise<string> {
  try {
    // ...処理
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}
```

### 2. ヘルプメッセージ

```typescript
async function helloCommand(args: string[], context: any): Promise<string> {
  if (args.length === 0 || args[0] === '--help') {
    return `Usage: hello [name]\n\nExamples:\n  hello Alice\n  hello Bob`;
  }
  // ...処理
}
```

## トラブルシューティング

### コマンドが認識されない

1. 拡張機能が有効化されているか確認
2. ビルドが成功しているか確認（`pnpm run setup-build`）
3. ブラウザのコンソールでエラーを確認

### ファイルシステムにアクセスできない

- `context.fileSystem` が null でないか確認
- ファイルパスが正しいか確認（絶対パスまたは相対パス）
- プロジェクトが初期化されているか確認

## 高度な使用例

### 複数のコマンドを登録

```typescript
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  if (context.commands) {
    context.commands.registerCommand('cmd1', command1Handler);
    context.commands.registerCommand('cmd2', command2Handler);
    context.commands.registerCommand('cmd3', command3Handler);
  }
  
  return {};
}
```

### 非同期処理

```typescript
async function longRunningCommand(args: string[], context: any): Promise<string> {
  let output = 'Processing...\n';
  
  // 非同期処理
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  output += 'Step 1 complete\n';
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  output += 'Step 2 complete\n';
  
  return output;
}
```


## まとめ

Pyxisのコマンド拡張機能システムを使えば：

- ✅ ターミナルに新しいコマンドを型安全に追加できる
- ✅ ExtensionContext経由でAPI・システムモジュールにアクセスできる
- ✅ ビルド・配信・有効化・無効化が自動化
- ✅ サンプル実装（sample-command）が完全な参考例

詳細は [拡張機能システム全体のドキュメント](../docs/EXTENSION-SYSTEM.md) も参照してください。
