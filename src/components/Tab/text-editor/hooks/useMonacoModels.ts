import type { Monaco } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useCallback } from 'react';
import { MONACO_CONFIG } from '@/constants/config';
import { getLanguage } from '../editors/editor-utils';
import { getEnhancedLanguage, getModelLanguage } from '../editors/monarch-jsx-language';
import {
  getLanguageFileName,
  getModelCacheKey,
  getWorkspaceModelUri,
} from '../utils/monacoPathUtils';

/**
 * Monaco Model Management — Workspace Model Architecture
 *
 * URI scheme: inmemory://workspace/<filePath>
 *
 * One Monaco model per unique file path (not per tab).
 * Same file opened in multiple panes shares the same model → edits sync automatically.
 * Tab-specific state (cursor, scroll, selections) is stored as ICodeEditorViewState
 * keyed by tabId, separate from the model.
 *
 * Why fixed 'workspace' authority:
 *   TypeScript worker resolves './math' from 'inmemory://workspace/src/use-math.ts'
 *   → looks for 'inmemory://workspace/src/math.ts' → found. Cross-file resolution works.
 *
 * Model cache key:
 *   filePath  — for file-based tabs (shared model)
 *   tabId     — for untitled tabs (unique model)
 */

// Model map keyed by modelKey (filePath or tabId for untitled)
const sharedModelMap: Map<string, monaco.editor.ITextModel> = new Map();

// LRU access order (by modelKey)
const modelAccessOrder: string[] = [];

// View states keyed by tabId — persists cursor/scroll across tab switches
const tabViewStates: Map<string, monaco.editor.ICodeEditorViewState | null> = new Map();

const sharedCurrentModelIdRef: { current: string | null } = { current: null };

function getMonarchLanguage(fileName: string): string {
  const ext = fileName.toLowerCase();
  if (ext.endsWith('.tsx')) return getEnhancedLanguage(fileName);
  if (ext.endsWith('.jsx')) return getEnhancedLanguage(fileName);
  if (ext.endsWith('.ts')) return 'typescript';
  if (ext.endsWith('.js')) return 'javascript';
  return getLanguage(fileName);
}

function updateModelAccessOrder(modelKey: string): void {
  const index = modelAccessOrder.indexOf(modelKey);
  if (index > -1) modelAccessOrder.splice(index, 1);
  modelAccessOrder.push(modelKey);
}

function enforceModelLimit(maxModels: number): void {
  while (sharedModelMap.size >= maxModels && modelAccessOrder.length > 0) {
    const oldest = modelAccessOrder.shift();
    if (!oldest) continue;
    const model = sharedModelMap.get(oldest);
    if (!model) continue;
    try {
      model.dispose();
    } catch (e) {
      console.warn('[useMonacoModels] Failed to dispose model:', e);
    }
    sharedModelMap.delete(oldest);
  }
}

/**
 * Update Monaco model content from outside (e.g. file watcher, external save).
 * modelKey = filePath for file-based tabs, tabId for untitled.
 */
export function updateCachedModelContent(modelKey: string, content: string): void {
  const model = sharedModelMap.get(modelKey);
  if (!model || model.isDisposed()) return;
  try {
    if (model.getValue() !== content) model.setValue(content);
  } catch (e) {
    console.warn('[useMonacoModels] updateCachedModelContent failed:', e);
  }
}

/**
 * Save editor view state for a tab (cursor, scroll, folding).
 * Call before switching away from a tab.
 */
export function saveTabViewState(tabId: string, editor: monaco.editor.IStandaloneCodeEditor): void {
  try {
    tabViewStates.set(tabId, editor.saveViewState());
  } catch (e) {
    console.warn('[useMonacoModels.ts] caught non-fatal error', e);
    // ignore
  }
}

/**
 * Restore editor view state for a tab.
 * Call after switching to a tab and setting the model.
 */
