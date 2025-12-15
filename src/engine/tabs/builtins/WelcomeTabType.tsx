// src/engine/tabs/builtins/WelcomeTabType.tsx
import type React from 'react'

import type { OpenTabOptions, TabComponentProps, TabTypeDefinition, WelcomeTab } from '../types'

import WelcomeTabView from '@/components/Tab/WelcomeTab'

/**
 * ウェルカムタブのコンポーネント
 */
const WelcomeTabComponent: React.FC<TabComponentProps> = () => {
  return <WelcomeTabView />
}

/**
 * ウェルカムタブの型定義
 */
export const WelcomeTabType: TabTypeDefinition = {
  kind: 'welcome',
  displayName: 'Welcome',
  canEdit: false,
  canPreview: false,

  createTab: (data: unknown, options?: OpenTabOptions) => {
    const tabId = 'welcome'
    const paneId = options?.targetPaneId || ''

    return {
      id: tabId,
      name: 'Welcome',
      path: 'welcome',
      kind: 'welcome',
      paneId,
    } as WelcomeTab
  },

  component: WelcomeTabComponent,
}
