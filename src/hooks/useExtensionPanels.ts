/**
 * useExtensionPanels Hook
 * 拡張機能が登録したサイドバーパネルを取得
 */

import { useState, useEffect } from 'react'

import { sidebarRegistry } from '@/engine/extensions/system-api/SidebarAPI'

export interface ExtensionPanelInfo {
  extensionId: string
  panelId: string
  title: string
  icon: string
  order: number
}

/**
 * 拡張機能のサイドバーパネル一覧を取得するフック
 */
export function useExtensionPanels(): ExtensionPanelInfo[] {
  const [panels, setPanels] = useState<ExtensionPanelInfo[]>([])

  useEffect(() => {
    // 初期読み込み
    const loadPanels = () => {
      const allPanels = sidebarRegistry.getAllPanels()
      const panelInfos: ExtensionPanelInfo[] = allPanels.map(panel => ({
        extensionId: panel.extensionId,
        panelId: panel.definition.id,
        title: panel.definition.title,
        icon: panel.definition.icon,
        order: panel.definition.order ?? 100,
      }))
      setPanels(panelInfos)
    }

    loadPanels()

    // レジストリの変更を監視
    const unsubscribe = sidebarRegistry.addChangeListener(() => {
      loadPanels()
    })

    return unsubscribe
  }, [])

  return panels
}
