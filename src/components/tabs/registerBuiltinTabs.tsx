import { tabRegistry } from '../../engine/ide/tabs/TabRegistry';
import {
  AIReviewTabType,
  BinaryTabType,
  DiffTabType,
  EditorTabType,
  ExtensionInfoTabType,
  MergeConflictTabType,
  PreviewTabType,
  SettingsTabType,
  WebPreviewTabType,
  WelcomeTabType,
} from './builtins/index';

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
  tabRegistry.register(ExtensionInfoTabType);
  tabRegistry.register(MergeConflictTabType);

  console.log('[TabRegistry] Builtin tab types registered');
}
