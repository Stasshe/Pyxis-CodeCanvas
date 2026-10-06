import type { ExtensionActivation, ExtensionContext } from '../_shared/types';

const supportedExtensions = ['.ts', '.tsx', '.mts', '.cts'];

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  await context.registerTranspiler?.({
    id: 'typescript',
    supportedExtensions,
    workerTransform: 'typescript',
  });
  context.logger.info('TypeScript transpiler registered with the filesystem worker.');
  return {};
}

export async function deactivate(): Promise<void> {}
