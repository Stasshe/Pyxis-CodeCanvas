import type { Monaco } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useCallback } from 'react';

import { getLanguage } from '../editors/editor-utils';
import { getEnhancedLanguage, getModelLanguage } from '../editors/monarch-jsx-language';
import {
  getMonacoLanguageFileName,
  getMonacoModelUriValue,
} from '../utils/monacoPathUtils';

import { MONACO_CONFIG } from '@/constants/config';

/**
 * Monaco Model Management Architecture
 *
 * This module uses a HYBRID approach with two model lookup paths:
 *
 * 1. TabId-based cache (sharedModelMap)
 *    - Purpose: Fast lookup, LRU management, external update capability
 *    - Indexed by: tabId (e.g., "/path/to/file.ts")
 *    - Benefits: Enables updateCachedModelContent() for background tabs
 *
 * 2. URI-based lookup (Monaco's native registry)
 *    - Purpose: Prevent duplicate models, leverage Monaco's lifecycle
 *    - Indexed by: URI (e.g., "inmemory://<encoded-tab-id>/path/to/file.ts")
 *    - Contract: uri.toString() must end with the real file extension because
 *      Monaco's TypeScript worker derives ScriptKind from the full URI string.
 *    - Benefits: Safety net, Monaco-managed disposal
 *
 * Why both?
 * - TabId cache: Required for LRU eviction and external updates (tabStore integration)
 * - URI lookup: Required to avoid creating duplicate models in Monaco's registry
 *
 * This is NOT redundant - each serves a distinct purpose. Both paths properly
 * update content on model reuse (fixes external change bug).
 */

// Monarch言語用のヘルパー
function getMonarchLanguage(fileName: string): string {
  // Use the model language for TSX/JSX so the TypeScript diagnostics run.
  // For other files, fall back to the default language detection.
  const ext = fileName.toLowerCase();
  // For TSX/JSX, return the enhanced monarch language ID. This makes the
  // model use `enhanced-tsx`/`enhanced-jsx` tokens but the TypeScript
  // diagnostics will not run for these models (tradeoff). To keep
  // diagnostics active you'd need a different approach (e.g. worker
  // mapping) but that introduces mis-highlighting when attaching tokens to
  // the built-in 'typescript' language globally.
  if (ext.endsWith('.tsx')) return getEnhancedLanguage(fileName); // 'enhanced-tsx'
  if (ext.endsWith('.jsx')) return getEnhancedLanguage(fileName); // 'enhanced-jsx'
  if (ext.endsWith('.ts')) return 'typescript';
  if (ext.endsWith('.js')) return 'javascript';

  // Fallback to existing helper
  return getLanguage(fileName);
}

// モジュール共有のモデルMap（シングルトン）
const sharedModelMap: Map<string, monaco.editor.ITextModel> = new Map();

// LRU順序を追跡するリスト（最近使われたものが後ろ）
const modelAccessOrder: string[] = [];

// モジュール共有の currentModelIdRef 互換オブジェクト
const sharedCurrentModelIdRef: { current: string | null } = { current: null };

/**
 * モジュールレベルの関数: 既存のモデルのコンテンツを更新
 * TabStoreから呼び出されて、非アクティブなタブのモデルも更新する
 * @param tabId タブID
 * @param content 新しいコンテンツ
 * @param context 呼び出し元のコンテキスト（ログ用）
 */
export function updateCachedModelContent(
  tabId: string,
  content: string,
  context = 'inactive'
): void {
  const model = sharedModelMap.get(tabId);
  if (!model || model.isDisposed()) return;
  try {
    if (model.getValue() !== content) model.setValue(content);
  } catch (e) {
    console.warn('[useMonacoModels] updateCachedModelContent failed:', e);
  }
}

// LRU順序を更新するヘルパー
function updateModelAccessOrder(tabId: string): void {
  const index = modelAccessOrder.indexOf(tabId);
  if (index > -1) {
    modelAccessOrder.splice(index, 1);
  }
  modelAccessOrder.push(tabId);
}

// 最も古いモデルを削除してキャパシティを確保
function enforceModelLimit(
  monacoModelMap: Map<string, monaco.editor.ITextModel>,
  maxModels: number
): void {
  while (monacoModelMap.size >= maxModels && modelAccessOrder.length > 0) {
    const oldestTabId = modelAccessOrder.shift();
    if (!oldestTabId) continue;
    const oldModel = monacoModelMap.get(oldestTabId);
    if (!oldModel) continue;
    try {
      oldModel.dispose();
    } catch (e) {
      console.warn('[useMonacoModels] Failed to dispose model:', e);
    }
    monacoModelMap.delete(oldestTabId);
  }
}

