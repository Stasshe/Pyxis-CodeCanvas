/**
 * __EXTENSION_NAME__
 * __EXTENSION_DESCRIPTION__
 */

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

/**
 * コードをトランスパイル
 */
async function transpile(code: string, options: unknown, context: ExtensionContext): Promise<{ code: string }> {
  // ここにトランスパイル処理を実装
  context.logger.info('Transpiling code...');
  
  // 例: 単純な変換
  const transformedCode = code;
  
  return { code: transformedCode };
}

/**
 * 拡張機能のactivate関数
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('__EXTENSION_NAME__ activating...');

  const runtimeFeatures = {
    transpiler: (code: string, options: unknown) => transpile(code, options, context),

    // サポートするファイルタイプ
    canTranspile: (filePath: string): boolean => {
      return /\.(ext)$/.test(filePath); // 適切な拡張子に変更
    },
  };

  context.logger.info('__EXTENSION_NAME__ activated');

  return {
    runtimeFeatures,
  };
}

/**
 * 拡張機能のdeactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('__EXTENSION_NAME__ deactivated');
}
