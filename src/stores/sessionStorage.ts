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

const SESSION_KEY = 'current-session';

/**
 * セッションストレージ管理クラス
 */
class SessionStorageManager {
  /**
   * セッションを保存
   */
  async save(session: PyxisSession): Promise<void> {
    try {
      const sessionToSave: PyxisSession = {
        ...session,
        lastSaved: Date.now(),
      };

      // contentやbufferContentを除外して保存
      const cleanedSession = this.cleanSessionForStorage(sessionToSave);

      await storageService.set(STORES.USER_PREFERENCES, SESSION_KEY, cleanedSession);
      console.log('[SessionStorage] Session saved successfully');
    } catch (error) {
      console.error('[SessionStorage] Failed to save session:', error);
      throw error;
    }
  }

  /**
   * セッションを読み込み
   */
  async load(): Promise<PyxisSession> {
    try {
      const session = await storageService.get<PyxisSession>(STORES.USER_PREFERENCES, SESSION_KEY);

      if (!session) {
        console.log('[SessionStorage] No saved session found, using default');
        return DEFAULT_SESSION;
      }

      // 復元後にneedsContentRestoreフラグを設定
      const restoredSession = this.prepareSessionForRestore(session);

      console.log('[SessionStorage] Session loaded successfully');
      return restoredSession;
    } catch (error) {
      console.error('[SessionStorage] Failed to load session:', error);
      return DEFAULT_SESSION;
    }
  }

  /**
   * セッションをクリア
   */
  async clear(): Promise<void> {
    try {
      await storageService.delete(STORES.USER_PREFERENCES, SESSION_KEY);
      console.log('[SessionStorage] Session cleared');
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
