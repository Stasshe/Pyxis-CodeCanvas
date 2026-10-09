/** SettingsManager - workspace `.pyxis/settings.json` persistence. */

import { fsClient, resolvePath } from '@/engine/core/fs';
import { DEFAULT_PYXIS_SETTINGS, type PyxisSettings } from '@/types/settings';

const SETTINGS_PATH = '.pyxis/settings.json';

const mergeSettings = (base: PyxisSettings, updates: Partial<PyxisSettings>): PyxisSettings => {
  const theme = { ...base.theme, ...updates.theme };
  if (updates.theme?.customColors) {
    theme.customColors = { ...base.theme.customColors, ...updates.theme.customColors };
  }

  return {
    editor: { ...base.editor, ...updates.editor },
    theme,
    search: { ...base.search, ...updates.search },
    files: { ...base.files, ...updates.files },
    markdown: {
      ...base.markdown,
      ...updates.markdown,
      math: { ...base.markdown.math, ...updates.markdown?.math },
    },
  };
};

export class SettingsManager {
  private static instance: SettingsManager | null = null;
  private listeners = new Map<string, Set<(settings: PyxisSettings) => void>>();
  private updating = new Set<string>();
  private pendingUpdates = new Map<string, Promise<void>>();

  private constructor() {
    fsClient.addChangeListener(event => {
      for (const rootPath of this.listeners.keys()) {
        const settingsPath = resolvePath(rootPath, SETTINGS_PATH);
        if (event.path !== settingsPath || this.updating.has(rootPath)) continue;
        void this.loadSettings(rootPath)
          .then(settings => this.notifyListeners(rootPath, settings))
          .catch(error => console.error('[SettingsManager] Failed to reload settings:', error));
      }
    });
  }

  static getInstance(): SettingsManager {
    if (!SettingsManager.instance) SettingsManager.instance = new SettingsManager();
    return SettingsManager.instance;
  }

  addListener(rootPath: string, listener: (settings: PyxisSettings) => void): () => void {
    if (!this.listeners.has(rootPath)) this.listeners.set(rootPath, new Set());
    this.listeners.get(rootPath)?.add(listener);
    return () => {
      const listeners = this.listeners.get(rootPath);
      if (!listeners) return;
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(rootPath);
    };
  }

  private notifyListeners(rootPath: string, settings: PyxisSettings): void {
    this.listeners.get(rootPath)?.forEach(listener => {
      listener(settings);
    });
  }

  async loadSettings(rootPath: string): Promise<PyxisSettings> {
    const settingsPath = resolvePath(rootPath, SETTINGS_PATH);
    await fsClient.init();
    if (!(await fsClient.exists(settingsPath))) {
      return DEFAULT_PYXIS_SETTINGS;
    }

    const stored = JSON.parse(await fsClient.readText(settingsPath)) as Partial<PyxisSettings>;
    const settings = mergeSettings(DEFAULT_PYXIS_SETTINGS, stored);
    return settings;
  }

  async saveSettings(rootPath: string, settings: PyxisSettings): Promise<void> {
    this.updating.add(rootPath);
    try {
      const directory = resolvePath(rootPath, '.pyxis');
      await fsClient.mkdir(directory, { recursive: true });
      await fsClient.writeFile(
        resolvePath(rootPath, SETTINGS_PATH),
        JSON.stringify(settings, null, 2)
      );
      this.notifyListeners(rootPath, settings);
    } finally {
      this.updating.delete(rootPath);
    }
  }

  async updateSettings(
    rootPath: string,
    updates: Partial<PyxisSettings> | ((current: PyxisSettings) => Partial<PyxisSettings>)
  ): Promise<void> {
    const previousUpdate = this.pendingUpdates.get(rootPath) ?? Promise.resolve();
    const update = previousUpdate
      .catch(() => undefined)
      .then(async () => {
        const current = await this.loadSettings(rootPath);
        let changes: Partial<PyxisSettings>;
        if (typeof updates === 'function') {
          changes = updates(current);
        } else {
          changes = updates;
        }
        await this.saveSettings(rootPath, mergeSettings(current, changes));
      });
    this.pendingUpdates.set(rootPath, update);

    try {
      await update;
    } finally {
      if (this.pendingUpdates.get(rootPath) === update) {
        this.pendingUpdates.delete(rootPath);
      }
    }
  }
}

export const settingsManager = SettingsManager.getInstance();
