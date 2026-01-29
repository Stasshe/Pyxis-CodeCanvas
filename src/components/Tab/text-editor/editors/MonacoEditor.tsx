import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useMonacoModels } from '../hooks/useMonacoModels';
import EditorPlaceholder from '../ui/EditorPlaceholder';
import { countCharsNoSpaces } from './editor-utils';
import { configureMonacoLanguageDefaults } from './monaco-language-defaults';
import { defineAndSetMonacoThemes } from './monaco-themes';
import {
  getEnhancedLanguage,
  getModelLanguage,
  registerEnhancedJSXLanguage,
} from './monarch-jsx-language';

import { useTheme } from '@/context/ThemeContext';

// グローバルフラグ
let isLanguageRegistered = false;
let isLanguageDefaultsConfigured = false;

interface MonacoEditorProps {
  tabId: string;
  fileName: string;
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
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const isMountedRef = useRef(true);
  const markerListenerRef = useRef<monaco.IDisposable | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const { monacoModelMapRef, currentModelIdRef, isModelSafe, getOrCreateModel } = useMonacoModels();

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
      const model = getOrCreateModel(monacoRef.current, tabId, content, fileName);
      if (model && isEditorSafe()) {
        try {
          editor.setModel(model);

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
                  const startColumn = Math.max(1, Math.min(lastSel.startColumn, model.getLineMaxColumn(startLine)));
                  const endColumn = Math.max(1, Math.min(lastSel.endColumn, model.getLineMaxColumn(endLine)));

                  const restored = new (mon as any).Selection(startLine, startColumn, endLine, endColumn);
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

    const model = getOrCreateModel(monacoRef.current, tabId, content, fileName);

    if (model && currentModelIdRef.current !== tabId) {
      try {
        editorRef.current?.setModel(model);
        // marker dump removed in cleanup
        currentModelIdRef.current = tabId;
        onCharCountChange(countCharsNoSpaces(model.getValue()));
      } catch (e: any) {
        console.warn('[MonacoEditor] setModel failed:', e?.message);
      }
    }

    // 内容同期
    if (isModelSafe(model) && model?.getValue() !== content) {
      try {
        // エディタが利用可能ならビュー/選択を保持してから setValue → 復元する
        if (isEditorSafe()) {
          const editor = editorRef.current!;
          try {
            const prevView = editor.saveViewState();
            const prevSelections = editor.getSelections();
            model?.setValue(content);
            if (prevView) editor.restoreViewState(prevView);
            if (prevSelections) editor.setSelections(prevSelections);
            editor.layout();
          } catch (e) {
            // フォールバック
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

    if (isModelSafe(model)) {
      onCharCountChange(countCharsNoSpaces(model?.getValue()));
    }
  }, [tabId, content, isEditorSafe, getOrCreateModel, isModelSafe, fileName]);

  // ジャンプ機能
  useEffect(() => {
    if (!isEditorReady || !editorRef.current || !monacoRef.current) return;
    if (jumpToLine === undefined || typeof jumpToLine !== 'number') return;

    // 入力を整数にし、範囲外の場合はクランプする（Monaco は 1-based の行番号を期待する）
    const requestedLine = Math.trunc(jumpToLine);
    const requestedColumn = jumpToColumn && typeof jumpToColumn === 'number' ? Math.trunc(jumpToColumn) : 1;

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
      language={getModelLanguage(fileName)}
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
