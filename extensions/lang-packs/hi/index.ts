import type { ExtensionContext, ExtensionActivation } from '../../_shared/types.js';

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('Language Pack activated');
  return {
    services: {
      'language-pack': {
        locale: 'hi',
        name: 'Hindi',
        nativeName: 'हिन्दी',
      },
    },
  };
}

export async function deactivate(): Promise<void> {}
