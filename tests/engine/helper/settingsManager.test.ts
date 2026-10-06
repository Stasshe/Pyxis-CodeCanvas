import { describe, expect, it } from 'vitest';
import { HOME_DIR } from '@/engine/core/pathUtils';
import { SettingsManager } from '@/engine/helper/settingsManager';
import type { PyxisSettings } from '@/types/settings';
import { directoryTree } from '../../_helpers/opfs';
import { resetTestFs } from '../../_helpers/testFs';

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
});
