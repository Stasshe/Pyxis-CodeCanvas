import type { ExtensionContext, ExtensionActivation } from '../../_shared/types.js';

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('Language Pack activated');
  return {
    services: {
      'language-pack': {
        locale: 'id',
        name: 'Indonesian',
        nativeName: 'Bahasa Indonesia',
      },
    },
  };
}

export async function deactivate(): Promise<void> {}
