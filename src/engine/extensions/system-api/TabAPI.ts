/**
 * Tab API for Extensions
 * 拡張機能が自分のタブを作成・管理するためのAPI
 */

import type { ExtensionContext } from '../types';

import { tabRegistry } from '@/engine/tabs/TabRegistry';
import { useTabStore } from '@/stores/tabStore';

/**
 * 拡張機能用タブデータ
 */
export interface ExtensionTabData {
  /** 拡張機能が定義する任意のデータ */
  [key: string]: unknown;
}

/**
 * タブ作成オプション
 */
export interface CreateTabOptions {
  /** タブのタイトル */
  title: string;
  /** タブのアイコン（オプション） */
  icon?: string;
  /** タブが閉じられない（オプション） */
  closable?: boolean;
  /** 作成後にアクティブ化するか */
  activateAfterCreate?: boolean;
  /** 開くペインID（オプション） */
  paneId?: string;
  /** 拡張機能固有のデータ */
  data?: ExtensionTabData;
}

/**
 * タブ更新オプション
 */
export interface UpdateTabOptions {
  /** 新しいタイトル */
  title?: string;
  /** 新しいアイコン */
  icon?: string;
  /** 拡張機能固有のデータ */
  data?: Partial<ExtensionTabData>;
}

/**
 * タブクローズコールバック
 */
export type TabCloseCallback = (tabId: string) => void | Promise<void>;

/**
 * TabAPI - 拡張機能がタブを管理するためのAPI
 */
export class TabAPI {
  private extensionId: string;
  private closeCallbacks = new Map<string, TabCloseCallback>();

  constructor(context: ExtensionContext) {
    this.extensionId = context.extensionId;
  }

  /**
   * TabRegistryにタブコンポーネントを登録
   * 拡張機能はactivate時にこれを呼ぶべき
   */
  registerTabType(component: any): void {
    const tabKind = `extension:${this.extensionId}`;

    if (tabRegistry.has(tabKind as any)) {
      console.warn(`[TabAPI] Tab type already registered: ${tabKind}`);
      return;
    }

    tabRegistry.register({
      kind: tabKind as any,
      displayName: `Extension: ${this.extensionId}`,
      icon: 'Package',
      canEdit: false,
      canPreview: false,
      component: component,
      createTab: (data: any, opts?: any) =>
        ({
          id: data.id || `ext-${Date.now()}`,
          name: data.title || data.name || 'Extension Tab',
          kind: tabKind as any,
          path: data.path || `extension:${this.extensionId}`,
          paneId: opts?.paneId || '',
          closable: data.closable !== false,
          ...data,
        }) as any,
    });

    console.log(`[TabAPI] Registered extension tab type: ${tabKind}`);
  }