export function useMonacoModels() {
  const monacoModelMapRef = { current: sharedModelMap } as {
    current: Map<string, monaco.editor.ITextModel>;
  };
  const currentModelIdRef = sharedCurrentModelIdRef;

  const isModelSafe = useCallback((model: monaco.editor.ITextModel | null | undefined) => {
    return model && !model.isDisposed();
  }, []);

  const getOrCreateModel = useCallback(
    (
      mon: Monaco,
      tabId: string,
      content: string,
      fileName: string,
      filePath?: string | null
    ): monaco.editor.ITextModel | null => {
      // entry log removed in cleanup
      const monacoModelMap = monacoModelMapRef.current;
      const languageFileName = getMonacoLanguageFileName(tabId, fileName, filePath);
      const desiredLang = getModelLanguage(languageFileName);
      const desiredUriValue = getMonacoModelUriValue(tabId, fileName, filePath);
      let model = monacoModelMap.get(tabId);

      // ARCHITECTURE NOTE: This function uses a hybrid approach with two lookup paths:
      // 1. TabId-based lookup (our cache) - Fast path, enables LRU management and external updates
      // 2. URI-based lookup (Monaco's registry) - Safety path, prevents duplicate model creation
      // Both paths are intentional and serve different purposes. Do not refactor to single path
      // without careful consideration of LRU functionality and external update requirements.

      // If a model exists in our map, ensure it's safe and has the correct language.
      // IMPORTANT: do not dispose a model here synchronously — other editor instances
      // may be attaching to the same underlying model. URI changes create a new
      // model; language-only changes update the existing model in place.
      if (isModelSafe(model)) {
        // Update LRU access order
        updateModelAccessOrder(tabId);
        try {
          const currentLang = model?.getLanguageId();
          const currentUriValue = model?.uri?.toString();
          if (currentUriValue === desiredUriValue && currentLang !== desiredLang) {
            try {
              if (model) {
                mon.editor.setModelLanguage(model, desiredLang);
                mon.editor.setModelMarkers(model, 'typescript', []);
                mon.editor.setModelMarkers(model, 'javascript', []);
              }
            } catch (e) {
              console.warn('[useMonacoModels] Failed to update cached model language:', e);
            }
          }

          if (currentUriValue !== desiredUriValue) {
            // Remove from our map so caller will create a new model. Do NOT dispose
            // the existing model here to avoid racing with setModel()/editor lifecycle.
            monacoModelMap.delete(tabId);
            if (model) {
              try {
                mon.editor.setModelMarkers(model, 'typescript', []);
                mon.editor.setModelMarkers(model, 'javascript', []);
              } catch (e) {
                // ignore marker cleanup failures
              }
              window.setTimeout(() => {
                try {
                  if (model && !model.isDisposed()) model.dispose();
                } catch (e) {
                  console.warn('[useMonacoModels] Failed to dispose stale URI model:', e);
                }
              }, 0);
            }
            model = undefined;
          } else {
            // Language matches - update content if it differs (fixes external change bug)
            // Use existing function to maintain consistency
            updateCachedModelContent(tabId, content, 'reactivating');
            // Return the updated model
            return model || null;
          }
        } catch (e) {
          console.warn('[useMonacoModels] Error while checking cached model language:', e);
        }
      } else {
        // dispose済みモデルはMapから削除
        if (model) {
          monacoModelMap.delete(tabId);
        }
        model = undefined;
      }

      if (!model) {
        // Enforce model limit before creating a new model
        enforceModelLimit(monacoModelMap, MONACO_CONFIG.MAX_MONACO_MODELS);

        try {
          // Monaco's TypeScript worker derives ScriptKind from uri.toString().
          // Keep the real Pyxis file path as the URI path so it ends with .ts/.tsx,
          // and put tab identity in the authority for per-tab uniqueness.
          const uri = mon.Uri.parse(desiredUriValue);
          // computed URI log removed in cleanup

          // Check existing Monaco model for this uri and reuse when possible.
          try {
            const existingModel = mon.editor.getModel(uri);
            if (existingModel && isModelSafe(existingModel)) {
              if (existingModel.getLanguageId() !== desiredLang) {
                try {
                  mon.editor.setModelLanguage(existingModel, desiredLang);
                  mon.editor.setModelMarkers(existingModel, 'typescript', []);
                  mon.editor.setModelMarkers(existingModel, 'javascript', []);
                } catch (e) {
                  console.warn('[useMonacoModels] Failed to update existing model language:', e);
                }
              }

              // Reuse and sync content
              if (existingModel.getValue() !== content) existingModel.setValue(content);
              monacoModelMap.set(tabId, existingModel);
              updateModelAccessOrder(tabId);
              return existingModel;
            }
          } catch (e) {
            console.warn('[useMonacoModels] mon.editor.getModel error:', e);
          }

          const language = getMonarchLanguage(languageFileName);
          const newModel = mon.editor.createModel(content, language, uri);
          try {
            (mon.editor as any).setModelLanguage(newModel, getModelLanguage(languageFileName));
          } catch (e) {
            // ignore
          }
          monacoModelMap.set(tabId, newModel);
          updateModelAccessOrder(tabId);
          return newModel;
        } catch (createError: any) {
          console.error('[useMonacoModels] Model creation failed:', createError);
          return null;
        }
      }
      return model;
    },
    [isModelSafe]
  );

  const disposeModel = useCallback((tabId: string) => {
    const monacoModelMap = monacoModelMapRef.current;
    const model = monacoModelMap.get(tabId);
    if (model) {
      try {
        model.dispose();
        console.log('[useMonacoModels] Disposed model for:', tabId);
      } catch (e) {
        console.warn('[useMonacoModels] Failed to dispose model:', e);
      }
      monacoModelMap.delete(tabId);
      // Remove from LRU access order
      const index = modelAccessOrder.indexOf(tabId);
      if (index > -1) {
        modelAccessOrder.splice(index, 1);
      }
    }
  }, []);

  const disposeAllModels = useCallback(() => {
    const monacoModelMap = monacoModelMapRef.current;
    monacoModelMap.forEach((model, tabId) => {
      try {
        model.dispose();
        console.log('[useMonacoModels] Disposed model for:', tabId);
      } catch (e) {
        console.warn('[useMonacoModels] Failed to dispose model:', e);
      }
    });
    monacoModelMap.clear();
    // Clear LRU access order
    modelAccessOrder.length = 0;
    currentModelIdRef.current = null;
  }, [currentModelIdRef]);

  return {
    monacoModelMapRef,
    currentModelIdRef,
    isModelSafe,
    getOrCreateModel,
    disposeModel,
    disposeAllModels,
  };
}
