import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadExtensionArchive } from '@/engine/ide/extensions/archiveLoader';
import { commandRegistry } from '@/engine/ide/extensions/commandRegistry';
import { fetchExtensionCode, fetchExtensionManifest } from '@/engine/ide/extensions/extensionLoader';
import { type ExtensionChangeEvent, extensionManager } from '@/engine/ide/extensions/extensionManager';
import {
  deleteInstalledExtension,
  loadAllInstalledExtensions,
  loadInstalledExtension,
  saveInstalledExtension,
} from '@/engine/ide/extensions/storage-adapter';
import { sidebarRegistry } from '@/engine/ide/extensions/system-api/SidebarAPI';
import * as systemModules from '@/engine/ide/extensions/systemModules';
import {
  type ExtensionActivation,
  type ExtensionContext,
  type ExtensionExports,
  type ExtensionManifest,
  ExtensionStatus,
  ExtensionType,
  type InstalledExtension,
} from '@/engine/ide/extensions/types';
import { tabRegistry } from '@/engine/ide/tabs/TabRegistry';
import { triggerAction } from '@/hooks/keybindings/useKeyBindings';
import { projectState } from '@/stores/projectStore';

const mocks = vi.hoisted(() => ({
  installed: [] as InstalledExtension[],
  loadModule: vi.fn<(entryCode: string) => Promise<ExtensionExports | null>>(),
  activate:
    vi.fn<
      (exports: ExtensionExports, context: ExtensionContext) => Promise<ExtensionActivation | null>
    >(),
  deactivate: vi.fn<(exports: ExtensionExports) => Promise<void>>(),
  loadArchive:
    vi.fn<
      (file: File | Blob) => Promise<{
        manifest: ExtensionManifest;
        entryCode: string;
        files?: Record<string, string | Blob>;
      }>
    >(),
}));

vi.mock('@/engine/ide/extensions/storage-adapter', () => ({
  deleteInstalledExtension: vi.fn(),
  loadAllInstalledExtensions: vi.fn(async () => mocks.installed),
  loadInstalledExtension: vi.fn(
    async (extensionId: string) =>
      mocks.installed.find(extension => extension.manifest.id === extensionId) ?? null
  ),
  saveInstalledExtension: vi.fn(async (installed: InstalledExtension) => {
    const index = mocks.installed.findIndex(
      extension => extension.manifest.id === installed.manifest.id
    );
    if (index < 0) mocks.installed.push(installed);
    else mocks.installed[index] = installed;
  }),
}));

vi.mock('@/engine/ide/extensions/extensionLoader', () => ({
  activateExtension: mocks.activate,
  deactivateExtension: mocks.deactivate,
  fetchExtensionCode: vi.fn(),
  fetchExtensionManifest: vi.fn(),
  loadExtensionModule: mocks.loadModule,
}));

vi.mock('@/engine/ide/extensions/archiveLoader', () => ({
  loadExtensionArchive: mocks.loadArchive,
}));

const extensionId = 'pyxis.activation-rollback-fixture';
const tabKind = `extension:${extensionId}`;
const commandName = 'activation-rollback-fixture';