  /**
   * 新しいタブを作成
   */
  createTab(options: CreateTabOptions): string {
    const store = useTabStore.getState();
    const tabKind = `extension:${this.extensionId}`;

    // TabRegistryに登録されているか確認
    if (!tabRegistry.has(tabKind as any)) {
      console.error(
        `[TabAPI] Tab type not registered: ${tabKind}. ` +
          `Call context.tabs.registerTabType(YourComponent) in activate() first.`
      );
      throw new Error(`Extension tab type not registered: ${tabKind}`);
    }

    // 重複チェック: noteKeyが指定されている場合、同じnoteKeyを持つタブを探す
    if (options.data && (options.data as any).noteKey) {
      const noteKey = (options.data as any).noteKey;
      for (const pane of store.panes) {
        const existingTab = pane.tabs.find(tab => {
          return tab.kind === tabKind && (tab as any).data?.noteKey === noteKey;
        });

        if (existingTab) {
          console.log(
            `[TabAPI] Tab already exists for noteKey: ${noteKey}, activating existing tab`
          );
          store.activateTab(pane.id, existingTab.id);
          return existingTab.id;
        }
      }
    }

    const tabId = `ext-${this.extensionId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // 新しいタブオブジェクトを作成（BaseTabの形式に準拠）
    const newTab: any = {
      id: tabId,
      name: options.title,
      kind: tabKind,
      path: `extension:${this.extensionId}/${tabId}`,
      paneId: '', // setPanesで設定される
      icon: options.icon,
      closable: options.closable ?? true,
      data: options.data,
    };

    // ペインIDの決定
    const targetPaneId = options.paneId || store.panes[0]?.id;
    if (!targetPaneId) {
      throw new Error('No pane available to open tab');
    }

    // タブを追加
    store.setPanes(
      store.panes.map(pane => {
        if (pane.id === targetPaneId) {
          return {
            ...pane,
            tabs: [...pane.tabs, newTab as any],
          };
        }
        return pane;
      })
    );

    // アクティブ化
    if (options.activateAfterCreate !== false) {
      store.activateTab(targetPaneId, tabId);
    }

    console.log(`[TabAPI] Created tab: ${tabId} for extension: ${this.extensionId}`);
    return tabId;
  }

  /**
   * タブを更新
   */
  updateTab(tabId: string, options: UpdateTabOptions): boolean {
    // タブIDの検証
    if (!this.isOwnedTab(tabId)) {
      console.error(`[TabAPI] Cannot update tab ${tabId}: not owned by ${this.extensionId}`);
      return false;
    }

    const store = useTabStore.getState();
    let updated = false;

    store.setPanes(
      store.panes.map(pane => ({
        ...pane,
        tabs: pane.tabs.map(tab => {
          if (tab.id === tabId) {
            updated = true;
            return {
              ...tab,
              // title オプションは name フィールドを更新
              ...(options.title && { name: options.title }),
              ...(options.icon && { icon: options.icon }),
              ...(options.data && {
                data: { ...(tab as any).data, ...options.data },
              }),
            };
          }
          return tab;
        }),
      }))
    );

    if (updated) {
      console.log(`[TabAPI] Updated tab: ${tabId}`);
    }
    return updated;
  }

  /**
   * タブを閉じる
   */
  closeTab(tabId: string): boolean {
    // タブIDの検証
    if (!this.isOwnedTab(tabId)) {
      console.error(`[TabAPI] Cannot close tab ${tabId}: not owned by ${this.extensionId}`);
      return false;
    }

    const store = useTabStore.getState();

    // クローズコールバックを実行
    const callback = this.closeCallbacks.get(tabId);
    if (callback) {
      Promise.resolve(callback(tabId)).catch(err => {
        console.error(`[TabAPI] Error in close callback for tab ${tabId}:`, err);
      });
      this.closeCallbacks.delete(tabId);
    }

    // タブを探して削除
    for (const pane of store.panes) {
      const tab = pane.tabs.find(t => t.id === tabId);
      if (tab) {
        store.closeTab(pane.id, tabId);
        console.log(`[TabAPI] Closed tab: ${tabId}`);
        return true;
      }
    }

    return false;
  }

  /**
   * タブが閉じられた時のコールバックを登録
   */
  onTabClose(tabId: string, callback: TabCloseCallback): void {
    if (!this.isOwnedTab(tabId)) {
      console.error(
        `[TabAPI] Cannot register close callback for tab ${tabId}: not owned by ${this.extensionId}`
      );
      return;
    }
    this.closeCallbacks.set(tabId, callback);
  }

  /**
   * 特定のタブデータを取得
   */
  getTabData<T = ExtensionTabData>(tabId: string): T | null {
    if (!this.isOwnedTab(tabId)) {
      console.error(`[TabAPI] Cannot get tab data for ${tabId}: not owned by ${this.extensionId}`);
      return null;
    }

    const store = useTabStore.getState();
    for (const pane of store.panes) {
      const tab = pane.tabs.find(t => t.id === tabId) as any;
      if (tab && tab.data) {
        return tab.data as T;
      }
    }
    return null;
  }

  /**
   * このタブが拡張機能によって所有されているかチェック
   *
   * Note: createTab()で生成されたタブIDの形式に依存している。
   * タブIDは createTab() 内で厳密に制御されており、
   * `ext-${extensionId}-${timestamp}-${random}` の形式のみが許可される。
   * 拡張機能はこのメソッド以外でタブIDを生成できないため、
   * プレフィックスチェックで十分なセキュリティが保証される。
   */
  private isOwnedTab(tabId: string): boolean {
    // createTab()で生成された正確なプレフィックスのみを許可
    const expectedPrefix = `ext-${this.extensionId}-`;
    return tabId.startsWith(expectedPrefix);
  }

  /**
   * システムのopenTabを使ってファイルを開く
   * 拡張機能が通常のエディタタブを開くために使用
   */
  openSystemTab(
    file: any,
    options?: {
      kind?: string;
      jumpToLine?: number;
      jumpToColumn?: number;
      activateAfterOpen?: boolean;
    }
  ): void {
    const store = useTabStore.getState();

    try {
      // システムのopenTabを呼び出す
      store.openTab(file, {
        kind: options?.kind || 'editor',
        jumpToLine: options?.jumpToLine,
        jumpToColumn: options?.jumpToColumn,
        activateAfterOpen: options?.activateAfterOpen ?? true,
      });

      console.log(`[TabAPI] Opened system tab for file: ${file.path}`);
    } catch (error) {
      console.error(`[TabAPI] Failed to open system tab:`, error);
      throw error;
    }
  }

  /**
   * クリーンアップ - 全てのタブを閉じる
   */
  dispose(): void {
    const store = useTabStore.getState();
    const ownedTabs: Array<{ paneId: string; tabId: string }> = [];

    // 自分が所有するタブを全て探す
    for (const pane of store.panes) {
      for (const tab of pane.tabs) {
        if (this.isOwnedTab(tab.id)) {
          ownedTabs.push({ paneId: pane.id, tabId: tab.id });
        }
      }
    }

    // 全て閉じる
    for (const { paneId, tabId } of ownedTabs) {
      const callback = this.closeCallbacks.get(tabId);
      if (callback) {
        Promise.resolve(callback(tabId)).catch(err => {
          console.error(`[TabAPI] Error in dispose callback for tab ${tabId}:`, err);
        });
      }
      store.closeTab(paneId, tabId);
    }

    this.closeCallbacks.clear();
    console.log(`[TabAPI] Disposed all tabs for extension: ${this.extensionId}`);
  }
}
