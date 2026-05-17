import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useCallback, useEffect, useRef, useState } from 'react';

import { restoreTabViewState, saveTabViewState, useMonacoModels } from '../hooks/useMonacoModels';
import EditorPlaceholder from '../ui/EditorPlaceholder';
import { getLanguageFileName } from '../utils/monacoPathUtils';
import { countCharsNoSpaces } from './editor-utils';
import { configureMonacoLanguageDefaults } from './monaco-language-defaults';
import { defineAndSetMonacoThemes } from './monaco-themes';
import {
  getModelLanguage,
  registerEnhancedJSXLanguage,
} from './monarch-jsx-language';

import { useTheme } from '@/context/ThemeContext';
import type { EditorPane, Tab } from '@/engine/tabs/types';
import { tabActions, tabState } from '@/stores/tabState';

// グローバルフラグ
let isLanguageRegistered = false;
let isLanguageDefaultsConfigured = false;
let isEditorOpenerRegistered = false;

function findTabForFilePath(filePath: string): { paneId: string; tabId: string } | null {
  const normalized = filePath.startsWith('/') ? filePath : `/${filePath}`;
  function search(panes: readonly EditorPane[]): { paneId: string; tabId: string } | null {
    for (const p of panes) {
      const tab = p.tabs?.find((t: Tab) => {
        const tp = t.path || '';
        return tp === filePath || tp === normalized || `/${tp}` === normalized;
      });
      if (tab) return { paneId: p.id, tabId: tab.id };
      if (p.children) {
        const found = search(p.children);
        if (found) return found;
      }
    }
    return null;
  }
  return search(tabState.panes);
}

function getJumpPosition(
  sel: monaco.IRange | monaco.IPosition | undefined
): { jumpToLine: number; jumpToColumn: number } | undefined {
  if (!sel) return undefined;
  if ('startLineNumber' in sel) return { jumpToLine: sel.startLineNumber, jumpToColumn: sel.startColumn };
  return { jumpToLine: sel.lineNumber, jumpToColumn: sel.column };
}

interface MonacoEditorProps {
  tabId: string;
  fileName: string;
  filePath?: string;
  content: string;
  wordWrapConfig: 'on' | 'off';
  jumpToLine?: number;
  jumpToColumn?: number;
  onChange: (value: string) => void;
  onCharCountChange: (count: number) => void;
  onSelectionCountChange: (count: number | null) => void;
  tabSize?: number;
  insertSpaces?: boolean;
  fontSize?: number;
  isActive?: boolean;
}