describe('extension activation rollback', () => {
  beforeEach(() => {
    const manifest: ExtensionManifest = {
      id: extensionId,
      name: 'Activation rollback fixture',
      version: '3.2.1',
      type: ExtensionType.UI,
      description: '',
      author: '',
      entry: 'index.js',
      status: ExtensionStatus.INSTALLED,
      installedAt: 0,
      updatedAt: 0,
      enabled: false,
      metadata: { publishedAt: '', updatedAt: '' },
    };
    mocks.installed = [
      {
        manifest,
        status: ExtensionStatus.INSTALLED,
        installedAt: 0,
        updatedAt: 0,
        enabled: false,
        cache: { entryCode: '', cachedAt: 0 },
      },
    ];
    mocks.loadModule.mockResolvedValue({
      activate: async context => {
        context.tabs.registerTabType(() => null);
        context.sidebar.createPanel({
          id: 'panel',
          title: 'Panel',
          icon: 'Package',
          component: () => null,
        });
        context.commands.registerCommand(commandName, async () => '');
        throw new Error('activation failure');
      },
    });
    mocks.activate.mockImplementation((exports, context) => {
      expect(context.version).toBe('3.2.1');
      return exports.activate(context);
    });
    mocks.deactivate.mockImplementation(async exports => {
      await exports.deactivate?.();
    });
    mocks.loadArchive.mockReset();
  });

  afterEach(async () => {
    for (const active of extensionManager.getActiveExtensions()) {
      await extensionManager.disableExtension(active.manifest.id);
    }
    tabRegistry.unregister(tabKind);
    sidebarRegistry.unregisterAll(extensionId);
    commandRegistry.unregisterExtensionCommands(extensionId);
    vi.clearAllMocks();
    vi.mocked(loadAllInstalledExtensions).mockImplementation(async () => mocks.installed);
    vi.mocked(loadInstalledExtension).mockImplementation(
      async id => mocks.installed.find(extension => extension.manifest.id === id) ?? null
    );
  });

  it('removes registrations created before activation fails', async () => {
    const enabled = await extensionManager.enableExtension(extensionId);

    expect(enabled).toBe(false);
    expect(tabRegistry.has(tabKind)).toBe(false);
    expect(sidebarRegistry.getAllPanels().some(panel => panel.extensionId === extensionId)).toBe(
      false
    );
    expect(commandRegistry.hasCommand(commandName)).toBe(false);
    expect(mocks.deactivate).toHaveBeenCalledTimes(1);
  });

  it('identifies language-pack disable events and intentional replacements', async () => {
    const createLanguagePack = (locale: string): InstalledExtension => {
      const manifest: ExtensionManifest = {
        ...mocks.installed[0].manifest,
        id: `pyxis.lang.${locale}`,
        name: `${locale} language pack`,
        onlyOne: 'lang-pack',
      };
      return {
        ...mocks.installed[0],
        manifest,
        cache: { entryCode: locale, cachedAt: 0 },
      };
    };
    const english = createLanguagePack('en');
    const japanese = createLanguagePack('ja');
    mocks.installed = [english, japanese];
    mocks.loadModule.mockImplementation(async entryCode => ({
      activate: async () => ({ entryCode }),
    }));
    mocks.activate.mockImplementation((exports, context) => exports.activate(context));

    const events: ExtensionChangeEvent[] = [];
    const unsubscribe = extensionManager.addChangeListener(event => events.push(event));
    try {
      expect(await extensionManager.enableExtension(english.manifest.id)).toBe(true);
      expect(await extensionManager.enableExtension(japanese.manifest.id)).toBe(true);
      expect(events).toContainEqual({
        type: 'disabled',
        extensionId: english.manifest.id,
        manifest: english.manifest,
        replacementExtensionId: japanese.manifest.id,
      });
      expect(events).toContainEqual({
        type: 'enabled',
        extensionId: japanese.manifest.id,
        manifest: japanese.manifest,
      });

      events.length = 0;
      expect(await extensionManager.disableExtension(japanese.manifest.id)).toBe(true);
      expect(events).toContainEqual({
        type: 'disabled',
        extensionId: japanese.manifest.id,
        manifest: japanese.manifest,
        replacementExtensionId: undefined,
      });
    } finally {
      unsubscribe();
      await extensionManager.disableExtension(english.manifest.id);
      await extensionManager.disableExtension(japanese.manifest.id);
    }
  });

  it('persists failed startup activation as disabled before enabling its onlyOne peer', async () => {
    const group = 'startup-failure-group';
    const failedId = 'pyxis.startup-failure-fixture';
    const peerId = 'pyxis.startup-peer-fixture';
    const failed: InstalledExtension = {
      ...mocks.installed[0],
      manifest: { ...mocks.installed[0].manifest, id: failedId, onlyOne: group },
      status: ExtensionStatus.ENABLED,
      enabled: true,
      cache: { entryCode: 'startup-failure', cachedAt: 0 },
    };
    const peer: InstalledExtension = {
      ...mocks.installed[0],
      manifest: { ...mocks.installed[0].manifest, id: peerId, onlyOne: group },
      status: ExtensionStatus.INSTALLED,
      enabled: false,
      cache: { entryCode: 'peer', cachedAt: 0 },
    };
    mocks.installed = [failed, peer];
    vi.mocked(loadAllInstalledExtensions).mockImplementation(async () =>
      mocks.installed.map(extension => structuredClone(extension))
    );
    vi.mocked(loadInstalledExtension).mockImplementation(async id => {
      const installed = mocks.installed.find(extension => extension.manifest.id === id);
      return installed ? structuredClone(installed) : null;
    });
    mocks.activate.mockImplementation((exports, context) => exports.activate(context));
    mocks.loadModule.mockImplementation(async entryCode => ({
      activate: async () => {
        if (entryCode === 'startup-failure') throw new Error('startup activation failure');
        return {};
      },
    }));

    expect(await extensionManager.enableExtension(failedId)).toBe(false);
    expect(mocks.installed.find(extension => extension.manifest.id === failedId)?.enabled).toBe(
      false
    );
    expect(await extensionManager.enableExtension(peerId)).toBe(true);
    expect(extensionManager.getActiveExtensions().map(active => active.manifest.id)).toContain(
      peerId
    );
  });

  it('deactivates and removes registrations when persistence fails after activation', async () => {
    const deactivate = vi.fn(async () => {});
    const exports: ExtensionExports = {
      activate: async context => {
        context.tabs.registerTabType(() => null);
        context.sidebar.createPanel({
          id: 'panel',
          title: 'Panel',
          icon: 'Package',
          component: () => null,
        });
        context.commands.registerCommand(commandName, async () => '');
        return {};
      },
      deactivate,
    };
    mocks.loadModule.mockResolvedValue(exports);
    vi.mocked(saveInstalledExtension).mockRejectedValueOnce(new Error('storage failure'));

    const enabled = await extensionManager.enableExtension(extensionId);

    expect(enabled).toBe(false);
    expect(deactivate).toHaveBeenCalledOnce();
    expect(tabRegistry.has(tabKind)).toBe(false);
    expect(sidebarRegistry.getAllPanels().some(panel => panel.extensionId === extensionId)).toBe(
      false
    );
    expect(commandRegistry.hasCommand(commandName)).toBe(false);
    expect(mocks.installed[0].enabled).toBe(false);
  });

  it('keeps the installed package when update validation or download fails', async () => {
    const previous = mocks.installed[0];
    vi.mocked(fetchExtensionManifest).mockResolvedValueOnce(null);

    expect(
      await extensionManager.updateExtension(extensionId, '/missing/manifest.json')
    ).toBeNull();
    expect(mocks.installed[0]).toBe(previous);
    expect(saveInstalledExtension).not.toHaveBeenCalled();
  });

  it('replaces an active package from ZIP and activates the staged code', async () => {
    const oldExports: ExtensionExports = { activate: async () => ({}) };
    const newExports: ExtensionExports = { activate: async () => ({}) };
    mocks.activate.mockImplementation((exports, context) => exports.activate(context));
    mocks.loadModule.mockResolvedValueOnce(oldExports).mockResolvedValueOnce(newExports);
    expect(await extensionManager.enableExtension(extensionId)).toBe(true);

    const manifest = {
      ...mocks.installed[0].manifest,
      version: '4.0.0',
      entry: 'nested/index.js',
    };
    vi.mocked(loadExtensionArchive).mockResolvedValueOnce({
      manifest,
      entryCode: 'new-zip-entry',
      files: {},
    });

    const result = await extensionManager.installExtensionFromZip(new Blob());

    expect(result?.manifest.version).toBe('4.0.0');
    expect(result?.cache.entryCode).toBe('new-zip-entry');
    expect(result?.enabled).toBe(true);
    expect(mocks.loadModule).toHaveBeenLastCalledWith(
      'new-zip-entry',
      {},
      expect.any(Object),
      'nested/index.js'
    );
    expect(
      extensionManager.getActiveExtensions().find(active => active.manifest.id === extensionId)
        ?.manifest.version
    ).toBe('4.0.0');
  });

  it('restores an active package when ZIP replacement activation fails', async () => {
    const oldExports: ExtensionExports = { activate: async () => ({}) };
    const failedExports: ExtensionExports = {
      activate: async () => {
        throw new Error('replacement activation failed');
      },
    };
    mocks.activate.mockImplementation((exports, context) => exports.activate(context));
    mocks.loadModule
      .mockResolvedValueOnce(oldExports)
      .mockResolvedValueOnce(failedExports)
      .mockResolvedValueOnce(oldExports);
    expect(await extensionManager.enableExtension(extensionId)).toBe(true);
    const previousCache = mocks.installed[0].cache;
    vi.mocked(loadExtensionArchive).mockResolvedValueOnce({
      manifest: { ...mocks.installed[0].manifest, version: '4.0.0' },
      entryCode: 'failed-zip-entry',
      files: {},
    });

    expect(await extensionManager.installExtensionFromZip(new Blob())).toBeNull();

    expect(mocks.installed[0].manifest.version).toBe('3.2.1');
    expect(mocks.installed[0].cache).toBe(previousCache);
    expect(mocks.installed[0].enabled).toBe(true);
    expect(
      extensionManager.getActiveExtensions().find(active => active.manifest.id === extensionId)
        ?.manifest.version
    ).toBe('3.2.1');
  });

  it('restores an inactive package when ZIP replacement activation fails', async () => {
    mocks.activate.mockImplementation((exports, context) => exports.activate(context));
    mocks.loadModule.mockResolvedValue({
      activate: async () => {
        throw new Error('replacement activation failed');
      },
    });
    const previousCache = mocks.installed[0].cache;
    vi.mocked(loadExtensionArchive).mockResolvedValueOnce({
      manifest: { ...mocks.installed[0].manifest, version: '4.0.0' },
      entryCode: 'failed-zip-entry',
      files: {},
    });

    expect(await extensionManager.installExtensionFromZip(new Blob())).toBeNull();

    expect(mocks.installed[0].manifest.version).toBe('3.2.1');
    expect(mocks.installed[0].cache).toBe(previousCache);
    expect(mocks.installed[0].enabled).toBe(false);
    expect(extensionManager.getActiveExtensions()).toHaveLength(0);
  });

  it('restores the previous package and activation when an update fails to activate', async () => {
    const previous = mocks.installed[0];
    const oldExports: ExtensionExports = { activate: async () => ({}) };
    const failedExports: ExtensionExports = {
      activate: async () => {
        throw new Error('activation failure');
      },
    };
    mocks.loadModule
      .mockResolvedValueOnce(oldExports)
      .mockResolvedValueOnce(failedExports)
      .mockResolvedValueOnce(oldExports);
    vi.mocked(fetchExtensionManifest).mockResolvedValueOnce({
      ...previous.manifest,
      version: '4.0.0',
    });
    vi.mocked(fetchExtensionCode).mockResolvedValueOnce({ entryCode: 'new-entry', files: {} });

    expect(await extensionManager.enableExtension(extensionId)).toBe(true);
    expect(await extensionManager.updateExtension(extensionId, '/new/manifest.json')).toBeNull();
    expect(mocks.installed[0].cache.entryCode).toBe(previous.cache.entryCode);
    expect(mocks.installed[0].enabled).toBe(true);
    expect(extensionManager.getActiveExtensions().map(active => active.manifest.id)).toContain(
      extensionId
    );
  });

  it('persists and reports a disabled restored package when reactivation fails', async () => {
    const previous = mocks.installed[0];
    const oldExports: ExtensionExports = { activate: async () => ({}) };
    const failedExports: ExtensionExports = {
      activate: async () => {
        throw new Error('activation failure');
      },
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.activate.mockImplementation((exports, context) => exports.activate(context));
    mocks.loadModule
      .mockResolvedValueOnce(oldExports)
      .mockResolvedValueOnce(failedExports)
      .mockResolvedValueOnce(failedExports);
    vi.mocked(fetchExtensionManifest).mockResolvedValueOnce({
      ...previous.manifest,
      version: '4.0.0',
    });
    vi.mocked(fetchExtensionCode).mockResolvedValueOnce({ entryCode: 'new-entry', files: {} });

    expect(await extensionManager.enableExtension(extensionId)).toBe(true);
    expect(await extensionManager.updateExtension(extensionId, '/new/manifest.json')).toBeNull();

    expect(mocks.installed[0].manifest.version).toBe('3.2.1');
    expect(mocks.installed[0].cache.entryCode).toBe('');
    expect(mocks.installed[0].enabled).toBe(false);
    expect(mocks.installed[0].status).toBe(ExtensionStatus.INSTALLED);
    expect(extensionManager.getActiveExtensions()).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith(
      `[ExtensionManager] Restored package remains disabled after activation failure: ${extensionId}`
    );
  });

  it('restores the previous onlyOne extension when replacement activation fails', async () => {
    const previousId = 'pyxis.previous-rollback-fixture';
    const previousManifest: ExtensionManifest = {
      ...mocks.installed[0].manifest,
      id: previousId,
      onlyOne: 'rollback-group',
    };
    const target = mocks.installed[0];
    target.manifest.onlyOne = 'rollback-group';
    target.cache.entryCode = 'target';
    mocks.installed.unshift({
      ...target,
      manifest: previousManifest,
      enabled: true,
      cache: { entryCode: 'previous', cachedAt: 0 },
    });
    mocks.loadModule.mockImplementation(async entryCode => ({
      activate: async context => {
        if (entryCode === 'target') {
          context.tabs.registerTabType(() => null);
          throw new Error('replacement activation failure');
        }
        return {};
      },
    }));

    const previousEnabled = await extensionManager.enableExtension(previousId);
    expect(previousEnabled).toBe(true);

    const targetEnabled = await extensionManager.enableExtension(extensionId);

    expect(targetEnabled).toBe(false);
    expect(extensionManager.getActiveExtensions().map(active => active.manifest.id)).toContain(
      previousId
    );
    expect(mocks.installed.find(extension => extension.manifest.id === previousId)?.enabled).toBe(
      true
    );
    expect(tabRegistry.has(tabKind)).toBe(false);
  });

  it('reports when an onlyOne extension cannot be restored after activation rollback', async () => {
    const previousId = 'pyxis.previous-restore-failure-fixture';
    const group = 'restore-failure-group';
    const target = mocks.installed[0];
    target.manifest.onlyOne = group;
    target.cache.entryCode = 'target';
    mocks.installed.unshift({
      ...target,
      manifest: { ...target.manifest, id: previousId },
      enabled: true,
      cache: { entryCode: 'previous', cachedAt: 0 },
    });
    let failPreviousActivation = false;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loadModule.mockImplementation(async entryCode => ({
      activate: async () => {
        if (entryCode === 'target' || (entryCode === 'previous' && failPreviousActivation)) {
          throw new Error('activation failure');
        }
        return {};
      },
    }));

    expect(await extensionManager.enableExtension(previousId)).toBe(true);
    failPreviousActivation = true;

    expect(await extensionManager.enableExtension(extensionId)).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      `[ExtensionManager] Failed to restore conflicting extension: ${previousId}`
    );
    expect(extensionManager.getActiveExtensions().map(active => active.manifest.id)).not.toContain(
      previousId
    );
  });

  it('serializes concurrent enables in the same onlyOne group', async () => {
    const concurrentId = 'pyxis.concurrent-rollback-fixture';
    const group = 'concurrent-group';
    const first = mocks.installed[0];
    first.manifest.onlyOne = group;
    const concurrent: InstalledExtension = {
      ...first,
      manifest: { ...first.manifest, id: concurrentId },
      enabled: false,
      status: ExtensionStatus.INSTALLED,
    };
    mocks.installed.push(concurrent);
    mocks.loadModule.mockResolvedValue({ activate: async () => ({}) });

    const results = await Promise.all([
      extensionManager.enableExtension(extensionId),
      extensionManager.enableExtension(concurrentId),
    ]);

    expect(results).toEqual([true, true]);
    const activeIds = extensionManager
      .getActiveExtensions()
      .map(active => active.manifest.id)
      .filter(id => id === extensionId || id === concurrentId);
    expect(activeIds).toHaveLength(1);
  });

  it('does not dispose an extension a second time after disable persistence fails', async () => {
    mocks.loadModule.mockResolvedValue({
      activate: async context => {
        context.tabs.registerTabType(() => null);
        return {};
      },
    });
    expect(await extensionManager.enableExtension(extensionId)).toBe(true);
    const unregister = vi.spyOn(tabRegistry, 'unregister');
    vi.mocked(saveInstalledExtension).mockRejectedValueOnce(new Error('storage failure'));

    expect(await extensionManager.disableExtension(extensionId)).toBe(false);
    expect(await extensionManager.disableExtension(extensionId)).toBe(false);

    expect(unregister).toHaveBeenCalledTimes(1);
    unregister.mockRestore();
  });

  it('cleans up and uninstalls after deactivation fails', async () => {
    mocks.loadModule.mockResolvedValue({ activate: async () => ({}) });
    expect(await extensionManager.enableExtension(extensionId)).toBe(true);
    mocks.deactivate.mockRejectedValueOnce(new Error('deactivation failure'));
    vi.mocked(deleteInstalledExtension).mockImplementationOnce(async id => {
      mocks.installed = mocks.installed.filter(extension => extension.manifest.id !== id);
    });

    expect(await extensionManager.uninstallExtension(extensionId)).toBe(true);
    expect(deleteInstalledExtension).toHaveBeenCalledWith(extensionId);
    expect(extensionManager.getActiveExtensions().map(active => active.manifest.id)).not.toContain(
      extensionId
    );
    expect(saveInstalledExtension).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false, status: ExtensionStatus.INSTALLED })
    );
    expect(mocks.installed).toHaveLength(0);
  });

  it('waits for pending activation before disabling', async () => {
    let enterActivation!: () => void;
    let finishActivation!: () => void;
    const entered = new Promise<void>(resolve => {
      enterActivation = resolve;
    });
    const gate = new Promise<void>(resolve => {
      finishActivation = resolve;
    });
    mocks.loadModule.mockResolvedValue({
      activate: async context => {
        context.tabs.registerTabType(() => null);
        enterActivation();
        await gate;
        return {};
      },
    });

    const enabling = extensionManager.enableExtension(extensionId);
    await entered;
    const disabling = extensionManager.disableExtension(extensionId);
    let disableFinished = false;
    void disabling.then(() => {
      disableFinished = true;
    });
    await Promise.resolve();
    expect(disableFinished).toBe(false);

    finishActivation();
    expect(await enabling).toBe(true);
    expect(await disabling).toBe(true);
    expect(extensionManager.getActiveExtensions().map(active => active.manifest.id)).not.toContain(
      extensionId
    );
    expect(mocks.installed[0].enabled).toBe(false);
    expect(tabRegistry.has(tabKind)).toBe(false);
  });

  it('unsubscribes system module listeners when disabled', async () => {
    const unsubscribeFs = vi.fn();
    const originalGetSystemModule = systemModules.getSystemModule;
    const getSystemModule = vi.spyOn(systemModules, 'getSystemModule');
    getSystemModule.mockImplementation((async name => {
      if (name === 'fsClient') {
        return { addChangeListener: vi.fn(() => unsubscribeFs) };
      }
      return originalGetSystemModule(name);
    }) as typeof systemModules.getSystemModule);
    const actionId = 'extension-lifecycle-cleanup-fixture';
    const keybindingCallback = vi.fn();
    const workspaceCallback = vi.fn();
    const previousRootPath = projectState.currentRootPath;
    projectState.currentRootPath = '/workspace/before';
    mocks.loadModule.mockResolvedValue({
      activate: async context => {
        const fs = await context.getSystemModule('fsClient');
        fs.addChangeListener(() => {});
        const workspace = await context.getSystemModule('workspace');
        workspace.subscribe(workspaceCallback);
        const keybindings = await context.getSystemModule('keybindings');
        keybindings.registerAction(actionId, keybindingCallback);
        return {};
      },
    });

    try {
      expect(await extensionManager.enableExtension(extensionId)).toBe(true);
      projectState.currentRootPath = '/workspace/during';
      await new Promise(resolve => setTimeout(resolve, 0));
      triggerAction(actionId);
      expect(workspaceCallback).toHaveBeenCalledOnce();
      expect(keybindingCallback).toHaveBeenCalledOnce();

      expect(await extensionManager.disableExtension(extensionId)).toBe(true);
      expect(unsubscribeFs).toHaveBeenCalledOnce();
      projectState.currentRootPath = '/workspace/after';
      await new Promise(resolve => setTimeout(resolve, 0));
      triggerAction(actionId);
      expect(workspaceCallback).toHaveBeenCalledOnce();
      expect(keybindingCallback).toHaveBeenCalledOnce();
    } finally {
      projectState.currentRootPath = previousRootPath;
      getSystemModule.mockRestore();
    }
  });

  it('waits for pending activation before uninstalling without restoring a record', async () => {
    let enterActivation!: () => void;
    let finishActivation!: () => void;
    const entered = new Promise<void>(resolve => {
      enterActivation = resolve;
    });
    const gate = new Promise<void>(resolve => {
      finishActivation = resolve;
    });
    mocks.loadModule.mockResolvedValue({
      activate: async () => {
        enterActivation();
        await gate;
        return {};
      },
    });
    vi.mocked(deleteInstalledExtension).mockImplementationOnce(async id => {
      mocks.installed = mocks.installed.filter(extension => extension.manifest.id !== id);
    });

    const enabling = extensionManager.enableExtension(extensionId);
    await entered;
    const uninstalling = extensionManager.uninstallExtension(extensionId);
    let uninstallFinished = false;
    void uninstalling.then(() => {
      uninstallFinished = true;
    });
    await Promise.resolve();
    expect(uninstallFinished).toBe(false);

    finishActivation();
    expect(await enabling).toBe(true);
    expect(await uninstalling).toBe(true);
    expect(extensionManager.getActiveExtensions().map(active => active.manifest.id)).not.toContain(
      extensionId
    );
    expect(mocks.installed).toHaveLength(0);
  });
});
