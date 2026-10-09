import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { setupTestProject } from '../../_helpers/testProject';

describe('TerminalCommandRegistry', () => {
  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    await setupTestProject('TerminalRegistryTest');
  });

  afterEach(async () => {
    await terminalCommandRegistry.clearAll();
  });

  it('replaces only the shell that requested a restart', async () => {
    const rootPath = '/tmp/TerminalRegistryTest';
    const currentShell = await terminalCommandRegistry.getShell(rootPath);
    const replacement = await terminalCommandRegistry.replaceShell(rootPath, currentShell);

    expect(replacement).toBeDefined();
    expect(replacement).not.toBe(currentShell);
    expect(await terminalCommandRegistry.getShell(rootPath)).toBe(replacement);
  });

  it('keeps a newer shell when an old shell requests a restart', async () => {
    const rootPath = '/tmp/TerminalRegistryTest';
    const oldShell = await terminalCommandRegistry.getShell(rootPath);
    const currentShell = await terminalCommandRegistry.replaceShell(rootPath, oldShell);
    if (!currentShell) throw new Error('Expected replacement shell');
    const dispose = vi.spyOn(currentShell, 'dispose');

    const result = await terminalCommandRegistry.replaceShell(rootPath, oldShell);

    expect(result).toBe(currentShell);
    expect(dispose).not.toHaveBeenCalled();
  });
});
