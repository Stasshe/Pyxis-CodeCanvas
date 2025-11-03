/**
 * Sidebar API for Extensions
 * 拡張機能がサイドバーパネルを追加するためのAPI
 */

import type { ComponentType } from 'react';

import type { ExtensionContext } from '../types';

/**
 * サイドバーパネルの定義
 */
export interface SidebarPanelDefinition {
  /** パネルID（拡張機能内で一意） */
  id: string;
  /** パネルのタイトル */
  title: string;
  /** パネルのアイコン（Lucide Reactアイコン名） */
  icon: string;
  /** パネルを描画するReactコンポーネント */
  component: ComponentType<SidebarPanelProps>;
  /** パネルの順序（オプション） */
  order?: number;
}

/**
 * サイドバーパネルコンポーネントのProps
 */
export interface SidebarPanelProps {
  /** 拡張機能ID */
  extensionId: string;
  /** パネルID */
  panelId: string;
  /** パネルがアクティブかどうか */
  isActive: boolean;
  /** パネルの状態（拡張機能が自由に使える） */
  state?: any;
}

/**
 * パネルアクティベーションコールバック
 */
export type PanelActivateCallback = (panelId: string) => void | Promise<void>;

/**
 * 登録されたパネル
 */
interface RegisteredPanel {
  extensionId: string;
  definition: SidebarPanelDefinition;
  state: any;
}

/**
 * SidebarRegistry - グローバルなサイドバーパネル管理
 */
class SidebarRegistry {
  private panels = new Map<string, RegisteredPanel>();
  private activateCallbacks = new Map<string, Set<PanelActivateCallback>>();
  private changeListeners = new Set<() => void>();

  /**
   * パネルを登録
   */
  register(extensionId: string, definition: SidebarPanelDefinition): void {
    const fullId = `${extensionId}.${definition.id}`;

    if (this.panels.has(fullId)) {
      console.warn(`[SidebarRegistry] Panel ${fullId} is already registered. Overwriting.`);
    }

    this.panels.set(fullId, {
      extensionId,
      definition,
      state: {},
    });

    console.log(`[SidebarRegistry] Registered panel: ${fullId}`);
    this.notifyChange();
  }

  /**
   * パネルを登録解除
   */
  unregister(extensionId: string, panelId: string): void {
    const fullId = `${extensionId}.${panelId}`;
    const deleted = this.panels.delete(fullId);

    if (deleted) {
      this.activateCallbacks.delete(fullId);
      console.log(`[SidebarRegistry] Unregistered panel: ${fullId}`);
      this.notifyChange();
    }
  }

  /**
   * 拡張機能の全パネルを登録解除
   */
  unregisterAll(extensionId: string): void {
    const toDelete: string[] = [];

    for (const [fullId, panel] of this.panels.entries()) {
      if (panel.extensionId === extensionId) {
        toDelete.push(fullId);
      }
    }

    for (const fullId of toDelete) {
      this.panels.delete(fullId);
      this.activateCallbacks.delete(fullId);
    }

    if (toDelete.length > 0) {
      console.log(
        `[SidebarRegistry] Unregistered ${toDelete.length} panels for extension: ${extensionId}`
      );
      this.notifyChange();
    }
  }

  /**
   * 全パネルを取得
   */
  getAllPanels(): RegisteredPanel[] {
    return Array.from(this.panels.values()).sort((a, b) => {
      const orderA = a.definition.order ?? 100;
      const orderB = b.definition.order ?? 100;
      return orderA - orderB;
    });
  }

  /**
   * 特定パネルを取得
   */
  getPanel(extensionId: string, panelId: string): RegisteredPanel | undefined {
    const fullId = `${extensionId}.${panelId}`;
    return this.panels.get(fullId);
  }

  /**
   * パネル状態を更新
   */
  updatePanelState(extensionId: string, panelId: string, state: any): void {
    const fullId = `${extensionId}.${panelId}`;
    const panel = this.panels.get(fullId);

    if (panel) {
      panel.state = { ...panel.state, ...state };
      console.log(`[SidebarRegistry] Updated state for panel: ${fullId}`);
      this.notifyChange();
    }
  }

  /**
   * パネルアクティベーションコールバックを登録
   */
  onPanelActivate(extensionId: string, panelId: string, callback: PanelActivateCallback): void {
    const fullId = `${extensionId}.${panelId}`;

    if (!this.activateCallbacks.has(fullId)) {
      this.activateCallbacks.set(fullId, new Set());
    }

    this.activateCallbacks.get(fullId)!.add(callback);
  }

  /**
   * パネルがアクティブ化された時に呼ぶ
   */
  notifyPanelActivate(extensionId: string, panelId: string): void {
    const fullId = `${extensionId}.${panelId}`;
    const callbacks = this.activateCallbacks.get(fullId);

    if (callbacks) {
      callbacks.forEach(callback => {
        Promise.resolve(callback(panelId)).catch(err => {
          console.error(`[SidebarRegistry] Error in activate callback for panel ${fullId}:`, err);
        });
      });
    }
  }

  /**
   * 変更リスナーを登録
   */
  addChangeListener(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /**
   * 変更を通知
   */
  private notifyChange(): void {
    this.changeListeners.forEach(listener => {
      try {
        listener();
      } catch (error) {
        console.error('[SidebarRegistry] Error in change listener:', error);
      }
    });
  }
}

/**
 * グローバルレジストリインスタンス
 */
export const sidebarRegistry = new SidebarRegistry();

/**
 * SidebarAPI - 拡張機能がサイドバーパネルを管理するためのAPI
 */
export class SidebarAPI {
  private extensionId: string;
  private registeredPanels = new Set<string>();

  constructor(context: ExtensionContext) {
    this.extensionId = context.extensionId;
  }

  /**
   * サイドバーパネルを作成
   */
  createPanel(definition: SidebarPanelDefinition): void {
    sidebarRegistry.register(this.extensionId, definition);
    this.registeredPanels.add(definition.id);
  }

  /**
   * パネル状態を更新
   */
  updatePanel(panelId: string, state: any): void {
    if (!this.registeredPanels.has(panelId)) {
      console.error(`[SidebarAPI] Panel ${panelId} not registered by ${this.extensionId}`);
      return;
    }
    sidebarRegistry.updatePanelState(this.extensionId, panelId, state);
  }

  /**
   * パネルがアクティブ化された時のコールバック
   */
  onPanelActivate(panelId: string, callback: PanelActivateCallback): void {
    if (!this.registeredPanels.has(panelId)) {
      console.error(`[SidebarAPI] Panel ${panelId} not registered by ${this.extensionId}`);
      return;
    }
    sidebarRegistry.onPanelActivate(this.extensionId, panelId, callback);
  }

  /**
   * パネルを削除
   */
  removePanel(panelId: string): void {
    if (!this.registeredPanels.has(panelId)) {
      console.error(`[SidebarAPI] Panel ${panelId} not registered by ${this.extensionId}`);
      return;
    }
    sidebarRegistry.unregister(this.extensionId, panelId);
    this.registeredPanels.delete(panelId);
  }

  /**
   * クリーンアップ - 全パネルを削除
   */
  dispose(): void {
    sidebarRegistry.unregisterAll(this.extensionId);
    this.registeredPanels.clear();
    console.log(`[SidebarAPI] Disposed all panels for extension: ${this.extensionId}`);
  }
}
