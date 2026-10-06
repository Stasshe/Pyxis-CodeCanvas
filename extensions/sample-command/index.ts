/**
 * Sample Command Extension
 * ターミナルコマンドを追加するサンプル拡張機能
 */

import type { CommandContext, ExtensionActivation, ExtensionContext } from '../_shared/types';

/**
 * helloコマンドの実装
 */
async function helloCommand(args: string[], context: CommandContext): Promise<string> {
  const name = args.length > 0 ? args.join(' ') : 'World';
  return `Hello, ${name}!\nProject: ${context.projectName}\nCurrent Directory: ${context.currentDirectory}`;
}

/**
 * fileinfoコマンドの実装
 * 指定されたファイルの情報を表示
 *
 * Reads metadata and content from the workspace filesystem.
 */
async function fileinfoCommand(args: string[], context: CommandContext): Promise<string> {
  if (args.length === 0) {
    return 'Usage: fileinfo <filepath>';
  }

  const filePath = args[0];

  if (!context.getSystemModule) {
    return 'Error: System modules not available';
  }

  try {
    const fsClient = await context.getSystemModule('fsClient');
    const { resolvePath } = await context.getSystemModule('pathUtils');
    const normalizedPath = resolvePath(context.currentDirectory, filePath);
    if (!(await fsClient.exists(normalizedPath))) {
      return `Error: File not found: ${normalizedPath}\nSearched in project: ${context.projectName}`;
    }

    const file = await fsClient.stat(normalizedPath);
    let content = '';
    if (file.type === 'file') content = await fsClient.readText(file.path);
    let output = `File Information:\n`;
    output += `  Path: ${file.path}\n`;
    output += `  Type: ${file.type}\n`;
    output += `  Size: ${file.size} bytes\n`;
    output += `  Modified: ${new Date(file.mtime).toLocaleString()}\n`;

    // ファイルの内容の最初の数行を表示
    if (content) {
      const lines = content.split('\n').slice(0, 5);
      output += `\nFirst 5 lines:\n`;
      lines.forEach((line: string, i: number) => {
        output += `  ${i + 1}: ${line}\n`;
      });
      if (content.split('\n').length > 5) {
        output += `  ... (${content.split('\n').length - 5} more lines)\n`;
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
 * 拡張機能のactivate関数
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('Sample Command Extension activating...');
  // helloコマンド
  context.commands.registerCommand('hello', helloCommand);
  context.logger.info('Registered command: hello');

  // fileinfoコマンド
  context.commands.registerCommand('fileinfo', fileinfoCommand);
  context.logger.info('Registered command: fileinfo');
  context.logger.info('Sample Command Extension activated');

  return {};
}

/**
 * 拡張機能のdeactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('Sample Command Extension deactivated');
}
