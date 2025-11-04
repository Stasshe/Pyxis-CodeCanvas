# カスタムコマンド拡張機能の作成ガイド

## 概要

Pyxisの拡張機能システムを使用して、ターミナルに新しいコマンドを追加できます。

## 基本構造

### 1. マニフェストファイル (`manifest.json`)

```json
{
  "id": "pyxis.my-command",
  "name": "My Command Extension",
  "version": "1.0.0",
  "type": "tool",
  "description": "カスタムコマンドを追加",
  "author": "Your Name",
  "defaultEnabled": false,
  "entry": "index.js",
  "provides": {
    "commands": ["mycommand", "anothercommand"]
  },
  "metadata": {
    "publishedAt": "2025-11-04T00:00:00.000Z",
    "updatedAt": "2025-11-04T00:00:00.000Z",
    "tags": ["command", "tool"]
  }
}
```

### 2. エントリーファイル (`index.ts`)

```typescript
import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

/**
 * コマンドハンドラーの実装
 */
async function myCommand(args: string[], context: any): Promise<string> {
  // args: コマンドライン引数の配列
  // context: 実行コンテキスト
  //   - projectName: string - プロジェクト名
  //   - projectId: string - プロジェクトID
  //   - currentDirectory: string - 現在のディレクトリ
  //   - fileSystem: any - Pyxisのファイルシステムインスタンス

  if (args.length === 0) {
    return 'Usage: mycommand <argument>';
  }

  let output = `Command executed with: ${args.join(' ')}\n`;
  output += `Project: ${context.projectName}\n`;
  output += `Current Directory: ${context.currentDirectory}\n`;

  return output;
}

/**
 * activate関数
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('My Command Extension activating...');

  // コマンドを登録
  if (context.commands) {
    context.commands.registerCommand('mycommand', myCommand);
    context.logger?.info('Registered command: mycommand');
  }

  return {};
}

/**
 * deactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('My Command Extension deactivated');
}
```

## コマンドハンドラーの詳細

### 引数

#### `args: string[]`
コマンドライン引数の配列。コマンド名は含まれません。

例：`mycommand arg1 arg2 arg3` → `['arg1', 'arg2', 'arg3']`

#### `context: CommandContext`
実行コンテキストオブジェクト：

- `projectName: string` - 現在のプロジェクト名
- `projectId: string` - プロジェクトID（IndexedDB参照用）
- `currentDirectory: string` - 現在のディレクトリ（絶対パス）
- `getSystemModule: <T>(moduleName: T) => Promise<SystemModuleMap[T]>` - システムモジュールへのアクセス

### 戻り値

`Promise<string>` - ターミナルに出力される文字列

## ファイルシステムの使用

拡張機能のコマンドは、Pyxisの内部ファイルシステム（lightning-fs）を使用できます。

### 例：ファイル一覧を取得

```typescript
async function listFilesCommand(args: string[], context: any): Promise<string> {
  const fs = context.fileSystem;
  
  if (!fs) {
    return 'Error: File system not available';
  }

  try {
    const files = await fs.promises.readdir(context.currentDirectory);
    let output = `Files in ${context.currentDirectory}:\n`;
    
    for (const file of files) {
      output += `  - ${file}\n`;
    }
    
    return output;
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}
```

### 例：ファイルを読み込む

```typescript
async function readFileCommand(args: string[], context: any): Promise<string> {
  if (args.length === 0) {
    return 'Usage: readfile <filename>';
  }

  const fs = context.fileSystem;
  const filename = args[0];
  
  // 相対パスを絶対パスに変換
  let filePath = filename;
  if (!filename.startsWith('/')) {
    filePath = `${context.currentDirectory}/${filename}`;
  }

  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return content;
  } catch (error) {
    return `Error reading file: ${(error as Error).message}`;
  }
}
```

### 例：ファイルを書き込む

