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

          // If a model with this URI already exists in Monaco, reuse it instead of creating a new one.
          try {
            const existing = mon.editor.getModel(uri);
            if (existing && !existing.isDisposed()) {
              // Ensure language mode matches the requested language
              try {
                const desiredLang = getLanguage(fileName);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                if (
                  (mon.languages as any) &&
                  typeof (mon.languages as any).setTextModelLanguage === 'function'
                ) {
                  try {
                    (mon.languages as any).setTextModelLanguage(existing, desiredLang);
                  } catch (e) {
                    // ignore if cannot set
                  }
                }
              } catch (e) {}

              monacoModelMap.set(tabId, existing);
              console.debug(
                '[useMonacoModels] Reusing existing model for:',
                tabId,
                'uri:',
                uri.toString()
              );
              return existing;
            }

            const newModel = mon.editor.createModel(content, getLanguage(fileName), uri);
            monacoModelMap.set(tabId, newModel);
            console.debug(
              '[useMonacoModels] Created new model for:',
              tabId,
              'uri:',
              uri.toString()
            );
            return newModel;
          } catch (createError: any) {
            // Some Monaco versions may throw if the model was created concurrently elsewhere.
            console.warn('[useMonacoModels] Model creation failed:', createError);
            try {
              const recovered = mon.editor.getModel(uri);
              if (recovered && !recovered.isDisposed()) {
                // Ensure language mode is set for recovered model as well
                try {
                  const desiredLang = getLanguage(fileName);
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  if (
                    (mon.languages as any) &&
                    typeof (mon.languages as any).setTextModelLanguage === 'function'
                  ) {
                    try {
                      (mon.languages as any).setTextModelLanguage(recovered, desiredLang);
                    } catch (e) {
                      // ignore
                    }
                  }
                } catch (e) {}

                monacoModelMap.set(tabId, recovered);
                console.debug(
                  '[useMonacoModels] Recovered existing model after create failure for:',
                  tabId,
                  'uri:',
                  uri.toString()
                );
                return recovered;
              }
            } catch (err) {
              console.error('[useMonacoModels] Failed to recover model after create error:', err);
            }
            return null;
          }
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
