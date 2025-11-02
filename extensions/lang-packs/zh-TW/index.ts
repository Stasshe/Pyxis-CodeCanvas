import type { ExtensionContext, ExtensionActivation } from '../../_shared/types.js';

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('Language Pack activated');
  return {
    services: {
      'language-pack': {
        locale: 'zh-TW',
        name: 'Chinese (Traditional)',
        nativeName: '繁體中文',
      },
    },
  };
}

export async function deactivate(): Promise<void> {}
