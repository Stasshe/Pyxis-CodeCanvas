import type { Monaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useCallback } from 'react';

import { getLanguage } from '../editors/editor-utils';

// Monarch言語用のヘルパー
function getMonarchLanguage(fileName: string): string {
  const ext = fileName.toLowerCase();
  if (ext.endsWith('.tsx')) return 'enhanced-tsx';
  if (ext.endsWith('.jsx')) return 'enhanced-jsx';
  if (ext.endsWith('.ts')) return 'typescript';
  if (ext.endsWith('.js')) return 'javascript';
  
  // その他はデフォルトのgetLanguageを使用
  return getLanguage(fileName);
}

// モジュール共有のモデルMap（シングルトン）
const sharedModelMap: Map<string, monaco.editor.ITextModel> = new Map();

// モジュール共有の currentModelIdRef 互換オブジェクト
const sharedCurrentModelIdRef: { current: string | null } = { current: null };

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
          const safeFileName = fileName && fileName.length > 0 ? fileName : `untitled-${tabId}`;
          const path = safeFileName.startsWith('/') ? safeFileName : `/${safeFileName}`;
          const uri = mon.Uri.parse(`inmemory://model${path}`);

          // 既存のモデルを再利用
          try {
            const existingModel = mon.editor.getModel(uri);
            if (isModelSafe(existingModel)) {
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
            console.warn('[useMonacoModels] mon.editor.getModel failed:', e);
          }

          // 強化されたJSX/TSX言語を使用
          const language = getMonarchLanguage(fileName);
          const newModel = mon.editor.createModel(content, language, uri);
          monacoModelMap.set(tabId, newModel);
          console.debug(
            '[useMonacoModels] Created new model for:',
            tabId,
            'language:',
            language,
            'uri:',
            uri.toString()
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