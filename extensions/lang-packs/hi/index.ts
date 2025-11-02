import type { ExtensionContext, ExtensionActivation } from '../../_shared/types.js';

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('Language Pack activated');
  return {
    services: {
      'language-pack': {
        locale: 'LOCALE',
        name: 'LANGUAGE_NAME',
        nativeName: 'NATIVE_NAME',
      },
    },
  };
}

export async function deactivate(): Promise<void> {}
