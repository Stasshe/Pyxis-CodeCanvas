/**
 * Explorer Context Menu API for Extensions
 * 拡張機能がExplorerのコンテキストメニューに項目を追加するためのAPI
 */

import type { FileItem } from '@/types';

import type { ExtensionContext } from '../types';

/**
 * コンテキストメニュー項目の定義
 */
export interface ExplorerMenuItemDefinition {
  /** メニュー項目ID（拡張機能内で一意） */
  id: string;
  /** 表示ラベル */
  label: string;
  /** アイコン（Lucide Reactアイコン名、オプション） */
  icon?: string;
  /** 表示条件: ファイルのみ、フォルダのみ、両方 */
  when?: 'file' | 'folder' | 'both';
  /** ファイル拡張子でフィルタ（例: ['.bin', '.png']）。whenがfileの場合のみ有効 */
  fileExtensions?: string[];
  /** バイナリファイルの場合のみ表示するか */
  binaryOnly?: boolean;
  /** メニュー項目の順序（小さいほど上） */
  order?: number;
  /** クリック時に実行されるハンドラ */
  handler: (item: FileItem, context: MenuActionContext) => void | Promise<void>;
}

/**
 * メニュー項目のアクションコンテキスト
 */
export interface MenuActionContext {
  /** 現在のプロジェクト名 */
  projectName: string;
  /** 現在のプロジェクトID */
  projectId: string;
}

/**
 * 登録されたメニュー項目
 */
interface RegisteredMenuItem {
  extensionId: string;
  definition: ExplorerMenuItemDefinition;
}

/**
 * ExplorerMenuRegistry - グローバルなExplorerコンテキストメニュー項目管理
 */
class ExplorerMenuRegistry {
  private items = new Map<string, RegisteredMenuItem>();
  private changeListeners = new Set<() => void>();

  /**
   * メニュー項目を登録
   */
  register(extensionId: string, definition: ExplorerMenuItemDefinition): void {
    const fullId = `${extensionId}.${definition.id}`;

    if (this.items.has(fullId)) {
      console.warn(
        `[ExplorerMenuRegistry] Menu item ${fullId} is already registered. Overwriting.`
      );
    }

    this.items.set(fullId, {
      extensionId,
      definition,
    });

    console.log(`[ExplorerMenuRegistry] Registered menu item: ${fullId}`);
    this.notifyChange();
  }

  /**
   * メニュー項目を登録解除
   */
  unregister(extensionId: string, itemId: string): void {
    const fullId = `${extensionId}.${itemId}`;
    const deleted = this.items.delete(fullId);

    if (deleted) {
      console.log(`[ExplorerMenuRegistry] Unregistered menu item: ${fullId}`);
      this.notifyChange();
    }
  }

  /**
   * 拡張機能の全メニュー項目を登録解除
   */
  unregisterAll(extensionId: string): void {
    const toDelete: string[] = [];

    for (const [fullId, item] of this.items.entries()) {
      if (item.extensionId === extensionId) {
        toDelete.push(fullId);
      }
    }

    for (const fullId of toDelete) {
      this.items.delete(fullId);
    }

    if (toDelete.length > 0) {
      console.log(
        `[ExplorerMenuRegistry] Unregistered ${toDelete.length} menu items for extension: ${extensionId}`
      );
      this.notifyChange();
    }
  }

  /**
   * 特定のファイルアイテムに対して表示すべきメニュー項目を取得
   */
  getMenuItemsForFile(file: FileItem | null): RegisteredMenuItem[] {
    const result: RegisteredMenuItem[] = [];

    for (const item of this.items.values()) {
      const def = item.definition;

      // ファイルが null（空白部分のクリック）の場合はスキップ
      if (file === null) {
        continue;
      }

      // when 条件をチェック
      if (def.when === 'file' && file.type !== 'file') continue;
      if (def.when === 'folder' && file.type !== 'folder') continue;

      // binaryOnly 条件をチェック
      if (def.binaryOnly && !file.isBufferArray) continue;

      // fileExtensions 条件をチェック
      if (def.fileExtensions && def.fileExtensions.length > 0 && file.type === 'file') {
        const dotIndex = file.name.lastIndexOf('.');
        // ファイル名にドットがない場合、または先頭のドットのみの場合はスキップ
        if (dotIndex <= 0) continue;
        const ext = file.name.substring(dotIndex).toLowerCase();
        if (!def.fileExtensions.some(e => e.toLowerCase() === ext)) continue;
      }

      result.push(item);
    }

    // order でソート
    return result.sort((a, b) => {
      const orderA = a.definition.order ?? 100;
      const orderB = b.definition.order ?? 100;
      return orderA - orderB;
    });
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
        console.error('[ExplorerMenuRegistry] Error in change listener:', error);
      }
    });
  }
}

/**
 * グローバルレジストリインスタンス
 */
export const explorerMenuRegistry = new ExplorerMenuRegistry();

/**
 * ExplorerMenuAPI - 拡張機能がExplorerコンテキストメニューを管理するためのAPI
 */
export class ExplorerMenuAPI {
  private extensionId: string;
  private registeredItems = new Set<string>();

  constructor(context: ExtensionContext) {
    this.extensionId = context.extensionId;
  }

  /**
   * コンテキストメニュー項目を追加
   */
  addMenuItem(definition: ExplorerMenuItemDefinition): void {
    explorerMenuRegistry.register(this.extensionId, definition);
    this.registeredItems.add(definition.id);
  }

  /**
   * コンテキストメニュー項目を削除
   */
  removeMenuItem(itemId: string): void {
    if (!this.registeredItems.has(itemId)) {
      console.error(`[ExplorerMenuAPI] Menu item ${itemId} not registered by ${this.extensionId}`);
      return;
    }
    explorerMenuRegistry.unregister(this.extensionId, itemId);
    this.registeredItems.delete(itemId);
  }

  /**
   * クリーンアップ - 全メニュー項目を削除
   */
  dispose(): void {
    explorerMenuRegistry.unregisterAll(this.extensionId);
    this.registeredItems.clear();
    console.log(`[ExplorerMenuAPI] Disposed all menu items for extension: ${this.extensionId}`);
  }
}
