// src/engine/tabs/TabRegistry.ts
import type { TabKind, TabTypeDefinition } from './types';

type RegistryChangeListener = (kind: TabKind, definition: TabTypeDefinition) => void;

/**
 * タブタイプレジストリ
 * 各種タブタイプを登録・管理する
 */
class TabRegistry {
  private registry: Map<TabKind, TabTypeDefinition> = new Map();
  private listeners: Set<RegistryChangeListener> = new Set();

  /**
   * タブタイプを登録
   */
  register(definition: TabTypeDefinition, options?: { overwrite?: boolean }): void {
    const exists = this.registry.has(definition.kind);
    if (exists && !options?.overwrite) {
      // 既に登録済みの場合は上書きしない（明示的に overwrite=true が渡された場合のみ上書き）
      console.info(
        `[TabRegistry] Tab type "${definition.kind}" is already registered; skipping registration.`
      );
      return;
    }

    if (exists && options?.overwrite) {
      console.warn(
        `[TabRegistry] Tab type "${definition.kind}" is already registered. Overwriting.`
      );
    }

    this.registry.set(definition.kind, definition);
    console.log(`[TabRegistry] Registered tab type: ${definition.kind}`);

    // リスナーに通知
    this.notifyListeners(definition.kind, definition);
  }

  /**
   * タブタイプを取得
   */
  get(kind: TabKind): TabTypeDefinition | undefined {
    return this.registry.get(kind);
  }

  /**
   * 登録されているすべてのタブタイプを取得
   */
  getAll(): TabTypeDefinition[] {
    return Array.from(this.registry.values());
  }

  /**
   * タブタイプが登録されているかチェック
   */
  has(kind: TabKind): boolean {
    return this.registry.has(kind);
  }

  /**
   * タブタイプの登録を解除
   */
  unregister(kind: TabKind): void {
    this.registry.delete(kind);
    console.log(`[TabRegistry] Unregistered tab type: ${kind}`);
  }

  /**
   * 登録変更リスナーを追加
   */
  addChangeListener(listener: RegistryChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * リスナーに通知
   */
  private notifyListeners(kind: TabKind, definition: TabTypeDefinition): void {
    for (const listener of this.listeners) {
      try {
        listener(kind, definition);
      } catch (e) {
        console.error('[TabRegistry] Listener error:', e);
      }
    }
  }
}

// シングルトンインスタンス
export const tabRegistry = new TabRegistry();
