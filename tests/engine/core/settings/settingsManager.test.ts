import { describe, expect, it, vi } from 'vitest';
import { fsClient } from '@/engine/core/fs/index';
import { HOME_DIR } from '@/engine/core/paths';
import { SettingsManager } from '@/engine/core/settings/settingsManager';
import type { PyxisSettings } from '@/types/settings';
import { directoryTree } from '../../../_helpers/opfs';
import { resetTestFs } from '../../../_helpers/testFs';

describe('SettingsManager', () => {
  it('returns defaults without creating settings in empty workspaces', async () => {
    const fs = resetTestFs();
    await fs.init(directoryTree());
    const existingWorkspace = `${HOME_DIR}/existing`;
    const newWorkspace = `${HOME_DIR}/new`;
    await fs.mkdir(existingWorkspace);

    const manager = SettingsManager.getInstance();
    await manager.loadSettings(existingWorkspace);
    await manager.loadSettings(newWorkspace);

    expect(await fs.readdir(existingWorkspace)).toEqual([]);
    expect(await fs.exists(newWorkspace)).toBe(false);
    expect(await fs.exists(`${existingWorkspace}/.pyxis`)).toBe(false);
    expect(await fs.exists(`${newWorkspace}/.pyxis`)).toBe(false);
  });

  it('persists explicit updates and retains the supplied setting', async () => {
    const fs = resetTestFs();
    await fs.init(directoryTree());
    const rootPath = `${HOME_DIR}/workspace`;
    await fs.mkdir(rootPath);
    const manager = SettingsManager.getInstance();

    await manager.updateSettings(rootPath, { editor: { fontSize: 19 } });

    const settings = JSON.parse(
      await fs.readText(`${rootPath}/.pyxis/settings.json`)
    ) as PyxisSettings;
    expect(settings.editor.fontSize).toBe(19);
  });

  it('serializes concurrent updates so neither setting overwrites the other', async () => {
    const fs = resetTestFs();
    await fs.init(directoryTree());
    const rootPath = `${HOME_DIR}/workspace`;
    await fs.mkdir(rootPath);
    const manager = SettingsManager.getInstance();

    await Promise.all([
      manager.updateSettings(rootPath, { editor: { fontSize: 19 } }),
      manager.updateSettings(rootPath, { theme: { colorTheme: 'light' } }),
    ]);

    const settings = JSON.parse(
      await fs.readText(`${rootPath}/.pyxis/settings.json`)
    ) as PyxisSettings;
    expect(settings.editor.fontSize).toBe(19);
    expect(settings.theme.colorTheme).toBe('light');
  });

  it('allows updates to different roots to proceed independently', async () => {
    const fs = resetTestFs();
    await fs.init(directoryTree());
    const rootA = `${HOME_DIR}/workspace-a`;
    const rootB = `${HOME_DIR}/workspace-b`;
    await fs.mkdir(`${rootA}/.pyxis`, { recursive: true });
    await fs.mkdir(`${rootB}/.pyxis`, { recursive: true });
    await fs.writeFile(`${rootA}/.pyxis/settings.json`, '{}');
    await fs.writeFile(`${rootB}/.pyxis/settings.json`, '{}');

    const manager = SettingsManager.getInstance();
    let releaseRootA!: () => void;
    let signalRootARead!: () => void;
    const rootAGate = new Promise<void>(resolve => {
      releaseRootA = resolve;
    });
    const rootAReadStarted = new Promise<void>(resolve => {
      signalRootARead = resolve;
    });
    const readText = fsClient.readText.bind(fsClient);
    const readTextSpy = vi.spyOn(fsClient, 'readText').mockImplementation(async path => {
      if (path === `${rootA}/.pyxis/settings.json`) {
        signalRootARead();
        await rootAGate;
      }
      return readText(path);
    });

    const updateA = manager.updateSettings(rootA, { editor: { fontSize: 19 } });
    await rootAReadStarted;
    const updateB = manager.updateSettings(rootB, { theme: { colorTheme: 'light' } });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const rootBSettled = await Promise.race([
        updateB.then(() => true),
        new Promise<boolean>(resolve => {
          timeout = setTimeout(() => resolve(false), 1000);
        }),
      ]);
      expect(rootBSettled).toBe(true);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      releaseRootA();
      readTextSpy.mockRestore();
    }
    await Promise.all([updateA, updateB]);

    const settingsA = JSON.parse(
      await fs.readText(`${rootA}/.pyxis/settings.json`)
    ) as PyxisSettings;
    const settingsB = JSON.parse(
      await fs.readText(`${rootB}/.pyxis/settings.json`)
    ) as PyxisSettings;
    expect(settingsA.editor.fontSize).toBe(19);
    expect(settingsB.theme.colorTheme).toBe('light');
  });
});
