import type { ExtensionContext, ExtensionActivation } from '../../_shared/types.js';

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('English Language Pack activated');
  return {
    services: {
      'language-pack': {
        locale: 'en',
        name: 'English',
        nativeName: 'English',
      },
    },
  };
}

export async function deactivate(): Promise<void> {
  console.log('[English Language Pack] Deactivating...');
}
