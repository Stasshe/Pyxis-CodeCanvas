// src/engine/tabs/registerBuiltinTabs.ts
import { tabRegistry } from './TabRegistry';
import {
  EditorTabType,
  DiffTabType,
  AIReviewTabType,
  WebPreviewTabType,
  SettingsTabType,
  WelcomeTabType,
  PreviewTabType,
  BinaryTabType,
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
  tabRegistry.register(WelcomeTabType);
  tabRegistry.register(PreviewTabType);
  tabRegistry.register(BinaryTabType);
  
  console.log('[TabRegistry] Builtin tab types registered');
}
