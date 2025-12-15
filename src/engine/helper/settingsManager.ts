/**
 * SettingsManager - .pyxis/settings.json の読み書きを管理
 */

import { fileRepository } from '@/engine/core/fileRepository'
import { DEFAULT_PYXIS_SETTINGS, type PyxisSettings } from '@/types/settings'

const SETTINGS_PATH = '/.pyxis/settings.json'

export class SettingsManager {
  private static instance: SettingsManager | null = null
  private cache: Map<string, PyxisSettings> = new Map()
  private listeners: Map<string, Set<(settings: PyxisSettings) => void>> = new Map()
  private isUpdating: Map<string, boolean> = new Map() // 循環参照防止フラグ

  private constructor() {
    // ファイル変更イベントを監視
    fileRepository.addChangeListener(event => {
      if (event.file.path === SETTINGS_PATH && event.type === 'update') {
        // 自分自身の更新でない場合のみリスナーに通知
        if (!this.isUpdating.get(event.projectId)) {
          this.loadSettings(event.projectId).then(settings => {
            this.notifyListeners(event.projectId, settings)
          })
        }
      }
    })
  }

  static getInstance(): SettingsManager {
    if (!SettingsManager.instance) {
      SettingsManager.instance = new SettingsManager()
    }
    return SettingsManager.instance
  }

  /**
   * 設定変更リスナーを追加
   */
  addListener(projectId: string, listener: (settings: PyxisSettings) => void): () => void {
    if (!this.listeners.has(projectId)) {
      this.listeners.set(projectId, new Set())
    }
    this.listeners.get(projectId)!.add(listener)

    // アンサブスクライブ関数を返す
    return () => {
      const listeners = this.listeners.get(projectId)
      if (listeners) {
        listeners.delete(listener)
        if (listeners.size === 0) {
          this.listeners.delete(projectId)
        }
      }
    }
  }

  /**
   * リスナーに通知
   */
  private notifyListeners(projectId: string, settings: PyxisSettings): void {
    const listeners = this.listeners.get(projectId)
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(settings)
        } catch (error) {
          console.error('[SettingsManager] Listener error:', error)
        }
      })
    }
  }

  /**
   * 設定を読み込む
   */
  async loadSettings(projectId: string): Promise<PyxisSettings> {
    try {
      // Use path-based lookup to avoid reading the entire project file list
      const settingsFile = await fileRepository.getFileByPath(projectId, SETTINGS_PATH)

      if (!settingsFile || !settingsFile.content) {
        // 設定ファイルがない場合はデフォルトを作成
        const defaultSettings = { ...DEFAULT_PYXIS_SETTINGS }
        await this.saveSettings(projectId, defaultSettings)
        this.cache.set(projectId, defaultSettings)
        return defaultSettings
      }

      const settings = JSON.parse(settingsFile.content) as PyxisSettings

      // デフォルト値とマージ（新しいプロパティが追加された場合に対応）
      const mergedSettings = this.mergeWithDefaults(settings)

      this.cache.set(projectId, mergedSettings)
      return mergedSettings
    } catch (error) {
      console.error('[SettingsManager] Failed to load settings:', error)
      return DEFAULT_PYXIS_SETTINGS
    }
  }

  /**
   * 設定を保存
   */
  async saveSettings(projectId: string, settings: PyxisSettings): Promise<void> {
    try {
      // 循環参照防止フラグを立てる
      this.isUpdating.set(projectId, true)

      const content = JSON.stringify(settings, null, 2)

      // .pyxisフォルダを作成（存在しない場合）
      const pyxisFolder = await fileRepository.getFileByPath(projectId, '/.pyxis')
      if (!pyxisFolder) {
        await fileRepository.createFile(projectId, '/.pyxis', '', 'folder')
      }

      // settings.jsonを作成または更新
      await fileRepository.createFile(projectId, SETTINGS_PATH, content, 'file')

      // キャッシュを更新
      this.cache.set(projectId, settings)

      // リスナーに通知
      this.notifyListeners(projectId, settings)
    } catch (error) {
      console.error('[SettingsManager] Failed to save settings:', error)
      throw error
    } finally {
      // フラグを下ろす
      setTimeout(() => {
        this.isUpdating.set(projectId, false)
      }, 100)
    }
  }

  /**
   * 設定を部分更新
   */
  async updateSettings(
    projectId: string,
    updates: Partial<PyxisSettings> | ((current: PyxisSettings) => Partial<PyxisSettings>)
  ): Promise<void> {
    const currentSettings = await this.loadSettings(projectId)

    const updateObj = typeof updates === 'function' ? updates(currentSettings) : updates

    const newSettings = this.deepMerge(currentSettings, updateObj)
    await this.saveSettings(projectId, newSettings)
  }

  /**
   * キャッシュをクリア
   */
  clearCache(projectId?: string): void {
    if (projectId) {
      this.cache.delete(projectId)
    } else {
      this.cache.clear()
    }
  }

  /**
   * デフォルト値とマージ
   */
  private mergeWithDefaults(settings: Partial<PyxisSettings>): PyxisSettings {
    return this.deepMerge(DEFAULT_PYXIS_SETTINGS, settings) as PyxisSettings
  }

  /**
   * ディープマージ
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target }

    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key])
      } else {
        result[key] = source[key]
      }
    }

    return result
  }
}

export const settingsManager = SettingsManager.getInstance()
