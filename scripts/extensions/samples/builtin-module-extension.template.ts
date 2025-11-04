/**
 * __EXTENSION_NAME__
 * __EXTENSION_DESCRIPTION__
 */

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

/**
 * モジュールの実装
 */
const myModule = {
  // ここにモジュールのAPIを実装
  version: '1.0.0',
  
  someFunction: () => {
    return 'Hello from built-in module';
  },
};

/**
 * 拡張機能のactivate関数
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('__EXTENSION_NAME__ activating...');

  context.logger?.info('__EXTENSION_NAME__ activated');

  return {
    builtInModules: {
      'my-module': myModule,
    },
  };
}

/**
 * 拡張機能のdeactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('__EXTENSION_NAME__ deactivated');
}
