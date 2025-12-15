// src/engine/tabs/TabRegistry.ts
import type { TabKind, TabTypeDefinition } from './types'

/**
 * タブタイプレジストリ
 * 各種タブタイプを登録・管理する
 */
class TabRegistry {
  private registry: Map<TabKind, TabTypeDefinition> = new Map()

  /**
   * タブタイプを登録
   */
  register(definition: TabTypeDefinition, options?: { overwrite?: boolean }): void {
    const exists = this.registry.has(definition.kind)
    if (exists && !options?.overwrite) {
      // 既に登録済みの場合は上書きしない（明示的に overwrite=true が渡された場合のみ上書き）
      console.info(
        `[TabRegistry] Tab type "${definition.kind}" is already registered; skipping registration.`
      )
      return
    }

    if (exists && options?.overwrite) {
      console.warn(
        `[TabRegistry] Tab type "${definition.kind}" is already registered. Overwriting.`
      )
    }

    this.registry.set(definition.kind, definition)
    console.log(`[TabRegistry] Registered tab type: ${definition.kind}`)
  }

  /**
   * タブタイプを取得
   */
  get(kind: TabKind): TabTypeDefinition | undefined {
    return this.registry.get(kind)
  }

  /**
   * 登録されているすべてのタブタイプを取得
   */
  getAll(): TabTypeDefinition[] {
    return Array.from(this.registry.values())
  }

  /**
   * タブタイプが登録されているかチェック
   */
  has(kind: TabKind): boolean {
    return this.registry.has(kind)
  }

  /**
   * タブタイプの登録を解除
   */
  unregister(kind: TabKind): void {
    this.registry.delete(kind)
    console.log(`[TabRegistry] Unregistered tab type: ${kind}`)
  }
}

// シングルトンインスタンス
export const tabRegistry = new TabRegistry()
