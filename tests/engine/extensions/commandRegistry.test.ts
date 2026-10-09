import { describe, expect, it } from 'vitest';

import { CommandRegistry } from '@/engine/extensions/commandRegistry';

describe('extension command registration', () => {
  it('preserves the first owner when another extension registers the same command', () => {
    const registry = new CommandRegistry();
    const firstHandler = async () => 'first';
    const secondHandler = async () => 'second';
    registry.registerCommand('pyxis.first', 'shared-command', firstHandler);

    expect(() => registry.registerCommand('pyxis.second', 'shared-command', secondHandler)).toThrow(
      'already registered by extension "pyxis.first"'
    );
    registry.unregisterExtensionCommands('pyxis.second');

    expect(registry.getCommandInfo()).toEqual([
      { command: 'shared-command', extensionId: 'pyxis.first' },
    ]);
  });
});
