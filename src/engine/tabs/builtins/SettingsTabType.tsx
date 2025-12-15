// src/engine/tabs/builtins/SettingsTabType.tsx
import type React from 'react'

import type { SettingsTab, TabComponentProps, TabTypeDefinition } from '../types'

import ShortcutKeysTab from '@/components/Tab/ShortcutKeysTab'

/**
 * 設定タブのコンポーネント
 */
const SettingsTabRenderer: React.FC<TabComponentProps> = ({ tab }) => {
  const settingsTab = tab as SettingsTab

  // settingsTypeに応じて異なるコンポーネントを返す
  if (settingsTab.settingsType === 'shortcuts') {
    return <ShortcutKeysTab />
  }

  // デフォルトは一般設定
  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Settings</h2>
      <p>General settings panel (to be implemented)</p>
    </div>
  )
}

/**
 * 設定タブタイプの定義
 */
export const SettingsTabType: TabTypeDefinition = {
  kind: 'settings',
  displayName: 'Settings',
  icon: 'Settings',
  canEdit: false,
  canPreview: false,
  component: SettingsTabRenderer,

  createTab: (file, options): SettingsTab => {
    const settingsType = file.settingsType || 'general'
    const tabId = `settings:${settingsType}`

    return {
      id: tabId,
      name: file.name || 'Settings',
      kind: 'settings',
      path: `settings/${settingsType}`,
      paneId: options?.paneId || '',
      settingsType,
    }
  },

  shouldReuseTab: (existingTab, newFile, options) => {
    const existingSettings = existingTab as SettingsTab
    return existingSettings.settingsType === newFile.settingsType && existingTab.kind === 'settings'
  },
}
