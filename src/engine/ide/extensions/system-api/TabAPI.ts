/**
 * Tab API for Extensions
 * 拡張機能が自分のタブを作成・管理するためのAPI
 */

import type { ComponentType } from 'react';
import { tabRegistry } from '@/engine/ide/tabs/TabRegistry';
import type {
  ExtensionTab,
  OpenTabOptions,
  TabComponentProps,
  TabFileInfo,
} from '@/engine/ide/tabs/types';
import { tabActions } from '@/stores/tabState';
import type { FileItem } from '@/types/index';
import type { ExtensionContext } from '../types';

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
  /** Whether the tab has unsaved changes. */
  isDirty?: boolean;
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
  private pendingCloseCallbacks = new Set<Promise<void>>();
  private registeredTabKind = false;

  constructor(context: Pick<ExtensionContext, 'extensionId'>) {
    this.extensionId = context.extensionId;
  }

  /**
   * TabRegistryにタブコンポーネントを登録
   * 拡張機能はactivate時にこれを呼ぶべき
   */
  // TODO: Model extension-specific tab props without breaking existing public extension components.
  registerTabType(component: ComponentType<TabComponentProps>): void {
    const tabKind: ExtensionTab['kind'] = `extension:${this.extensionId}`;

    if (tabRegistry.has(tabKind)) {
      console.warn(`[TabAPI] Tab type already registered: ${tabKind}`);
      return;
    }

    tabRegistry.register({
      kind: tabKind,
      displayName: `Extension: ${this.extensionId}`,
      icon: 'Package',
      canEdit: false,
      canPreview: false,
      component: component,
      // Extension tabs preserve all data in the tab object, so they don't need session restoration
      needsSessionRestore: false,
      createTab: (data: TabFileInfo, opts?: OpenTabOptions): ExtensionTab => {
        const resourcePath = data.path || data.id || data.name || '';
        const tabId = `${tabKind}:${resourcePath}`;
        return {
          ...data,
          id: tabId,
          name: data.title || data.name || 'Extension Tab',
          kind: tabKind,
          path: resourcePath,
          paneId: opts?.paneId || '',
          closable: data.closable !== false,
          icon: data.icon,
          data: data.data,
        };
      },
      onClose: tab => this.handleTabClosed(tab.id),
    });
    this.registeredTabKind = true;

    console.log(`[TabAPI] Registered extension tab type: ${tabKind}`);
  }

  /**
   * 新しいタブを作成
   * TabStore の openTab を使用するため、重複チェックは自動的に行われる
   */
  createTab(options: CreateTabOptions): string {
    const tabKind = `extension:${this.extensionId}`;

    if (!tabRegistry.has(tabKind)) {
      console.error(
        `[TabAPI] Tab type not registered: ${tabKind}. Call context.tabs.registerTabType(YourComponent) in activate() first.`
      );
      throw new Error(`Extension tab type not registered: ${tabKind}`);
    }

    const resourcePath = options.id || '';

    tabActions.openTab(
      {
        path: resourcePath,
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

    const found = tabActions.findTabByPath(resourcePath, tabKind);
    const createdTabId = found?.tab?.id || `${tabKind}:${resourcePath || options.title}`;
    console.log(`[TabAPI] Opened tab: ${createdTabId} for extension: ${this.extensionId}`);
    return createdTabId;
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

    const tab = tabActions
      .getAllTabs()
      .find(
        (candidate): candidate is ExtensionTab =>
          candidate.id === tabId && candidate.kind === `extension:${this.extensionId}`
      );
    if (!tab) return false;
    const updates: Partial<Omit<ExtensionTab, 'kind'>> = {};
    if (options.title) updates.name = options.title;
    if (options.icon) updates.icon = options.icon;
    if (options.isDirty !== undefined) updates.isDirty = options.isDirty;
    if (options.data) updates.data = { ...tab.data, ...options.data };
    tabActions.updateTab(tab.paneId, tabId, updates);
    console.log(`[TabAPI] Updated tab: ${tabId}`);
    return true;
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

    const t = tabActions.getAllTabs().find(x => x.id === tabId);
    if (t) {
      const closed = tabActions.closeTab(t.paneId, tabId);
      if (closed) console.log(`[TabAPI] Closed tab: ${tabId}`);
      return closed;
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

    const extensionKind: ExtensionTab['kind'] = `extension:${this.extensionId}`;
    const tab = tabActions
      .getAllTabs()
      .find(
        (candidate): candidate is ExtensionTab =>
          candidate.id === tabId && candidate.kind === extensionKind
      );
    return (tab?.data as T) ?? null;
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
    return tabId.startsWith(`${expectedPrefix}:`);
  }

  private handleTabClosed(tabId: string): void | Promise<void> {
    const callback = this.closeCallbacks.get(tabId);
    if (!callback) return;
    this.closeCallbacks.delete(tabId);
    const pending = Promise.resolve(callback(tabId)).finally(() => {
      this.pendingCloseCallbacks.delete(pending);
    });
    this.pendingCloseCallbacks.add(pending);
    return pending;
  }

  /**
   * システムのopenTabを使ってファイルを開く
   * 拡張機能が通常のエディタタブを開くために使用
   */
  openSystemTab(
    file: FileItem,
    options?: {
      kind?: string;
      jumpToLine?: number;
      jumpToColumn?: number;
      activateAfterOpen?: boolean;
    }
  ): void {
    try {
      tabActions.openTab(file, {
        kind: options?.kind || 'editor',
        jumpToLine: options?.jumpToLine,
        jumpToColumn: options?.jumpToColumn,
        makeActive: options?.activateAfterOpen ?? true,
      });
      console.log(`[TabAPI] Opened system tab for file: ${file.path}`);
    } catch (error) {
      console.error('[TabAPI] Failed to open system tab:', error);
      throw error;
    }
  }

  /**
   * クリーンアップ - 全てのタブを閉じる
   */
  async dispose(): Promise<void> {
    const owned = tabActions
      .getAllTabs()
      .filter(t => this.isOwnedTab(t.id))
      .map(t => ({ paneId: t.paneId, tabId: t.id }));

    for (const { paneId, tabId } of owned) {
      tabActions.closeTab(paneId, tabId, { discard: true });
    }
    await Promise.allSettled(this.pendingCloseCallbacks);
    this.closeCallbacks.clear();
    if (this.registeredTabKind) {
      tabRegistry.unregister(`extension:${this.extensionId}`);
      this.registeredTabKind = false;
    }
    console.log(`[TabAPI] Disposed all tabs for extension: ${this.extensionId}`);
  }
}
