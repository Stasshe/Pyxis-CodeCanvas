/**
 * __EXTENSION_NAME__
 * __EXTENSION_DESCRIPTION__
 */

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';
import type { FileRepository, CommandContext } from '../_shared/systemModuleTypes';

/**
 * カスタムコマンドの実装
 */
async function myCommand(args: string[], context: CommandContext): Promise<string> {
  // args: コマンドライン引数の配列
  // context.projectName: プロジェクト名
  // context.projectId: プロジェクトID
  // context.currentDirectory: 現在のディレクトリ
  // context.getSystemModule: システムモジュール取得関数

  if (args.length === 0) {
    return 'Usage: mycommand <argument>';
  }

  const arg = args[0];
  let output = `Command executed with argument: ${arg}\n`;
  output += `Project: ${context.projectName}\n`;
  output += `Current Directory: ${context.currentDirectory}\n`;

  // fileRepositoryを使用する例（SSOT）
  try {
    if (!context.getSystemModule) {
      output += '\nWarning: System modules not available\n';
      return output;
    }

    // getSystemModule is typed to only allow known system modules.
    const fileRepository = (await context.getSystemModule('fileRepository')) as FileRepository;
    const files = await fileRepository.getProjectFiles(context.projectId || '');
    output += `\nTotal files in project: ${files.length}\n`;

    // 現在のディレクトリのファイル数をカウント
    const currentDirPrefix = context.currentDirectory.replace(`/projects/${context.projectName}`, '');
    const filesInCurrentDir = files.filter((f: any) => {
      const idx = (f.path || '').lastIndexOf('/');
      const dir = idx >= 0 ? f.path.substring(0, idx) : '';
      return dir === currentDirPrefix || (currentDirPrefix === '' && !f.path.includes('/'));
    });
    output += `Files in current directory: ${filesInCurrentDir.length}\n`;
  } catch (error) {
    output += `\nError accessing file repository: ${(error as Error).message}\n`;
  }

  return output;
}

/**
 * 拡張機能のactivate関数
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('__EXTENSION_NAME__ activating...');

  // コマンドを登録
  if (context.commands) {
    context.commands.registerCommand('mycommand', myCommand);
    context.logger?.info('Registered command: mycommand');
  } else {
    context.logger?.warn('Commands API not available');
  }

  context.logger?.info('__EXTENSION_NAME__ activated');

  return {};
}

/**
 * 拡張機能のdeactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('__EXTENSION_NAME__ deactivated');
}
