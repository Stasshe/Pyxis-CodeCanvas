// src/stores/sessionStorage.ts
/**
 * Pyxis Session Storage
 *
 * タブ状態、UI状態など、セッション全体をIndexedDBで管理（プロジェクト別）
 * - タブ・ペイン構造
 * - UI状態（サイドバー幅、表示/非表示）
 * - メタデータ（バージョン、最終保存時刻）
 */

import { storageService, STORES } from '@/engine/storage'
import { EditorPane } from '@/engine/tabs/types'

/**
 * Pyxisセッションの型定義
 */
export interface PyxisSession {
  version: number
  lastSaved: number
  tabs: {
    panes: EditorPane[]
    activePane: string | null
    globalActiveTab: string | null
  }
  ui: {
    leftSidebarWidth: number
    rightSidebarWidth: number
    bottomPanelHeight: number
    isLeftSidebarVisible: boolean
    isRightSidebarVisible: boolean
    isBottomPanelVisible: boolean
  }
}

/**
 * デフォルトセッション
 */
export const DEFAULT_SESSION: PyxisSession = {
  version: 1,
  lastSaved: Date.now(),
  tabs: {
    panes: [
      {
        id: 'pane-1',
        tabs: [],
        activeTabId: '',
      },
    ],
    activePane: 'pane-1',
    globalActiveTab: null,
  },
  ui: {
    leftSidebarWidth: 240,
    rightSidebarWidth: 240,
    bottomPanelHeight: 200,
    isLeftSidebarVisible: true,
    isRightSidebarVisible: true,
    isBottomPanelVisible: true,
  },
}

/**
 * セッションストレージ管理クラス
 */
class SessionStorageManager {
  private getSessionKey(projectId: string): string {
    return `session-${projectId}`
  }

  private getUIKey(projectId: string): string {
    return `ui-state-${projectId}`
  }

  async save(session: PyxisSession, projectId: string): Promise<void> {
    const sessionToSave: PyxisSession = {
      ...session,
      lastSaved: Date.now(),
    }

    const cleanedSession = this.cleanSessionForStorage(sessionToSave)
    await storageService.set(STORES.SESSION_STATE, this.getSessionKey(projectId), cleanedSession)
  }

  async load(projectId: string): Promise<PyxisSession> {
    const session = await storageService.get<PyxisSession>(
      STORES.SESSION_STATE,
      this.getSessionKey(projectId)
    )

    if (!session) {
      return DEFAULT_SESSION
    }

    return this.prepareSessionForRestore(session)
  }

  async saveUIState(uiState: PyxisSession['ui'], projectId: string): Promise<void> {
    await storageService.set(STORES.SESSION_STATE, this.getUIKey(projectId), {
      ...uiState,
      lastSaved: Date.now(),
    })
  }

  async loadUIState(projectId: string): Promise<PyxisSession['ui']> {
    const saved = await storageService.get<PyxisSession['ui']>(
      STORES.SESSION_STATE,
      this.getUIKey(projectId)
    )
    return saved || DEFAULT_SESSION.ui
  }

  async clear(projectId: string): Promise<void> {
    await storageService.delete(STORES.SESSION_STATE, this.getSessionKey(projectId))
  }

  private cleanSessionForStorage(session: PyxisSession): PyxisSession {
    const cleanPanes = (panes: EditorPane[]): EditorPane[] => {
      return panes.map(pane => ({
        ...pane,
        tabs: pane.tabs.map(tab => {
          const { content, bufferContent, needsContentRestore, ...tabRest } = tab as any
          return tabRest
        }),
        children: pane.children ? cleanPanes(pane.children) : undefined,
      }))
    }

    return {
      ...session,
      tabs: {
        ...session.tabs,
        panes: cleanPanes(session.tabs.panes),
      },
    }
  }

  private prepareSessionForRestore(session: PyxisSession): PyxisSession {
    const markPanesForRestore = (panes: EditorPane[]): EditorPane[] => {
      return panes.map(pane => ({
        ...pane,
        tabs: pane.tabs.map(tab => {
          if (tab.kind === 'welcome' || tab.kind === 'settings') {
            return tab
          }
          return {
            ...tab,
            content: '',
            needsContentRestore: true,
          } as any
        }),
        children: pane.children ? markPanesForRestore(pane.children) : undefined,
      }))
    }

    return {
      ...session,
      tabs: {
        ...session.tabs,
        panes: markPanesForRestore(session.tabs.panes),
      },
    }
  }
}

/**
 * グローバルインスタンス
 */
export const sessionStorage = new SessionStorageManager()
