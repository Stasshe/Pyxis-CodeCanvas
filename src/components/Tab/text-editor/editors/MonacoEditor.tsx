import { useRef, useEffect, useCallback, useState } from 'react';
import Editor, { Monaco, OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useTheme } from '@/context/ThemeContext';
import { getLanguage, countCharsNoSpaces } from './editor-utils';
import { useMonacoModels } from '../hooks/useMonacoModels';
import { useMonacoBreakpoints } from '../hooks/useMonacoBreakpoints';
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

  const {
    monacoModelMapRef,
    currentModelIdRef,
    isModelSafe,
    getOrCreateModel,
    disposeAllModels,
  } = useMonacoModels();

  const {
    updateBreakpointDecorations,
    handleEditorGutterClick,
  } = useMonacoBreakpoints(editorRef, monacoRef, currentModelIdRef.current, tabId);

  const isEditorSafe = useCallback(() => {
    return editorRef.current && !(editorRef.current as any)._isDisposed && isMountedRef.current;
  }, []);

  // テーマ定義と初期化
  const handleEditorDidMount: OnMount = (editor, mon) => {
    editorRef.current = editor;
    monacoRef.current = mon;
    setIsEditorReady(true);

    // ブレークポイントのクリック/タッチイベントを登録
    if (typeof window !== 'undefined') {
      // マウスダウンイベント（PC + タッチデバイス両対応）
      const mouseDisposable = editor.onMouseDown((e: monaco.editor.IEditorMouseEvent) => {
        handleEditorGutterClick(e);
      });

      // タッチデバイス用の追加対応: ダブルクリック防止
      const editorDomNode = editor.getDomNode();
      if (editorDomNode) {
        const handleTouchStart = (e: TouchEvent) => {
          // グリフマージン領域のタッチかチェック
          const target = e.target as HTMLElement;
          if (target && target.closest('.margin-view-overlays')) {
            // タッチの遅延を防ぐ
            e.preventDefault();
          }
        };

        editorDomNode.addEventListener('touchstart', handleTouchStart, { passive: false });
        
        // クリーンアップ用に保持
        (editor as any)._pyxisTouchHandler = handleTouchStart;
        (editor as any)._pyxisEditorDomNode = editorDomNode;
      }

      // クリーンアップ用にdisposableを保持
      (editor as any)._pyxisBreakpointDisposable = mouseDisposable;
    }

    // テーマ定義（初回のみ）
    if (!isThemeDefined) {
      try {
        // React型定義を非同期で読み込み（エラーは無視）
        Promise.all([
          fetch('https://unpkg.com/@types/react/index.d.ts').then(r => r.text()),
          fetch('https://unpkg.com/@types/react-dom/index.d.ts').then(r => r.text()),
        ])
          .then(([reactTypes, reactDomTypes]) => {
            if (monacoRef.current) {
              monacoRef.current.languages.typescript.typescriptDefaults.addExtraLib(
                reactTypes,
                'file:///node_modules/@types/react/index.d.ts'
              );
              monacoRef.current.languages.typescript.typescriptDefaults.addExtraLib(
                reactDomTypes,
                'file:///node_modules/@types/react-dom/index.d.ts'
              );
            }
          })
          .catch(e => {
            console.warn('[MonacoEditor] Failed to load React type definitions:', e);
          });

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
          
          // モデル設定後にブレークポイントを適用
          setTimeout(() => {
            updateBreakpointDecorations();
          }, 100);
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
        
        // モデル切り替え後に少し待ってからブレークポイントを適用
        setTimeout(() => {
          updateBreakpointDecorations();
        }, 50);
      } catch (e: any) {
        console.warn('[MonacoEditor] setModel failed:', e?.message);
      }
    }

    // 内容同期
    if (isModelSafe(model) && model!.getValue() !== content) {
      try {
        model!.setValue(content);
      } catch (e: any) {
        console.warn('[MonacoEditor] Model setValue failed:', e?.message);
      }
    }

    if (isModelSafe(model)) {
      onCharCountChange(countCharsNoSpaces(model!.getValue()));
    }
  }, [tabId, content, isEditorSafe, getOrCreateModel, isModelSafe, fileName]);

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
  useEffect(() => {
    if (!isEditorReady || !editorRef.current || !monacoRef.current) return;
    
    // ブレークポイントが変更されたら装飾を更新
    const timeoutId = setTimeout(() => {
      updateBreakpointDecorations();
    }, 50);

    return () => clearTimeout(timeoutId);
  }, [isEditorReady, updateBreakpointDecorations, tabId]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (editorRef.current) {
        // ブレークポイント用のイベントリスナーを削除
        const disposable = (editorRef.current as any)._pyxisBreakpointDisposable;
        if (disposable && typeof disposable.dispose === 'function') {
          disposable.dispose();
        }
        
        // タッチイベントリスナーを削除
        const touchHandler = (editorRef.current as any)._pyxisTouchHandler;
        const domNode = (editorRef.current as any)._pyxisEditorDomNode;
        if (touchHandler && domNode) {
          domNode.removeEventListener('touchstart', touchHandler);
        }
        
        editorRef.current.dispose();
        editorRef.current = null;
      }
      if (monacoRef.current) {
        disposeAllModels();
        monacoRef.current = null;
      }
      currentModelIdRef.current = null;
    };
  }, [disposeAllModels]);

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
        glyphMargin: true,
      }}
      loading={<EditorPlaceholder type="editor-loading" />}
    />
  );
}
