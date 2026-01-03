import type { Monaco } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useCallback } from 'react';

import { getLanguage } from '../editors/editor-utils';
import { getEnhancedLanguage, getModelLanguage } from '../editors/monarch-jsx-language';

import { MONACO_CONFIG } from '@/context/config';

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
 */
export function updateCachedModelContent(tabId: string, content: string): void {
  const model = sharedModelMap.get(tabId);
  if (model && typeof model.isDisposed === 'function' && !model.isDisposed()) {
    try {
      const currentValue = model.getValue();
      if (currentValue !== content) {
        model.setValue(content);
        console.log('[useMonacoModels] Updated cached model content for inactive tab:', tabId);
      }
    } catch (e) {
      console.warn('[useMonacoModels] Failed to update cached model content:', e);
    }
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
    if (oldestTabId) {
      const oldModel = monacoModelMap.get(oldestTabId);
      if (oldModel) {
        try {
          oldModel.dispose();
          console.log('[useMonacoModels] Disposed oldest model (LRU):', oldestTabId);
        } catch (e) {
          console.warn('[useMonacoModels] Failed to dispose model:', e);
        }
        monacoModelMap.delete(oldestTabId);
      }
    }
  }
}

export function useMonacoModels() {
  const monacoModelMapRef = { current: sharedModelMap } as {
    current: Map<string, monaco.editor.ITextModel>;
  };
  const currentModelIdRef = sharedCurrentModelIdRef;

  const isModelSafe = useCallback((model: monaco.editor.ITextModel | null | undefined) => {
    return model && typeof model.isDisposed === 'function' && !model.isDisposed();
  }, []);

  const getOrCreateModel = useCallback(
    (
      mon: Monaco,
      tabId: string,
      content: string,
      fileName: string
    ): monaco.editor.ITextModel | null => {
      // entry log removed in cleanup
      const monacoModelMap = monacoModelMapRef.current;
      let model = monacoModelMap.get(tabId);

      // If a model exists in our map, ensure it's safe and has the correct language.
      // IMPORTANT: do not dispose a model here synchronously — other editor instances
      // may be attaching to the same underlying model. Instead we remove it from
      // our map and create a new model with a unique URI when languages differ.
      if (isModelSafe(model)) {
        // Update LRU access order
        updateModelAccessOrder(tabId);
        try {
          const desiredLang = getModelLanguage(fileName);
          const currentLang = model!.getLanguageId();
          if (currentLang !== desiredLang) {
            // Remove from our map so caller will create a new model. Do NOT dispose
            // the existing model here to avoid racing with setModel()/editor lifecycle.
            monacoModelMap.delete(tabId);
            model = undefined;
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
          // Use the tabId to construct a unique in-memory URI so different
          // tabs/files with the same base filename don't collide.
          const safeFileName = fileName && fileName.length > 0 ? fileName : `untitled-${tabId}`;
          const normalizedTabPath =
            tabId && tabId.length > 0
              ? tabId.startsWith('/')
                ? tabId
                : `/${tabId}`
              : `/${safeFileName}`;
          const uri = mon.Uri.parse(`inmemory://model${normalizedTabPath}`);
          // computed URI log removed in cleanup

          // 既存のモデルを再利用（ただし言語IDは強制的に合わせる）
          try {
            const existingModel = mon.editor.getModel(uri);
            if (existingModel && isModelSafe(existingModel)) {
              // If existing model has a different language than desired, create a
              // fresh model instead of mutating language in-place. Mutating can
              // cause diagnostics / language-service mixups across models.
              try {
                const desiredLang = getModelLanguage(fileName);
                const beforeLang = existingModel.getLanguageId();
                if (beforeLang !== desiredLang) {
                  // Create a new unique URI instead of reusing/disposing the current one.
                  // This avoids racing with other editor instances that may hold the
                  // previous model reference. Appending a timestamp ensures uniqueness.
                  const uniqueUri = mon.Uri.parse(`${uri.toString()}__${Date.now()}`);
                  const newModel = mon.editor.createModel(content, desiredLang, uniqueUri);
                  monacoModelMap.set(tabId, newModel);
                  updateModelAccessOrder(tabId);
                  return newModel;
                }
                // Languages already match — reuse safely.
                // reuse log removed in cleanup
                monacoModelMap.set(tabId, existingModel);
                updateModelAccessOrder(tabId);
                return existingModel;
              } catch (e) {
                console.warn('[useMonacoModels] Reuse/create logic failed:', e);
              }
            }
          } catch (e) {
            console.warn('[useMonacoModels] mon.editor.getModel failed:', e);
          }

          // 強化されたJSX/TSX言語を使用
          const language = getMonarchLanguage(fileName);
          const newModel = mon.editor.createModel(content, language, uri);
          // Ensure model language aligns with model-level language mapping (safety)
          try {
            const modelLang = getModelLanguage(fileName);
            (mon.editor as any).setModelLanguage(newModel, modelLang);
          } catch (e) {
            // not critical
          }
          monacoModelMap.set(tabId, newModel);
          updateModelAccessOrder(tabId);
          console.log(
            '[useMonacoModels] Created new model for:',
            tabId,
            'language:',
            language,
            'uri:',
            uri.toString(),
            'total models:',
            monacoModelMap.size
          );
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

  const updateModelContent = useCallback((tabId: string, content: string) => {
    const monacoModelMap = monacoModelMapRef.current;
    const model = monacoModelMap.get(tabId);
    if (isModelSafe(model)) {
      try {
        const currentValue = model!.getValue();
        if (currentValue !== content) {
          model!.setValue(content);
          console.log('[useMonacoModels] Updated model content for:', tabId);
        }
      } catch (e) {
        console.warn('[useMonacoModels] Failed to update model content:', e);
      }
    }
  }, [isModelSafe]);

  return {
    monacoModelMapRef,
    currentModelIdRef,
    isModelSafe,
    getOrCreateModel,
    disposeModel,
    disposeAllModels,
    updateModelContent,
  };
}
