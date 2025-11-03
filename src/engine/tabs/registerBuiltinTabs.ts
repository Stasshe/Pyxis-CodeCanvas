// src/engine/tabs/registerBuiltinTabs.ts
import { tabRegistry } from './TabRegistry';
import {
  EditorTabType,
  DiffTabType,
  AIReviewTabType,
  WebPreviewTabType,
  SettingsTabType,
} from './builtins';

/**
 * ビルトインタブタイプを登録
 */
export function registerBuiltinTabs() {
  tabRegistry.register(EditorTabType);
  tabRegistry.register(DiffTabType);
  tabRegistry.register(AIReviewTabType);
  tabRegistry.register(WebPreviewTabType);
  tabRegistry.register(SettingsTabType);
  
  console.log('[TabRegistry] Builtin tab types registered');
}