export function restoreTabViewState(
  tabId: string,
  editor: monaco.editor.IStandaloneCodeEditor
): void {
  const state = tabViewStates.get(tabId);
  if (!state) return;
  try {
    editor.restoreViewState(state);
  } catch (e) {
    console.warn('[useMonacoModels.ts] caught non-fatal error', e);
    // ignore
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
      const languageFileName = getLanguageFileName(filePath, fileName);
      const desiredLang = getModelLanguage(languageFileName);
      const desiredUriValue = getWorkspaceModelUri(filePath, tabId);
      const modelKey = getModelCacheKey(filePath, tabId);
      let model = sharedModelMap.get(modelKey);

      if (model && !model.isDisposed()) {
        updateModelAccessOrder(modelKey);
        const currentLang = model.getLanguageId();
        const currentUri = model.uri.toString();

        if (currentUri === desiredUriValue) {
          // Language update if stale
          if (currentLang !== desiredLang) {
            try {
              mon.editor.setModelLanguage(model, desiredLang);
              mon.editor.setModelMarkers(model, 'typescript', []);
              mon.editor.setModelMarkers(model, 'javascript', []);
            } catch (e) {
              console.warn('[useMonacoModels] Failed to update model language:', e);
            }
          }
          // Sync content
          if (model.getValue() !== content) model.setValue(content);
          return model;
        }

        // URI mismatch (filePath changed for this tab) — replace model
        sharedModelMap.delete(modelKey);
        try {
          mon.editor.setModelMarkers(model, 'typescript', []);
          mon.editor.setModelMarkers(model, 'javascript', []);
        } catch (e) {
          console.warn('[useMonacoModels.ts] caught non-fatal error', e);
          // ignore
        }
        window.setTimeout(() => {
          try {
            if (model && !model.isDisposed()) model.dispose();
          } catch (e) {
            console.warn('[useMonacoModels] Failed to dispose stale URI model:', e);
          }
        }, 0);
        model = undefined;
      } else if (model) {
        sharedModelMap.delete(modelKey);
        model = undefined;
      }

      // Create new model
      enforceModelLimit(MONACO_CONFIG.MAX_MONACO_MODELS);

      try {
        const uri = mon.Uri.parse(desiredUriValue);

        // Reuse existing Monaco registry model if URI already exists
        const existingModel = mon.editor.getModel(uri);
        if (existingModel && !existingModel.isDisposed()) {
          if (existingModel.getLanguageId() !== desiredLang) {
            try {
              mon.editor.setModelLanguage(existingModel, desiredLang);
              mon.editor.setModelMarkers(existingModel, 'typescript', []);
              mon.editor.setModelMarkers(existingModel, 'javascript', []);
            } catch (e) {
              console.warn('[useMonacoModels] Failed to update existing model language:', e);
            }
          }
          if (existingModel.getValue() !== content) existingModel.setValue(content);
          sharedModelMap.set(modelKey, existingModel);
          updateModelAccessOrder(modelKey);
          return existingModel;
        }

        const monarchLang = getMonarchLanguage(languageFileName);
        const newModel = mon.editor.createModel(content, monarchLang, uri);
        try {
          (mon.editor as any).setModelLanguage(newModel, desiredLang);
        } catch (e) {
          console.warn('[useMonacoModels.ts] caught non-fatal error', e);
          // ignore
        }
        sharedModelMap.set(modelKey, newModel);
        updateModelAccessOrder(modelKey);

        // New TS/JS model added → re-trigger diagnostics on existing TS/JS models.
        // Monaco's DiagnosticsAdapter only re-evaluates a model when its version changes.
        // Without this, existing open models (e.g. use-math.ts) won't clear
        // "Cannot find module './math'" until page reload.
        if (desiredLang === 'typescript' || desiredLang === 'javascript') {
          window.setTimeout(() => {
            for (const [key, m] of sharedModelMap) {
              if (key === modelKey || m.isDisposed()) continue;
              const lang = m.getLanguageId();
              if (lang !== 'typescript' && lang !== 'javascript') continue;
              try {
                // setValue bumps the model version → DiagnosticsAdapter schedules re-evaluation
                m.setValue(m.getValue());
              } catch (e) {
                console.warn('[useMonacoModels.ts] caught non-fatal error', e);
                // ignore
              }
            }
          }, 150);
        }

        return newModel;
      } catch (e) {
        console.error('[useMonacoModels] Model creation failed:', e);
        return null;
      }
    },
    []
  );

  const disposeModel = useCallback((modelKey: string) => {
    const model = sharedModelMap.get(modelKey);
    if (model) {
      try {
        model.dispose();
      } catch (e) {
        console.warn('[useMonacoModels] Failed to dispose model:', e);
      }
      sharedModelMap.delete(modelKey);
      const index = modelAccessOrder.indexOf(modelKey);
      if (index > -1) modelAccessOrder.splice(index, 1);
    }
  }, []);

  const disposeAllModels = useCallback(() => {
    sharedModelMap.forEach(model => {
      try {
        model.dispose();
      } catch (e) {
        console.warn('[useMonacoModels] Failed to dispose model:', e);
      }
    });
    sharedModelMap.clear();
    modelAccessOrder.length = 0;
    tabViewStates.clear();
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
