import { useRef, useEffect, useCallback, useState } from 'react';
import Editor, { Monaco, OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useTheme } from '@/context/ThemeContext';
import { getLanguage, countCharsNoSpaces } from './editor-utils';
import { useMonacoModels } from '../hooks/useMonacoModels';
import EditorPlaceholder from '../ui/EditorPlaceholder';

// グローバルフラグ: テーマ定義を一度だけ実行
let isThemeDefined = false;

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

  const { monacoModelMapRef, currentModelIdRef, isModelSafe, getOrCreateModel, disposeAllModels } =
    useMonacoModels();

  // No breakpoint/gutter handling

  const isEditorSafe = useCallback(() => {
    return editorRef.current && !(editorRef.current as any)._isDisposed && isMountedRef.current;
  }, []);

  // テーマ定義と初期化
  const handleEditorDidMount: OnMount = (editor, mon) => {
    editorRef.current = editor;
    monacoRef.current = mon;
    setIsEditorReady(true);

    // Gutter and breakpoint click handling removed.

    // テーマ定義（初回のみ）
    if (!isThemeDefined) {
      try {
        mon.editor.defineTheme('pyxis-custom', {
          base: 'vs-dark',
          inherit: true,
          rules: [
            { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
            { token: 'keyword', foreground: '569CD6', fontStyle: 'bold' },
            { token: 'string', foreground: 'CE9178' },
            { token: 'number', foreground: 'B5CEA8' },
            { token: 'regexp', foreground: 'D16969' },
            { token: 'operator', foreground: 'D4D4D4' },
            { token: 'namespace', foreground: '4EC9B0' },
            { token: 'type', foreground: '4EC9B0' },
            { token: 'struct', foreground: '4EC9B0' },
            { token: 'class', foreground: '4EC9B0' },
            { token: 'interface', foreground: '4EC9B0' },
            { token: 'parameter', foreground: '9CDCFE' },
            { token: 'variable', foreground: '9CDCFE' },
            { token: 'property', foreground: '9CDCFE' },
            { token: 'function', foreground: 'DCDCAA' },
            { token: 'method', foreground: 'DCDCAA' },
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
      allowJs: false,
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

          // No breakpoint decorations to apply
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

        // No breakpoint decorations to apply
      } catch (e: any) {
        console.warn('[MonacoEditor] setModel failed:', e?.message);
      }
    }

    // 内容同期
    if (isModelSafe(model) && model!.getValue() !== content) {
      try {
        model!.setValue(content);
        // 強制的にエディタを再レイアウト（表示更新を確実にする）
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

  // 強制再描画イベントのリスナー（復元後のUI同期用）
  useEffect(() => {
    const handleForceRefresh = () => {
      if (!isEditorSafe() || !monacoRef.current) return;

      try {
        console.log('[MonacoEditor] Force refresh triggered for tabId:', tabId);
        const model = editorRef.current!.getModel();
        
        if (isModelSafe(model)) {
          // モデルの値を再適用してUI同期
          const currentValue = model!.getValue();
          if (currentValue !== content) {
            model!.setValue(content);
          }
          
          // レイアウトを強制更新
          editorRef.current!.layout();
          
          // 文字数も再計算
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

  // ブレークポイントの変更を監視して装飾を更新
  // No breakpoint-decoration watcher necessary

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (editorRef.current) {
        // Remove and dispose editor
        editorRef.current.dispose();
        editorRef.current = null;
      }
      // NOTE: Do NOT call `disposeAllModels()` here. Disposing all models when a single
      // MonacoEditor instance unmounts causes all open editors' models to be cleared,
      // which resets content when switching to non-editor tabs (preview/welcome/binary).
      // Keep models alive across unmounts so editors can restore state when remounted.
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
