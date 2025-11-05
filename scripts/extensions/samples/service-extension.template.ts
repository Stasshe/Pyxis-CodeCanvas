/**
 * __EXTENSION_NAME__
 * __EXTENSION_DESCRIPTION__
 */

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

/**
 * 拡張機能のactivate関数
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('__EXTENSION_NAME__ activating...');

  // サービスの実装
  const myService = {
    // ここにサービスのAPIを実装
    version: '1.0.0',
    
    doSomething: () => {
      context.logger.info('Service method called');
    },
  };

  context.logger.info('__EXTENSION_NAME__ activated');

  return {
    services: {
      'my-service': myService,
    },
  };
}

/**
 * 拡張機能のdeactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('__EXTENSION_NAME__ deactivated');
}
