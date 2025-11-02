/**
 * Japanese Language Pack Extension
 * 実際の翻訳データは public/locales/ja/ から読み込み
 * この拡張機能は「インストール済み」として表示されるだけ
 */

import type { ExtensionContext, ExtensionActivation } from '../../_shared/types.js';

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('Japanese Language Pack activated');
  
  return {
    services: {
      'language-pack': {
        locale: 'ja',
        name: '日本語',
        nativeName: '日本語',
      },
    },
  };
}

export async function deactivate(): Promise<void> {
  console.log('[Japanese Language Pack] Deactivating...');
}
