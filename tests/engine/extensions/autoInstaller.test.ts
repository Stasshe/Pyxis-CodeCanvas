import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  progress: null as {
    started: boolean;
    completed: boolean;
    completedExtensionIds: string[];
  } | null,
  installed: [] as Array<{ manifest: { id: string }; enabled: boolean }>,
  failSecond: true,
}));

vi.mock('@/engine/extensions/extensionManager', () => ({
  extensionManager: {
    getInstalledExtensions: vi.fn(async () => [...state.installed]),
    installExtension: vi.fn(async (manifestUrl: string) => {
      if (manifestUrl === 'second' && state.failSecond) return null;
      const id =
        manifestUrl === 'first'
          ? 'pyxis.first'
          : manifestUrl === 'second'
            ? 'pyxis.second'
            : 'pyxis.lang-fr';
      const installed = { manifest: { id }, enabled: true };
      state.installed.push(installed);
      return installed;
    }),
    enableExtension: vi.fn(async () => true),
  },
}));

vi.mock('@/engine/extensions/extensionRegistry', () => ({
  fetchRegistry: vi.fn(async () => ({
    version: '1',
    updatedAt: '',
    extensions: [
      { id: 'pyxis.first', manifestUrl: 'first', type: 'ui', defaultEnabled: true },
      { id: 'pyxis.second', manifestUrl: 'second', type: 'ui', defaultEnabled: true },
      {
        id: 'pyxis.lang-fr',
        manifestUrl: 'public/lang-packs/fr/manifest.json',
        type: 'service',
        defaultEnabled: false,
      },
    ],
  })),
}));

vi.mock('@/engine/extensions/storage-adapter', () => ({
  loadAutoInstallProgress: vi.fn(async () => state.progress),
  saveAutoInstallProgress: vi.fn(async (progress: typeof state.progress) => {
    state.progress = progress
      ? { ...progress, completedExtensionIds: [...progress.completedExtensionIds] }
      : null;
  }),
}));

import { autoInstallExtensions, isFirstRun } from '@/engine/extensions/autoInstaller';
import { extensionManager } from '@/engine/extensions/extensionManager';

describe('extension auto-install progress', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    state.progress = null;
    state.installed = [];
    state.failSecond = true;
    vi.clearAllMocks();
  });

  it('installs the matching language pack for a regional browser locale', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { language: 'fr-FR' });

    await autoInstallExtensions();

    expect(extensionManager.installExtension).toHaveBeenCalledWith(
      'public/lang-packs/fr/manifest.json'
    );
    expect(state.progress?.completedExtensionIds).toContain('pyxis.lang-fr');
  });

  it('retries only incomplete first-run installs without re-enabling completed extensions', async () => {
    await autoInstallExtensions();

    expect(state.installed.map(extension => extension.manifest.id)).toEqual(['pyxis.first']);
    expect(state.progress).toEqual({
      started: true,
      completed: false,
      completedExtensionIds: ['pyxis.first'],
    });
    expect(await isFirstRun()).toBe(true);

    state.failSecond = false;
    await autoInstallExtensions();

    expect(extensionManager.installExtension).toHaveBeenCalledTimes(3);
    expect(extensionManager.installExtension).toHaveBeenNthCalledWith(1, 'first');
    expect(extensionManager.installExtension).toHaveBeenNthCalledWith(2, 'second');
    expect(extensionManager.installExtension).toHaveBeenNthCalledWith(3, 'second');
    expect(extensionManager.enableExtension).not.toHaveBeenCalled();
    expect(state.progress).toEqual({
      started: true,
      completed: true,
      completedExtensionIds: ['pyxis.first', 'pyxis.second'],
    });

    state.installed = [];
    expect(await isFirstRun()).toBe(false);
  });
});
