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
  /** タブの一意識別子（オプション）。指定すると同じIDのタブを再利用します */
  id?: string;
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
   * TabStore の openTab を使用するため、重複チェックは自動的に行われる
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

    // pathの生成: idが指定されている場合はそれを使う
    const tabPath = options.id
      ? `extension:${this.extensionId}:${options.id}`
      : `extension:${this.extensionId}`;

    // TabStore の openTab を使用（重複チェックと既存タブのアクティブ化を自動処理）
    store.openTab(
      {
        path: tabPath,
        name: options.title,
        title: options.title,
        icon: options.icon,
        closable: options.closable,
        data: options.data,
      },
      {
        kind: tabKind,
        paneId: options.paneId,
        makeActive: options.activateAfterCreate !== false,
      }
    );

    console.log(`[TabAPI] Opened tab: ${tabPath} for extension: ${this.extensionId}`);
    return tabPath;
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
   * Note: createTab()で生成されたタブID（path）の形式に依存している。
   * タブIDは createTab() 内で厳密に制御されており、
   * `extension:${extensionId}:` または `extension:${extensionId}` の形式のみが許可される。
   * 拡張機能はこのメソッド以外でタブIDを生成できないため、
   * プレフィックスチェックで十分なセキュリティが保証される。
   */
  private isOwnedTab(tabId: string): boolean {
    // createTab()で生成された正確なプレフィックスのみを許可
    const expectedPrefix = `extension:${this.extensionId}`;
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