```typescript
async function writeFileCommand(args: string[], context: any): Promise<string> {
  if (args.length < 2) {
    return 'Usage: writefile <filename> <content>';
  }

  const fs = context.fileSystem;
  const filename = args[0];
  const content = args.slice(1).join(' ');
  
  let filePath = filename;
  if (!filename.startsWith('/')) {
    filePath = `${context.currentDirectory}/${filename}`;
  }

  try {
    await fs.promises.writeFile(filePath, content, 'utf8');
    return `File written: ${filePath}`;
  } catch (error) {
    return `Error writing file: ${(error as Error).message}`;
  }
}
```

## システムモジュールの使用

拡張機能は、Pyxisのシステムモジュールにもアクセスできます。

### 例：FileRepositoryを使用

```typescript
async function myCommand(args: string[], context: any): Promise<string> {
  // FileRepositoryを取得（Extension Contextから）
  const extensionContext = (context as any)._extensionContext;
  
  if (extensionContext?.getSystemModule) {
    const fileRepository = await extensionContext.getSystemModule('fileRepository');
    
    // プロジェクトのファイル一覧を取得
    const files = await fileRepository.getProjectFiles(context.projectId);
    
    let output = `Files in project (from IndexedDB):\n`;
    files.forEach(file => {
      output += `  - ${file.path} (${file.language})\n`;
    });
    
    return output;
  }
  
  return 'System modules not available';
}
```

## テンプレートから作成

簡単に始めるには、テンプレート生成スクリプトを使用できます：

```bash
node scripts/create-extension.js
```

手順：
1. タイプを選択: `Command/Tool`
2. 拡張機能IDを入力（例：`my-command`）
3. 名前、説明、作者などを入力
4. npm/pnpmライブラリを使用するか選択

## ビルドとテスト

### ビルド

```bash
pnpm run setup-build
```

これにより：
- TypeScriptがJavaScriptにトランスパイルされる
- `public/extensions/` にビルド済みファイルが配置される
- `registry.json` が自動更新される

### テスト

1. Pyxisを起動: `pnpm run dev`
2. ブラウザで開く: `http://localhost:3000`
3. 拡張機能パネルから有効化
4. ターミナルでコマンドを実行

## 実例：Sample Command Extension

Pyxisには、サンプルとして `sample-command` 拡張機能が含まれています：

- **hello [name]** - 挨拶メッセージを表示
- **fileinfo <filepath>** - ファイル情報を表示

ソースコード：`extensions/sample-command/`

## ベストプラクティス

### 1. エラーハンドリング

```typescript
async function myCommand(args: string[], context: any): Promise<string> {
  try {
    // コマンドの処理
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}
```

### 2. ヘルプメッセージ

```typescript
async function myCommand(args: string[], context: any): Promise<string> {
  if (args.length === 0 || args[0] === '--help') {
    return `Usage: mycommand <arg1> [arg2]
    
Description:
  This command does something useful
  
Examples:
  mycommand value1
  mycommand value1 value2
`;
  }
  
  // コマンドの処理
}
```

### 3. オプション解析

```typescript
async function myCommand(args: string[], context: any): Promise<string> {
  const options = {
    verbose: false,
    output: null,
  };
  
  const positional: string[] = [];
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '-v' || arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '-o' || arg === '--output') {
      options.output = args[++i];
    } else {
      positional.push(arg);
    }
  }
  
  // オプションを使用して処理
}
```

## トラブルシューティング

### コマンドが認識されない

1. 拡張機能が有効化されているか確認
2. `manifest.json` の `provides.commands` にコマンド名が含まれているか確認
3. ビルドが成功しているか確認（`pnpm run setup-build`）
4. ブラウザのコンソールでエラーを確認

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

Pyxisのコマンド拡張機能システムを使用すると：

- ✅ ターミナルに新しいコマンドを追加できる
- ✅ Pyxisの内部ファイルシステムにアクセスできる
- ✅ システムモジュール（FileRepository等）を使用できる
- ✅ ビルド済みファイルは自動的に配置される
- ✅ 動的に有効化・無効化できる

詳細は [拡張機能システム全体のドキュメント](./HOW-TO-CREATE-EXTENSION.md) を参照してください。
