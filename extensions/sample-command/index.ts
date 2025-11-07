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
 * 
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

    // 単一ファイルをインデックスで取得（推奨）
    const file = await fileRepository.getFileByPath(context.projectId, normalizedPath);

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
