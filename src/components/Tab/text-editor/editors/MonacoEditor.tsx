import Editor, { Monaco, OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useRef, useEffect, useCallback, useState } from 'react';

import { countCharsNoSpaces } from './editor-utils';
import { useMonacoModels } from '../hooks/useMonacoModels';
import EditorPlaceholder from '../ui/EditorPlaceholder';
import { registerEnhancedJSXLanguage, getEnhancedLanguage } from './monarch-jsx-language';

import { useTheme } from '@/context/ThemeContext';

// グローバルフラグ
let isThemeDefined = false;
let isLanguageRegistered = false;

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
  tabSize = 2,
  insertSpaces = true,
}: MonacoEditorProps) {
  const { colors } = useTheme();
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const { monacoModelMapRef, currentModelIdRef, isModelSafe, getOrCreateModel } =
    useMonacoModels();

  const isEditorSafe = useCallback(() => {
    return editorRef.current && !(editorRef.current as any)._isDisposed && isMountedRef.current;
  }, []);

  // テーマ定義と初期化
  const handleEditorDidMount: OnMount = (editor, mon) => {
    editorRef.current = editor;
    monacoRef.current = mon;
    setIsEditorReady(true);

    // 強化言語の登録（初回のみ）
    if (!isLanguageRegistered) {
      try {
        registerEnhancedJSXLanguage(mon);
        isLanguageRegistered = true;
        console.log('[MonacoEditor] Enhanced JSX/TSX language registered');
      } catch (e) {
        console.warn('[MonacoEditor] Failed to register enhanced language:', e);
      }
    }

    // テーマ定義（初回のみ）
    if (!isThemeDefined) {
      try {
        mon.editor.defineTheme('pyxis-custom', {
          base: 'vs-dark',
          inherit: true,
          rules: [
            // 基本トークン
            { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
            { token: 'comment.doc', foreground: '6A9955', fontStyle: 'italic' },
            { token: 'keyword', foreground: '569CD6', fontStyle: 'bold' },
            { token: 'string', foreground: 'CE9178' },
            { token: 'string.escape', foreground: 'D7BA7D' },
            { token: 'number', foreground: 'B5CEA8' },
            { token: 'number.hex', foreground: 'B5CEA8' },
            { token: 'number.octal', foreground: 'B5CEA8' },
            { token: 'number.binary', foreground: 'B5CEA8' },
            { token: 'number.float', foreground: 'B5CEA8' },
            { token: 'regexp', foreground: 'D16969' },
            { token: 'regexp.escape', foreground: 'D7BA7D' },
            { token: 'operator', foreground: 'D4D4D4' },
            { token: 'delimiter', foreground: 'D4D4D4' },
            { token: 'delimiter.bracket', foreground: 'FFD700' },
            
            // 型・クラス系
            { token: 'type', foreground: '4EC9B0' },
            { token: 'type.identifier', foreground: '4EC9B0' },
            { token: 'namespace', foreground: '4EC9B0' },
            { token: 'struct', foreground: '4EC9B0' },
            { token: 'class', foreground: '4EC9B0' },
            { token: 'interface', foreground: '4EC9B0' },
            
            // 変数・パラメータ系
            { token: 'parameter', foreground: '9CDCFE' },
            { token: 'variable', foreground: '9CDCFE' },
            { token: 'property', foreground: 'D4D4D4' }, // プロパティは白系に
            { token: 'identifier', foreground: '9CDCFE' },
            
            // 関数・メソッド系
            { token: 'function', foreground: 'DCDCAA' },
            { token: 'function.call', foreground: 'DCDCAA' },
            { token: 'method', foreground: 'DCDCAA' },
            
            // JSX専用トークン（強調表示）
            { token: 'tag', foreground: '4EC9B0', fontStyle: 'bold' },
            { token: 'tag.jsx', foreground: '4EC9B0', fontStyle: 'bold' },
            { token: 'attribute.name', foreground: '9CDCFE', fontStyle: 'italic' },
            { token: 'attribute.name.jsx', foreground: '9CDCFE', fontStyle: 'italic' },
            { token: 'attribute.value', foreground: 'CE9178' },
            { token: 'string.jsx', foreground: 'D4D4D4' }, // JSXタグ内のテキスト
          ],
          colors: {
            'editor.background': colors.editorBg || '#1e1e1e',
            'editor.foreground': colors.editorFg || '#d4d4d4',
            'editor.lineHighlightBackground': colors.editorLineHighlight || '#2d2d30',
            'editor.selectionBackground': colors.editorSelection || '#264f78',
            'editor.inactiveSelectionBackground': '#3a3d41',
            'editorCursor.foreground': colors.editorCursor || '#aeafad',
            'editorWhitespace.foreground': '#404040',
            'editorIndentGuide.background': '#404040',
            'editorIndentGuide.activeBackground': '#707070',
            'editorBracketMatch.background': '#0064001a',
            'editorBracketMatch.border': '#888888',
          },
        });
        isThemeDefined = true;
      } catch (e) {
        console.warn('[MonacoEditor] Failed to define theme:', e);
      }
    }

    try {
      mon.editor.setTheme('pyxis-custom');
    } catch (e) {
      console.warn('[MonacoEditor] Failed to set theme:', e);
    }

    // TypeScript/JavaScript設定
    mon.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: false,
    });
    mon.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: false,
    });
    mon.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: mon.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution: mon.languages.typescript.ModuleResolutionKind.NodeJs,
      module: mon.languages.typescript.ModuleKind.CommonJS,
      noEmit: true,
      esModuleInterop: true,
      jsx: mon.languages.typescript.JsxEmit.React,
      reactNamespace: 'React',
      allowJs: true,
      typeRoots: ['node_modules/@types'],
    });

    // 選択範囲の文字数（スペース除外）を検知
    editor.onDidChangeCursorSelection(e => {
      if (!isEditorSafe()) return;
      const selection = e.selection;
      const model = editor.getModel();
      if (!isModelSafe(model)) return;
      const length = countCharsNoSpaces(model!.getValueInRange(selection)) ?? 0;
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
        editorRef.current!.setModel(model);
        currentModelIdRef.current = tabId;
        onCharCountChange(countCharsNoSpaces(model.getValue()));
      } catch (e: any) {
        console.warn('[MonacoEditor] setModel failed:', e?.message);
      }
    }

    // 内容同期
    if (isModelSafe(model) && model!.getValue() !== content) {
      try {
        model!.setValue(content);
        if (isEditorSafe()) {
          editorRef.current!.layout();
        }
      } catch (e: any) {
        console.warn('[MonacoEditor] Model setValue failed:', e?.message);
      }
    }

    if (isModelSafe(model)) {
      onCharCountChange(countCharsNoSpaces(model!.getValue()));
    }
  }, [tabId, content, isEditorSafe, getOrCreateModel, isModelSafe, fileName]);

  // 強制再描画イベントのリスナー
  useEffect(() => {
    const handleForceRefresh = () => {
      if (!isEditorSafe() || !monacoRef.current) return;

      try {
        console.log('[MonacoEditor] Force refresh triggered for tabId:', tabId);
        const model = editorRef.current!.getModel();

        if (isModelSafe(model)) {
          const currentValue = model!.getValue();
          if (currentValue !== content) {
            model!.setValue(content);
          }

          editorRef.current!.layout();
          onCharCountChange(countCharsNoSpaces(content));

          console.log('[MonacoEditor] ✓ Force refresh completed');
        }
      } catch (e) {
        console.warn('[MonacoEditor] Force refresh failed:', e);
      }
    };

    window.addEventListener('pyxis-force-monaco-refresh', handleForceRefresh);
    return () => {
      window.removeEventListener('pyxis-force-monaco-refresh', handleForceRefresh);
    };
  }, [tabId, content, isEditorSafe, isModelSafe, onCharCountChange]);

  // ジャンプ機能
  useEffect(() => {
    if (!isEditorReady || !editorRef.current || !monacoRef.current) return;
    if (jumpToLine === undefined || typeof jumpToLine !== 'number') return;

    const column = jumpToColumn && typeof jumpToColumn === 'number' ? jumpToColumn : 1;

    const timeoutId = setTimeout(() => {
      try {
        const editor = editorRef.current;
        const model = editor?.getModel();

        if (editor && model && !model.isDisposed()) {
          editor.revealPositionInCenter({ lineNumber: jumpToLine, column });
          editor.setPosition({ lineNumber: jumpToLine, column });
          editor.focus();
          console.log('[MonacoEditor] JUMP executed: line', jumpToLine, 'col', column);
        }
      } catch (e) {
        console.warn('[MonacoEditor] Failed to jump to line/column:', e);
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [jumpToLine, jumpToColumn, isEditorReady]);

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
    };
  }, []);

  return (
    <Editor
      height="100%"
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
        fontSize: 12,
        lineNumbers: 'on',
        roundedSelection: false,
        scrollBeyondLastLine: false,
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