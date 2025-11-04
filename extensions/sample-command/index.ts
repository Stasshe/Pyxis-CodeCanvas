/**
 * Sample Command Extension
 * ターミナルコマンドを追加するサンプル拡張機能
 */

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
 */
async function fileinfoCommand(args: string[], context: any): Promise<string> {
  if (args.length === 0) {
    return 'Usage: fileinfo <filepath>';
  }

  const filePath = args[0];
  const fs = context.fileSystem;

  if (!fs) {
    return 'Error: File system not available';
  }

  try {
    // ファイルパスを解決（相対パスを絶対パスに）
    let fullPath = filePath;
    if (!filePath.startsWith('/')) {
      fullPath = `${context.currentDirectory}/${filePath}`;
    }

    // ファイル情報を取得
    const stat = await fs.promises.stat(fullPath);
    
    let output = `File Information:\n`;
    output += `  Path: ${fullPath}\n`;
    output += `  Type: ${stat.isDirectory() ? 'Directory' : 'File'}\n`;
    output += `  Size: ${stat.size} bytes\n`;
    output += `  Modified: ${new Date(stat.mtime).toISOString()}\n`;
    output += `  Mode: ${stat.mode.toString(8)}\n`;

    if (!stat.isDirectory()) {
      // ファイルの場合、内容の最初の数行を表示
      try {
        const content = await fs.promises.readFile(fullPath, 'utf8');
        const lines = content.split('\n').slice(0, 5);
        output += `\nFirst 5 lines:\n`;
        lines.forEach((line: string, i: number) => {
          output += `  ${i + 1}: ${line}\n`;
        });
        if (content.split('\n').length > 5) {
          output += `  ... (${content.split('\n').length - 5} more lines)\n`;
        }
      } catch (readError) {
        output += `\n(Unable to read file content)\n`;
      }
    }

    return output;
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

/**
 * 拡張機能のactivate関数
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('Sample Command Extension activating...');

  // コマンドを登録
  if (context.commands) {
    // helloコマンド
    context.commands.registerCommand('hello', helloCommand);
    context.logger?.info('Registered command: hello');

    // fileinfoコマンド
    context.commands.registerCommand('fileinfo', fileinfoCommand);
    context.logger?.info('Registered command: fileinfo');
  } else {
    context.logger?.warn('Commands API not available');
  }

  context.logger?.info('Sample Command Extension activated');

  return {};
}

/**
 * 拡張機能のdeactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('Sample Command Extension deactivated');
}