export default function MonacoEditor({
  tabId,
  fileName,
  filePath,
  content,
  wordWrapConfig,
  jumpToLine,
  jumpToColumn,
  onChange,
  onCharCountChange,
  onSelectionCountChange,
  fontSize = 12,
  tabSize = 2,
  insertSpaces = true,
  isActive = false,
}: MonacoEditorProps) {
  const { colors, themeName } = useTheme();
  const languageFileName = getLanguageFileName(filePath, fileName);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const isMountedRef = useRef(true);
  const markerListenerRef = useRef<monaco.IDisposable | null>(null);
  const prevTabIdRef = useRef<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const { currentModelIdRef, isModelSafe, getOrCreateModel } = useMonacoModels();

  const isEditorSafe = useCallback(() => {
    return editorRef.current && !(editorRef.current as any)._isDisposed && isMountedRef.current;
  }, []);

  // テーマ定義と初期化
  const handleEditorDidMount: OnMount = (editor, mon) => {
    editorRef.current = editor;
    monacoRef.current = mon;
    setIsEditorReady(true);
    // language set log removed in cleanup

    // 強化言語の登録（初回のみ）
    if (!isLanguageRegistered) {
      try {
        registerEnhancedJSXLanguage(mon);
        isLanguageRegistered = true;
        // registration log removed in cleanup
      } catch (e) {
        console.warn('[MonacoEditor] Failed to register enhanced language:', e);
      }
    }

    // テーマ定義は外部モジュールに移譲
    try {
      defineAndSetMonacoThemes(mon, colors, themeName);
    } catch (e) {
      console.warn('[MonacoEditor] Failed to define/set themes via monaco-themes:', e);
    }

    // 言語診断設定（初回のみ）
    if (!isLanguageDefaultsConfigured) {
      try {
        configureMonacoLanguageDefaults(mon);
        isLanguageDefaultsConfigured = true;
      } catch (e) {
        console.warn('[MonacoEditor] Failed to configure language defaults:', e);
      }
    }

    // go-to-definition / find-references でのタブナビゲーション（初回のみ）
    if (!isEditorOpenerRegistered) {
      try {
        mon.editor.registerEditorOpener({
          openCodeEditor(_source, resource, selectionOrPosition) {
            const rawPath = resource.path;
            const filePath = rawPath.startsWith('/') ? rawPath.substring(1) : rawPath;
            if (!filePath) return false;

            const jump = getJumpPosition(selectionOrPosition);
            const found = findTabForFilePath(filePath);

            if (found) {
              tabActions.activateTab(found.paneId, found.tabId);
              if (jump) {
                tabActions.updateTab(found.paneId, found.tabId, jump as any);
              }
              return true;
            }

            // タブ未オープン → openTab でファイルを開く
            const name = filePath.split('/').pop() || filePath;
            tabActions
              .openTab({ path: filePath, name }, { makeActive: true, ...jump })
              .catch(() => {});
            return true;
          },
        });
        isEditorOpenerRegistered = true;
      } catch (e) {
        console.warn('[MonacoEditor] Failed to register editor opener:', e);
      }
    }

    // 選択範囲の文字数（スペース除外）を検知
    // ここで最後の選択状態をキャッシュしておくことで、外部からモデルがフラッシュされた
    // （例: save の同期で setValue が呼ばれる）場合に、カーソル/選択を復元できる。
    const lastSelectionRef = { current: null as monaco.Selection | null };

    editor.onDidChangeCursorSelection(e => {
      if (!isEditorSafe()) return;
      const selection = e.selection;
      lastSelectionRef.current = selection;
      const model = editor.getModel();
      if (!isModelSafe(model)) return;
      const length = countCharsNoSpaces(model?.getValueInRange(selection)) ?? 0;
      if (selection.isEmpty()) {
        onSelectionCountChange(null);
      } else {
        onSelectionCountChange(length);
      }
    });

    // 初期モデルを設定
    if (monacoRef.current) {
      const model = getOrCreateModel(monacoRef.current, tabId, content, fileName, filePath);
      if (model && isEditorSafe()) {
        try {
          editor.setModel(model);
          restoreTabViewState(tabId, editor);
          prevTabIdRef.current = tabId;

          // モデルが外部からフラッシュ(setValue)されたときに、最後に記憶した選択を復元する
          try {
            if (markerListenerRef.current) {
              try {
                markerListenerRef.current.dispose();
              } catch (e) {}
              markerListenerRef.current = null;
            }

            markerListenerRef.current = editor.onDidChangeModelContent(e => {
              if (!isEditorSafe()) return;
              // isFlush は setValue 等でモデル全体が置き換えられた時に true になる
              if (e.isFlush) {
                try {
                  const lastSel = (lastSelectionRef as any).current as monaco.Selection | null;
                  const model = editor.getModel();
                  // 型の安心性を TypeScript に明示するため、明示的な null / disposed チェックを行う
                  if (!lastSel || !model || model.isDisposed()) return;

                  // Clamp selection to model bounds
                  const lineCount = model.getLineCount();
                  const startLine = Math.max(1, Math.min(lastSel.startLineNumber, lineCount));
                  const endLine = Math.max(1, Math.min(lastSel.endLineNumber, lineCount));
                  const startColumn = Math.max(
                    1,
                    Math.min(lastSel.startColumn, model.getLineMaxColumn(startLine))
                  );
                  const endColumn = Math.max(
                    1,
                    Math.min(lastSel.endColumn, model.getLineMaxColumn(endLine))
                  );

                  const restored = new (mon as any).Selection(
                    startLine,
                    startColumn,
                    endLine,
                    endColumn
                  );
                  editor.setSelection(restored);
                  editor.revealRangeInCenter(restored);
                } catch (e) {
                  // 非致命
                }
              }
            });
          } catch (e) {
            // ignore
          }

          currentModelIdRef.current = tabId;
          onCharCountChange(countCharsNoSpaces(content));
        } catch (e: any) {
          console.warn('[MonacoEditor] Initial setModel failed:', e?.message);
        }
      }
    }
  };

  // タブ切り替え時のモデル管理
  useEffect(() => {
    if (!isEditorSafe() || !monacoRef.current) return;
    const editor = editorRef.current!;

    const model = getOrCreateModel(monacoRef.current, tabId, content, fileName, filePath);
    const prevTabId = prevTabIdRef.current;
    const tabSwitched = prevTabId !== null && prevTabId !== tabId;

    // タブ切り替え: 旧タブの viewState 保存 → 新モデルセット → 新タブの viewState 復元
    if (tabSwitched) {
      saveTabViewState(prevTabId!, editor);
    }

    if (model && (currentModelIdRef.current !== tabId || tabSwitched)) {
      try {
        editor.setModel(model);
        currentModelIdRef.current = tabId;
      } catch (e: any) {
        console.warn('[MonacoEditor] setModel failed:', e?.message);
      }
    }

    if (tabSwitched) {
      restoreTabViewState(tabId, editor);
    }

    prevTabIdRef.current = tabId;

    // 内容同期 (外部変更: ファイルウォッチャー等)
    if (isModelSafe(model) && model?.getValue() !== content) {
      try {
        if (isEditorSafe()) {
          try {
            const prevView = editor.saveViewState();
            const prevSelections = editor.getSelections();
            model?.setValue(content);
            if (prevView) editor.restoreViewState(prevView);
            if (prevSelections) editor.setSelections(prevSelections);
            editor.layout();
          } catch (e) {
            model?.setValue(content);
            editor.layout();
          }
        } else {
          model?.setValue(content);
        }
      } catch (e: any) {
        console.warn('[MonacoEditor] Model setValue failed:', e?.message);
      }
    }

    if (isModelSafe(model) && !tabSwitched) {
      onCharCountChange(countCharsNoSpaces(model?.getValue()));
    }
  }, [tabId, content, isEditorSafe, getOrCreateModel, isModelSafe, fileName, filePath]);

  // ジャンプ機能
  useEffect(() => {
    if (!isEditorReady || !editorRef.current || !monacoRef.current) return;
    if (jumpToLine === undefined || typeof jumpToLine !== 'number') return;

    // 入力を整数にし、範囲外の場合はクランプする（Monaco は 1-based の行番号を期待する）
    const requestedLine = Math.trunc(jumpToLine);
    const requestedColumn =
      jumpToColumn && typeof jumpToColumn === 'number' ? Math.trunc(jumpToColumn) : 1;

    const timeoutId = setTimeout(() => {
      try {
        const editor = editorRef.current;
        const model = editor?.getModel();

        if (!editor || !model || model.isDisposed()) return;

        const lineCount = model.getLineCount();
        let lineNumber = requestedLine;
        if (Number.isNaN(lineNumber) || lineNumber < 1) {
          lineNumber = 1;
        } else if (lineNumber > lineCount) {
          lineNumber = lineCount;
        }

        const maxColumn = model.getLineMaxColumn(lineNumber);
        let column = requestedColumn;
        if (Number.isNaN(column) || column < 1) {
          column = 1;
        } else if (column > maxColumn) {
          column = maxColumn;
        }

        editor.revealPositionInCenter({ lineNumber, column });
        editor.setPosition({ lineNumber, column });
        editor.focus();
      } catch (e) {
        console.warn('[MonacoEditor] Failed to jump to line/column:', e);
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [jumpToLine, jumpToColumn, isEditorReady]);

  // タブがアクティブになった時にエディタにフォーカスを当てる
  // タブが非アクティブになった時にフォーカスを外す
  useEffect(() => {
    if (!isEditorReady || !editorRef.current) return;

    if (isActive) {
      // アクティブになったらフォーカスを当てる
      const timeoutId = setTimeout(() => {
        if (editorRef.current && !(editorRef.current as any)._isDisposed) {
          editorRef.current.focus();
        }
      }, 50);
      return () => clearTimeout(timeoutId);
    }
    // 非アクティブになったらフォーカスを外す
    if (
      editorRef.current &&
      !(editorRef.current as any)._isDisposed &&
      editorRef.current.hasTextFocus()
    ) {
      const domNode = editorRef.current.getDomNode();
      if (domNode) {
        domNode.blur();
      }
    }
  }, [isActive, isEditorReady]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (editorRef.current) {
        saveTabViewState(tabId, editorRef.current);
        editorRef.current.dispose();
        editorRef.current = null;
      }
      if (monacoRef.current) {
        monacoRef.current = null;
      }
      if (markerListenerRef.current) {
        try {
          markerListenerRef.current.dispose();
        } catch (e) {}
        markerListenerRef.current = null;
      }
    };
  }, []);

  return (
    <Editor
      height="100%"
      language={getModelLanguage(languageFileName)}
      onMount={handleEditorDidMount}
      onChange={value => {
        if (value !== undefined) {
          onChange(value);
          onCharCountChange(countCharsNoSpaces(value));
          onSelectionCountChange(null);
        }
      }}
      theme="pyxis-custom"
      options={{
        fontSize,
        lineNumbers: 'on',
        roundedSelection: false,
        scrollBeyondLastLine: true,
        automaticLayout: true,
        minimap: {
          enabled: true,
          maxColumn: 120,
          showSlider: 'always',
        },
        wordWrap: wordWrapConfig,
        tabSize,
        insertSpaces,
        formatOnPaste: true,
        formatOnType: true,
        suggestOnTriggerCharacters: true,
        acceptSuggestionOnEnter: 'on',
        acceptSuggestionOnCommitCharacter: true,
        wordBasedSuggestions: 'allDocuments',
        parameterHints: { enabled: true },
        quickSuggestions: {
          other: true,
          comments: true,
          strings: true,
        },
        hover: { enabled: true },
        bracketPairColorization: { enabled: true },
        guides: {
          bracketPairs: true,
          indentation: true,
        },
        renderWhitespace: 'selection',
        renderControlCharacters: true,
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        mouseWheelZoom: true,
        folding: true,
        foldingStrategy: 'indentation',
        showFoldingControls: 'always',
        foldingHighlight: true,
        unfoldOnClickAfterEndOfLine: false,
        matchBrackets: 'always',
        renderLineHighlight: 'all',
        occurrencesHighlight: 'singleFile',
        selectionHighlight: true,
        codeLens: true,
        colorDecorators: true,
        links: true,
        contextmenu: true,
        mouseWheelScrollSensitivity: 1,
        fastScrollSensitivity: 5,
        scrollbar: {
          vertical: 'visible',
          horizontal: 'visible',
          useShadows: false,
          verticalScrollbarSize: 14,
          horizontalScrollbarSize: 14,
        },
        glyphMargin: false,
      }}
      loading={<EditorPlaceholder type="editor-loading" />}
    />
  );
}
