import type { Monaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useRef, useCallback } from 'react';

import { getLanguage } from '../editors/editor-utils';

/**
 * Monaco Editor用のモデル管理フック
 */
export function useMonacoModels() {
  const monacoModelMapRef = useRef<Map<string, monaco.editor.ITextModel>>(new Map());
  const currentModelIdRef = useRef<string | null>(null);

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
      const monacoModelMap = monacoModelMapRef.current;
      let model = monacoModelMap.get(tabId);

      // dispose済みモデルはMapから削除
      if (!isModelSafe(model)) {
        if (model) {
          monacoModelMap.delete(tabId);
        }
        model = undefined;
      }

      if (!model) {
        try {
          const newModel = mon.editor.createModel(content, getLanguage(fileName));
          monacoModelMap.set(tabId, newModel);
          console.debug('[useMonacoModels] Created new model for:', tabId);
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
        console.debug('[useMonacoModels] Disposed model for:', tabId);
      } catch (e) {
        console.warn('[useMonacoModels] Failed to dispose model:', e);
      }
      monacoModelMap.delete(tabId);
    }
  }, []);

  const disposeAllModels = useCallback(() => {
    const monacoModelMap = monacoModelMapRef.current;
    monacoModelMap.forEach((model, tabId) => {
      try {
        model.dispose();
        console.debug('[useMonacoModels] Disposed model for:', tabId);
      } catch (e) {
        console.warn('[useMonacoModels] Failed to dispose model:', e);
      }
    });
    monacoModelMap.clear();
    currentModelIdRef.current = null;
  }, []);

  return {
    monacoModelMapRef,
    currentModelIdRef,
    isModelSafe,
    getOrCreateModel,
    disposeModel,
    disposeAllModels,
  };
}
