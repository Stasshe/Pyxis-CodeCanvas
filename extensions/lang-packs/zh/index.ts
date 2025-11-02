import type { ExtensionContext, ExtensionActivation } from '../../_shared/types.js';

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('Chinese Simplified Language Pack activated');
  return {
    services: {
      'language-pack': { locale: 'zh', name: '简体中文', nativeName: '简体中文' },
    },
  };
}

export async function deactivate(): Promise<void> {}
