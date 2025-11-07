import type { Monaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useCallback } from 'react';

import { getLanguage } from '../editors/editor-utils';

/**
 * Monaco Editor用のモデル管理フック
 *
 * NOTE:
 * モデルは各 `MonacoEditor` コンポーネントローカルに保持すると、エディタがアンマウント
 * されるたびに参照が失われ、結果として状態がリセットされる問題が発生する。ここではモジュー
 * ルレベルで共有するMapとcurrentModelIdRefを用意し、複数のエディタインスタンスでモデルを
 * 共有できるようにする（シングルトン）。明示的にモデルを破棄したい場合は `disposeModel(tabId)`
 * や `disposeAllModels()` を呼ぶ。
 */

// モジュール共有のモデルMap（シングルトン）
const sharedModelMap: Map<string, monaco.editor.ITextModel> = new Map();

// モジュール共有の currentModelIdRef 互換オブジェクト
const sharedCurrentModelIdRef: { current: string | null } = { current: null };

export function useMonacoModels() {
  // return の型は以前と互換性があるように ref 互換オブジェクトを返す
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
          // Create a URI that includes the file name/extension. Monaco's
          // TypeScript/JavaScript language service infers JSX/TSX parsing
          // and many diagnostics based on the model's URI (file extension).
          // If we create a model without a URI or extension, diagnostics may
          // not be produced as expected.
          const safeFileName = fileName && fileName.length > 0 ? fileName : `untitled-${tabId}`;
          // Ensure leading slash so path looks like /path/to/file.ext
          const path = safeFileName.startsWith('/') ? safeFileName : `/${safeFileName}`;
          const uri = mon.Uri.parse(`inmemory://model${path}`);

          // If a model with this URI already exists in Monaco, reuse it rather than
          // attempting to create a new one. createModel will throw if the same URI
          // is used twice, which happens when the same file is opened in multiple
          // panes (different tabId) but we build the URI only from the filename.
          try {
            const existingModel = mon.editor.getModel(uri);
            if (isModelSafe(existingModel)) {
              // Cache under the current tabId for fast lookup and return the model.
              monacoModelMap.set(tabId, existingModel as monaco.editor.ITextModel);
              console.debug(
                '[useMonacoModels] Reusing existing model for:',
                tabId,
                'uri:',
                uri.toString()
              );
              return existingModel as monaco.editor.ITextModel;
            }
          } catch (e) {
            // getModel shouldn't normally throw, but be defensive.
            console.warn('[useMonacoModels] mon.editor.getModel failed:', e);
          }

          const newModel = mon.editor.createModel(content, getLanguage(fileName), uri);
          monacoModelMap.set(tabId, newModel);
          console.debug('[useMonacoModels] Created new model for:', tabId, 'uri:', uri.toString());
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
