// src/stores/sessionStorage.ts
/**
 * Pyxis Session Storage
 *
 * タブ状態、UI状態など、セッション全体をIndexedDBで管理
 * - タブ・ペイン構造
 * - UI状態（サイドバー幅、表示/非表示）
 * - メタデータ（バージョン、最終保存時刻）
 */

import { storageService, STORES } from '@/engine/storage';
import { EditorPane } from '@/engine/tabs/types';

/**
 * Pyxisセッションの型定義
 */
export interface PyxisSession {
  version: number;
  lastSaved: number;
  tabs: {
    panes: EditorPane[];
    activePane: string | null;
    globalActiveTab: string | null;
  };
  ui: {
    leftSidebarWidth: number;
    rightSidebarWidth: number;
    bottomPanelHeight: number;
    isLeftSidebarVisible: boolean;
    isRightSidebarVisible: boolean;
    isBottomPanelVisible: boolean;
  };
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
};

const UI_STATE_KEY = 'ui-state'; // グローバルUI状態専用キー

/**
 * セッションストレージ管理クラス
 */
class SessionStorageManager {
  /**
   * プロジェクトごとのセッションキーを生成
   */
  private getSessionKey(projectId: string): string {
    return `session-${projectId}`;
  }

  /**
   * セッションを保存（プロジェクト別）
   */
  async save(session: PyxisSession, projectId: string): Promise<void> {
    try {
      const sessionToSave: PyxisSession = {
        ...session,
        lastSaved: Date.now(),
      };

      // contentやbufferContentを除外して保存
      const cleanedSession = this.cleanSessionForStorage(sessionToSave);

      const sessionKey = this.getSessionKey(projectId);
      await storageService.set(STORES.SESSION_STATE, sessionKey, cleanedSession);
      console.log(`[SessionStorage] Session saved for project: ${projectId}`);
    } catch (error) {
      console.error('[SessionStorage] Failed to save session:', error);
      throw error;
    }
  }

  /**
   * セッションを読み込み（プロジェクト別）
   */
  async load(projectId: string): Promise<PyxisSession> {
    try {
      const sessionKey = this.getSessionKey(projectId);
      const session = await storageService.get<PyxisSession>(STORES.SESSION_STATE, sessionKey);

      if (!session) {
        console.log(`[SessionStorage] No saved session found for project: ${projectId}, using default`);
        return DEFAULT_SESSION;
      }

      // 復元後にneedsContentRestoreフラグを設定
      const restoredSession = this.prepareSessionForRestore(session);

      console.log(`[SessionStorage] Session loaded for project: ${projectId}`);
      return restoredSession;
    } catch (error) {
      console.error('[SessionStorage] Failed to load session:', error);
      return DEFAULT_SESSION;
    }
  }

  /**
   * UI状態を保存（プロジェクト別）
   */
  async saveUIState(uiState: PyxisSession['ui'], projectId: string): Promise<void> {
    try {
      const uiKey = `ui-state-${projectId}`;
      await storageService.set(STORES.SESSION_STATE, uiKey, {
        ...uiState,
        lastSaved: Date.now(),
      });
      console.log(`[SessionStorage] UI state saved for project: ${projectId}`);
    } catch (error) {
      console.error('[SessionStorage] Failed to save UI state:', error);
      throw error;
    }
  }

  /**
   * UI状態を読み込み（プロジェクト別）
   */
  async loadUIState(projectId: string): Promise<PyxisSession['ui']> {
    try {
      const uiKey = `ui-state-${projectId}`;
      const saved = await storageService.get<PyxisSession['ui']>(STORES.SESSION_STATE, uiKey);
      if (saved) {
        console.log(`[SessionStorage] UI state loaded for project: ${projectId}`);
        return saved;
      }
      console.log(`[SessionStorage] No saved UI state found for project: ${projectId}, using default`);
      return DEFAULT_SESSION.ui;
    } catch (error) {
      console.error('[SessionStorage] Failed to load UI state:', error);
      return DEFAULT_SESSION.ui;
    }
  }

  /**
   * セッションをクリア（プロジェクト別）
   */
  async clear(projectId: string): Promise<void> {
    try {
      const sessionKey = this.getSessionKey(projectId);
      await storageService.delete(STORES.SESSION_STATE, sessionKey);
      console.log(`[SessionStorage] Session cleared for project: ${projectId}`);
    } catch (error) {
      console.error('[SessionStorage] Failed to clear session:', error);
      throw error;
    }
  }

  /**
   * 保存用にセッションをクリーンアップ
   * - content, bufferContent を除外
   * - needsContentRestore を除外
   */
  private cleanSessionForStorage(session: PyxisSession): PyxisSession {
    const cleanPanes = (panes: EditorPane[]): EditorPane[] => {
      return panes.map(pane => ({
        ...pane,
        tabs: pane.tabs.map(tab => {
          const { content, bufferContent, needsContentRestore, ...tabRest } = tab as any;
          return tabRest;
        }),
        children: pane.children ? cleanPanes(pane.children) : undefined,
      }));
    };

    return {
      ...session,
      tabs: {
        ...session.tabs,
        panes: cleanPanes(session.tabs.panes),
      },
    };
  }

  /**
   * 復元用にセッションを準備
   * - needsContentRestoreフラグを設定
   */
  private prepareSessionForRestore(session: PyxisSession): PyxisSession {
    const markPanesForRestore = (panes: EditorPane[]): EditorPane[] => {
      return panes.map(pane => ({
        ...pane,
        tabs: pane.tabs.map(tab => {
          // welcome タブや特殊なタブはコンテンツ復元不要
          if (tab.kind === 'welcome' || tab.kind === 'settings') {
            return tab;
          }
          // エディタタブなどはコンテンツ復元が必要
          return {
            ...tab,
            content: '',
            needsContentRestore: true,
          } as any;
        }),
        children: pane.children ? markPanesForRestore(pane.children) : undefined,
      }));
    };

    return {
      ...session,
      tabs: {
        ...session.tabs,
        panes: markPanesForRestore(session.tabs.panes),
      },
    };
  }
}

/**
 * グローバルインスタンス
 */
export const sessionStorage = new SessionStorageManager();
