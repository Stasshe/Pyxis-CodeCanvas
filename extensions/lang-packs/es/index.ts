import type { ExtensionContext, ExtensionActivation } from '../../_shared/types.js';

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('Language Pack activated');
  return {
    services: {
      'language-pack': {
        locale: 'es',
        name: 'Español',
        nativeName: 'Español',
      },
    },
  };
}

export async function deactivate(): Promise<void> {}
