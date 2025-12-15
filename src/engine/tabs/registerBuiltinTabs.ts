// src/engine/tabs/registerBuiltinTabs.ts
import {
  EditorTabType,
  DiffTabType,
  AIReviewTabType,
  WebPreviewTabType,
  SettingsTabType,
  WelcomeTabType,
  PreviewTabType,
  BinaryTabType,
  ExtensionInfoTabType,
} from './builtins'
import { tabRegistry } from './TabRegistry'

/**
 * ビルトインタブタイプを登録
 */
export function registerBuiltinTabs() {
  tabRegistry.register(EditorTabType)
  tabRegistry.register(DiffTabType)
  tabRegistry.register(AIReviewTabType)
  tabRegistry.register(WebPreviewTabType)
  tabRegistry.register(SettingsTabType)
  tabRegistry.register(WelcomeTabType)
  tabRegistry.register(PreviewTabType)
  tabRegistry.register(BinaryTabType)
  tabRegistry.register(ExtensionInfoTabType)

  console.log('[TabRegistry] Builtin tab types registered')
}
