import { useRef, useEffect, useCallback, useState, useContext, useMemo } from 'react';
import { useTheme } from '@/context/ThemeContext';
import MarkdownPreviewTab from './MarkdownPreviewTab';
import WelcomeTab from './WelcomeTab';
import BinaryTabContent from './BinaryTabContent';
import Editor, { Monaco, OnMount } from '@monaco-editor/react';
import { FileText } from 'lucide-react';
import { Tab } from '@/types';
import { isBufferArray } from '@/utils/helper/isBufferArray';
// バイナリファイルのMIMEタイプ推定
function guessMimeType(fileName: string, buffer?: ArrayBuffer): string {
  const ext = fileName.toLowerCase();
  if (ext.match(/\.(png)$/)) return 'image/png';
  if (ext.match(/\.(jpg|jpeg)$/)) return 'image/jpeg';
  if (ext.match(/\.(gif)$/)) return 'image/gif';
  if (ext.match(/\.(bmp)$/)) return 'image/bmp';
  if (ext.match(/\.(webp)$/)) return 'image/webp';
  if (ext.match(/\.(svg)$/)) return 'image/svg+xml';
  if (ext.match(/\.(pdf)$/)) return 'application/pdf';
  if (ext.match(/\.(mp3)$/)) return 'audio/mpeg';
  if (ext.match(/\.(wav)$/)) return 'audio/wav';
  if (ext.match(/\.(ogg)$/)) return 'audio/ogg';
  if (ext.match(/\.(mp4)$/)) return 'video/mp4';
  // 他はapplication/octet-stream
  return 'application/octet-stream';
}
import * as monaco from 'monaco-editor';
import CodeMirror from '@uiw/react-codemirror';
// CodeMirror用: 履歴分離のためkeyにタブIDを使う
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import { css } from '@codemirror/lang-css';
import { python } from '@codemirror/lang-python';
import { yaml } from '@codemirror/lang-yaml';
import { oneDark } from '@codemirror/theme-one-dark';
import { highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, drawSelection } from '@codemirror/view';
import { highlightSelectionMatches } from '@codemirror/search';
import { html } from '@codemirror/lang-html';
import { extent } from 'd3';

interface CodeEditorProps {
  activeTab: Tab | undefined;
  bottomPanelHeight: number;
  isBottomPanelVisible: boolean;
  onContentChange: (tabId: string, content: string) => void;
  wordWrapConfig: 'on' | 'off';
  onContentChangeImmediate: (tabId: string, content: string) => void;
  nodeRuntimeOperationInProgress?: boolean;
  isCodeMirror?: boolean;
  currentProjectName?: string;
  projectFiles?: any[]; // FileItem[];
}

const getLanguage = (filename: string): string => {
  const ext = filename.toLowerCase();
  if (ext.endsWith('.tsx')) return 'typescript';
  if (ext.endsWith('.ts')) return 'typescript';
  if (ext.endsWith('.jsx')) return 'javascript';
  if (ext.endsWith('.js')) return 'javascript';
  if (ext.endsWith('.mjs')) return 'javascript';
  if (ext.endsWith('.cjs')) return 'javascript';
  if (ext.endsWith('.gs')) return 'javascript';
  if (ext.endsWith('.json') || ext.endsWith('.jsonc')) return 'json';
  if (ext.endsWith('.md') || ext.endsWith('.markdown')) return 'markdown';
  if (ext.endsWith('.html') || ext.endsWith('.htm') || ext.endsWith('.xhtml')) return 'html';
  if (ext.endsWith('.css')) return 'css';
  if (ext.endsWith('.scss') || ext.endsWith('.sass')) return 'scss';
  if (ext.endsWith('.less')) return 'less';
  if (ext.endsWith('.styl')) return 'stylus';
  if (ext.endsWith('.py') || ext.endsWith('.pyw')) return 'python';
  if (ext.endsWith('.java')) return 'java';
  if (ext.endsWith('.kt') || ext.endsWith('.kts')) return 'kotlin';
  if (ext.endsWith('.swift')) return 'swift';
  if (ext.endsWith('.rb')) return 'ruby';
  if (ext.endsWith('.php')) return 'php';
  if (ext.endsWith('.go')) return 'go';
  if (ext.endsWith('.rs')) return 'rust';
  if (ext.endsWith('.cpp') || ext.endsWith('.cc') || ext.endsWith('.cxx') || ext.endsWith('.hpp') || ext.endsWith('.hxx')) return 'cpp';
  if (ext.endsWith('.c') || ext.endsWith('.h')) return 'c';
  if (ext.endsWith('.cs')) return 'csharp';
  if (ext.endsWith('.xml') || ext.endsWith('.xsd') || ext.endsWith('.xslt') || ext.endsWith('.xsl')) return 'xml';
  if (ext.endsWith('.yaml') || ext.endsWith('.yml')) return 'yaml';
  if (ext.endsWith('.toml')) return 'toml';
  if (ext.endsWith('.ini') || ext.endsWith('.conf')) return 'ini';
  if (ext.endsWith('.sql')) return 'sql';
  if (ext.endsWith('.sh') || ext.endsWith('.bash')) return 'shell';
  if (ext.endsWith('.bat') || ext.endsWith('.cmd')) return 'bat';
  if (ext.endsWith('.ps1')) return 'powershell';
  if (ext.endsWith('.dockerfile') || ext.endsWith('dockerfile')) return 'dockerfile';
  if (ext.endsWith('.makefile') || ext.endsWith('makefile')) return 'makefile';
  if (ext.endsWith('.r')) return 'r';
  if (ext.endsWith('.pl')) return 'perl';
  if (ext.endsWith('.lua')) return 'lua';
  if (ext.endsWith('.dart')) return 'dart';
  if (ext.endsWith('.scala')) return 'scala';
  if (ext.endsWith('.groovy')) return 'groovy';
  if (ext.endsWith('.coffee')) return 'coffeescript';
  if (ext.endsWith('.elm')) return 'elm';
  if (ext.endsWith('.clj') || ext.endsWith('.cljs') || ext.endsWith('.cljc')) return 'clojure';
  if (ext.endsWith('.tex')) return 'latex';
  if (ext.endsWith('.vue')) return 'vue';
  if (ext.endsWith('.svelte')) return 'svelte';
  if (ext.endsWith('.sol')) return 'solidity';
  if (ext.endsWith('.asm')) return 'assembly';
  if (ext.endsWith('.matlab') || ext.endsWith('.m')) return 'matlab';
  if (ext.endsWith('.vhdl') || ext.endsWith('.vhd')) return 'vhdl';
  if (ext.endsWith('.verilog') || ext.endsWith('.v')) return 'verilog';
  if (ext.endsWith('.f90') || ext.endsWith('.f95') || ext.endsWith('.for') || ext.endsWith('.f')) return 'fortran';
  if (ext.endsWith('.ada')) return 'ada';
  if (ext.endsWith('.dart')) return 'dart';
  if (ext.endsWith('.tsv') || ext.endsWith('.csv')) return 'plaintext';
  return 'plaintext';
};

const getCMExtensions = (filename: string) => {
  const ext = filename.toLowerCase();
  let lang: any[] = [];
  if (ext.endsWith('.js') || ext.endsWith('.jsx') || ext.endsWith('.mjs') || ext.endsWith('.ts') || ext.endsWith('.tsx')) lang = [javascript()];
  else if (ext.endsWith('.md') || ext.endsWith('.markdown')) lang = [markdown()];
  else if (ext.endsWith('.xml')) lang = [xml()];
  else if (ext.endsWith('.css')) lang = [css()];
  else if (ext.endsWith('.py')) lang = [python()];
  else if (ext.endsWith('.yaml') || ext.endsWith('.yml')) lang = [yaml()];
  else if (ext.endsWith('.html') || ext.endsWith('.htm') || ext.endsWith('.xhtml')) lang = [html()];
  // shellは拡張なし
  return [
    oneDark,
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    drawSelection(),
    highlightSelectionMatches(),
    ...lang
  ];
};

export default function CodeEditor({
  activeTab,
  bottomPanelHeight,
  isBottomPanelVisible,
  onContentChange,
  onContentChangeImmediate,
  nodeRuntimeOperationInProgress = false,
  isCodeMirror = false,
  currentProjectName,
  projectFiles,
  wordWrapConfig
}: CodeEditorProps) {
  const { colors } = useTheme();
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  
  // Monaco用: ファイルごとにTextModelを管理するMap（コンポーネント内で管理）
  const monacoModelMapRef = useRef<Map<string, monaco.editor.ITextModel>>(new Map());
  
  // 現在設定されているモデルのIDを追跡
  const currentModelIdRef = useRef<string | null>(null);
  
  // マウント状態をグローバルに管理
  const isMountedRef = useRef(true);
  
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // 文字数カウント用 state（スペース除外）
  const [charCount, setCharCount] = useState(0);
  const [selectionCount, setSelectionCount] = useState<number | null>(null);
  // 文字数カウント（スペース除外）
  const countCharsNoSpaces = (text: string) => text.replace(/\s/g, '').length;

  // 親のflex-1 + min-h-0で高さ制御するため、height: '100%'に統一
  const editorHeight = '100%';

  // デバウンス付きの保存関数
  const debouncedSave = useCallback((tabId: string, content: string) => {
    // NodeRuntime操作中は保存を一時停止
    if (nodeRuntimeOperationInProgress) {
      console.log('[CodeEditor] Skipping debounced save during NodeRuntime operation');
      return;
    }
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    // タブIDとコンテンツを保存して、タイムアウト時に最新の値を使用できるようにする
    const currentTabId = tabId;
    const currentContent = content;
    
    saveTimeoutRef.current = setTimeout(() => {
      console.log('[CodeEditor] Debounced save triggered for:', currentTabId);
      // 保存処理を実行（page.tsxで最小ペインインデックスのチェックを行う）
      onContentChange(currentTabId, currentContent);
    }, 5000); // 5秒後に保存
  }, [onContentChange, nodeRuntimeOperationInProgress]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // 安全にエディターやモデルの状態をチェックするヘルパー関数
  const isEditorSafe = useCallback(() => {
    return editorRef.current && 
           !((editorRef.current as any)._isDisposed) && 
           isMountedRef.current;
  }, []);

  const isModelSafe = useCallback((model: monaco.editor.ITextModel | null | undefined) => {
    return model && 
           typeof model.isDisposed === 'function' && 
           !model.isDisposed();
  }, []);

  // Monaco Editor: ファイルごとにTextModelを管理し、タブ切り替え時にモデルを切り替える
  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // テーマ定義（初回のみ）
    try {
      Promise.all([
        fetch('https://unpkg.com/@types/react/index.d.ts').then(r => r.text()),
        fetch('https://unpkg.com/@types/react-dom/index.d.ts').then(r => r.text())
      ]).then(([reactTypes, reactDomTypes]) => {
        monaco.languages.typescript.typescriptDefaults.addExtraLib(reactTypes, 'file:///node_modules/@types/react/index.d.ts');
        monaco.languages.typescript.typescriptDefaults.addExtraLib(reactDomTypes, 'file:///node_modules/@types/react-dom/index.d.ts');
      }).catch(e => {
        console.warn('[CodeEditor] Failed to load React type definitions:', e);
      });
      monaco.editor.defineTheme('pyxis-custom', {
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
        }
      });
      monaco.editor.setTheme('pyxis-custom');
    } catch (e) {
      // テーマが既に定義されている場合は無視
      console.warn('[CodeEditor] Theme already defined:', e);
    }

    // TypeScript/JavaScript設定
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: false
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: false
    });
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.CommonJS,
      noEmit: true,
      esModuleInterop: true,
      jsx: monaco.languages.typescript.JsxEmit.React,
      reactNamespace: 'React',
      allowJs: false,
      typeRoots: ['node_modules/@types']
    });

    // 選択範囲の文字数（スペース除外）を検知
    editor.onDidChangeCursorSelection((e) => {
      if (!isEditorSafe()) return;
      const selection = e.selection;
      const model = editor.getModel();
      if (!isModelSafe(model)) return;
      const length = countCharsNoSpaces(model!.getValueInRange(selection)) ?? 0;
      if (selection.isEmpty()) {
        setSelectionCount(null);
      } else {
        setSelectionCount(length);
      }
    });

    // 初期モデルを設定（activeTabがある場合）
    if (activeTab && !isBufferArray((activeTab as any).bufferContent) && 
        activeTab.id !== 'welcome' && !activeTab.preview && !isCodeMirror) {
      const monacoModelMap = monacoModelMapRef.current;
      let model = monacoModelMap.get(activeTab.id);
      
      if (!isModelSafe(model)) {
        // 既存のモデルが破棄されている場合は削除
        if (model) {
          monacoModelMap.delete(activeTab.id);
        }
        
        model = monaco.editor.createModel(
          activeTab.content,
          getLanguage(activeTab.name)
        );
        monacoModelMap.set(activeTab.id, model);
      }
      
      if (isEditorSafe() && model) {
        try {
          editor.setModel(model);
          currentModelIdRef.current = activeTab.id;
          setCharCount(countCharsNoSpaces(activeTab.content));
        } catch (e: any) {
          console.warn('[CodeEditor] Initial setModel failed:', e?.message);
          // エラーが発生した場合、モデルを再作成して再試行
          if (model) {
            try {
              model.dispose();
            } catch (disposeError) {
              console.warn('[CodeEditor] Model dispose failed:', disposeError);
            }
            monacoModelMap.delete(activeTab.id);
          }
          
          try {
            const newModel = monaco.editor.createModel(
              activeTab.content,
              getLanguage(activeTab.name)
            );
            monacoModelMap.set(activeTab.id, newModel);
            editor.setModel(newModel);
            currentModelIdRef.current = activeTab.id;
            setCharCount(activeTab.content.length);
          } catch (retryError) {
            console.error('[CodeEditor] Model creation retry failed:', retryError);
          }
        }
      }
    }
  };

  // activeTabが変わるたびにモデルを切り替える
  useEffect(() => {
    // Monaco Editorで表示すべきタブか判定（画像・PDF・Welcome・CodeMirror・Markdownプレビューは除外）
    if (!activeTab) return;
    if (
      isBufferArray((activeTab as any).bufferContent) ||
      activeTab.id === 'welcome' ||
      activeTab.preview ||
      isCodeMirror
    ) {
      return;
    }
    
    // Monaco Editorの参照が有効かつdisposeされていないかチェック
    if (!isEditorSafe() || !monacoRef.current) return;

    const monacoModelMap = monacoModelMapRef.current;
    let model = monacoModelMap.get(activeTab.id);
    
    // dispose済みモデルはMapから削除し新規作成
    if (!isModelSafe(model)) {
      if (model) {
        monacoModelMap.delete(activeTab.id);
      }
      model = undefined;
    }
    
    if (!model) {
      // 新しいモデルを作成
      try {
        model = monacoRef.current.editor.createModel(
          activeTab.content,
          getLanguage(activeTab.name)
        );
        monacoModelMap.set(activeTab.id, model);
      } catch (createError: any) {
        console.error('[CodeEditor] Model creation failed:', createError);
        return;
      }
      
      // disposeやアンマウント後はsetModelしない
      if (!isEditorSafe()) return;
      
      try {
        // モデルを設定
        editorRef.current!.setModel(model);
        currentModelIdRef.current = activeTab.id;
        setCharCount(model.getValue().length);
      } catch (e: any) {
        console.warn('[CodeEditor] setModel failed:', e?.message);
        // setModelに失敗した場合、少し待ってから再試行
        setTimeout(() => {
          if (isEditorSafe() && isModelSafe(model) && model) {
            try {
              editorRef.current!.setModel(model);
              currentModelIdRef.current = activeTab.id;
              setCharCount(model.getValue().length);
            } catch (retryError: any) {
              console.error('[CodeEditor] setModel retry failed:', retryError);
            }
          }
        }, 50);
      }
    } else {
      // 既存のモデルの場合
      // 1. 現在のエディターのモデルと異なる場合は切り替え
      if (currentModelIdRef.current !== activeTab.id) {
        // disposeやアンマウント後はsetModelしない
        if (!isEditorSafe()) return;
        
        try {
          editorRef.current!.setModel(model);
          currentModelIdRef.current = activeTab.id;
        } catch (e: any) {
          console.warn('[CodeEditor] setModel for existing model failed:', e?.message);
          // 既存のモデルが何らかの理由で使えない場合、再作成を試みる
          monacoModelMap.delete(activeTab.id);
          try {
            model.dispose();
          } catch (disposeError) {
            console.warn('[CodeEditor] Failed to dispose broken model:', disposeError);
          }
          
          // 新しいモデルを作成して再試行
          try {
            const newModel = monacoRef.current!.editor.createModel(
              activeTab.content,
              getLanguage(activeTab.name)
            );
            monacoModelMap.set(activeTab.id, newModel);
            editorRef.current!.setModel(newModel);
            currentModelIdRef.current = activeTab.id;
            setCharCount(newModel.getValue().length);
          } catch (recreateError: any) {
            console.error('[CodeEditor] Model recreation failed:', recreateError);
          }
          return;
        }
      }
      
      // 2. モデルの内容を更新（必要に応じて）
      if (isModelSafe(model) && model!.getValue() !== activeTab.content) {
        try {
          model!.setValue(activeTab.content);
        } catch (e: any) {
          console.warn('[CodeEditor] Model setValue failed:', e?.message);
          // setValueに失敗した場合は、モデルが破棄されている可能性があるので削除
          monacoModelMap.delete(activeTab.id);
          return;
        }
      }
      
      if (isModelSafe(model)) {
        setCharCount(model!.getValue().length);
      }
    }
  }, [activeTab?.id, isCodeMirror, isEditorSafe, isModelSafe]); // activeTab.contentは除去して、不要なuseEffect実行を防ぐ

  // activeTab.contentが外部から変更された場合の同期用useEffect
  useEffect(() => {
    if (!activeTab || !isEditorSafe() || !monacoRef.current) return;
    if (
      isBufferArray((activeTab as any).bufferContent) ||
      activeTab.id === 'welcome' ||
      activeTab.preview ||
      isCodeMirror
    ) {
      return;
    }

    const monacoModelMap = monacoModelMapRef.current;
    const model = monacoModelMap.get(activeTab.id);

    // 既に同じ内容なら何もしない（保存時の再レンダリング防止）
    if (
      isModelSafe(model) &&
      currentModelIdRef.current === activeTab.id &&
      model!.getValue() === activeTab.content
    ) {
      return;
    }

    if (
      isModelSafe(model) &&
      currentModelIdRef.current === activeTab.id &&
      model!.getValue() !== activeTab.content
    ) {
      try {
        // 強制的にコンテンツを同期する（ユーザーの変更は絶対に反映する）
        model!.setValue(activeTab.content);
        setCharCount(activeTab.content.length);
        console.log('[CodeEditor] Content synced for tab:', activeTab.id);
      } catch (e: any) {
        console.warn('[CodeEditor] Content sync failed, recreating model:', e?.message);
        // setValueに失敗した場合、モデルを再作成する
        monacoModelMap.delete(activeTab.id);
        try {
          model!.dispose();
        } catch (disposeError) {
          console.warn('[CodeEditor] Failed to dispose model during sync:', disposeError);
        }
        try {
          const newModel = monacoRef.current!.editor.createModel(
            activeTab.content,
            getLanguage(activeTab.name)
          );
          monacoModelMap.set(activeTab.id, newModel);
          if (isEditorSafe()) {
            editorRef.current!.setModel(newModel);
            currentModelIdRef.current = activeTab.id;
            setCharCount(activeTab.content.length);
            console.log('[CodeEditor] Model recreated and synced for tab:', activeTab.id);
          }
        } catch (recreateError: any) {
          console.error('[CodeEditor] Failed to recreate model during sync:', recreateError);
        }
      }
    }
  }, [activeTab?.content, activeTab?.id, isCodeMirror, isEditorSafe, isModelSafe]);

  // Cleanup Monaco Editor instance on unmount
  useEffect(() => {
    return () => {
      if (editorRef.current) {
        editorRef.current.dispose();
        editorRef.current = null;
      }
      if (monacoRef.current) {
        const monacoModelMap = monacoModelMapRef.current;
        monacoModelMap.forEach((model: monaco.editor.ITextModel) => model.dispose());
        monacoModelMap.clear();
        monacoRef.current = null;
      }
      currentModelIdRef.current = null;
    };
  }, []);

  if (!activeTab) {
    return (
      <div className="flex-1 min-h-0 select-none" style={{ height: editorHeight }}>
        <div className="h-full flex items-center justify-center text-muted-foreground select-none">
          <div className="text-center select-none">
            <FileText size={48} className="mx-auto mb-4 opacity-50" />
            <p className="select-none">ファイルを選択してください</p>
          </div>
        </div>
      </div>
    );
  }

  // バイナリファイル（BufferArray）なら専用表示
  const binaryContent = (
    <BinaryTabContent
      activeTab={activeTab}
      editorHeight={editorHeight}
      guessMimeType={guessMimeType}
      isBufferArray={isBufferArray}
    />
  );
  if (isBufferArray((activeTab as any).bufferContent)) return binaryContent;

  if (activeTab.id === 'welcome') {
    return (
      <div className="flex-1 min-h-0" style={{ height: editorHeight }}>
        <WelcomeTab />
      </div>
    );
  }

  if (activeTab.preview) {
    return (
      <>
        {console.log('[CodeEditor] Rendering Markdown preview for:', activeTab.name)}
        <div className="flex-1 min-h-0" style={{ height: editorHeight }}>
          <MarkdownPreviewTab 
            content={activeTab.content} 
            fileName={activeTab.name} 
            currentProjectName={currentProjectName}
            projectFiles={projectFiles}
          />
        </div>
      </>
    );
  }

  return (
    <div className="flex-1 min-h-0 relative" style={{ height: editorHeight }}>
      {isCodeMirror ? (
        <div
          tabIndex={0}
          aria-label="codemirror-editor"
          style={{
            height: '100%',
            width: '100%',
            overflow: 'auto',
            WebkitOverflowScrolling: 'touch',
            userSelect: 'text',
            WebkitUserSelect: 'text',
            msUserSelect: 'text',
            MozUserSelect: 'text',
            touchAction: 'auto',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <CodeMirror
            key={activeTab.id}
            value={activeTab.content}
            height="100%"
            theme={oneDark}
            extensions={getCMExtensions(activeTab.name)}
            basicSetup={true}
            onChange={(value) => {
              if (onContentChangeImmediate) {
                onContentChangeImmediate(activeTab.id, value);
              }
              debouncedSave(activeTab.id, value);
              setCharCount(countCharsNoSpaces(value));
              setSelectionCount(null);
            }}
            style={{
              height: '100%',
              minHeight: '100%',
              width: '100%',
              userSelect: 'text',
              WebkitUserSelect: 'text',
              msUserSelect: 'text',
              MozUserSelect: 'text',
              touchAction: 'auto',
              WebkitTapHighlightColor: 'transparent',
            }}
          />
        </div>
      ) : (
        <Editor
          height="100%"
          // key属性を削除し、model切り替えでundo履歴を保持
          // defaultValueも削除し、model管理に任せる
          onMount={handleEditorDidMount}
          onChange={(value) => {
            if (value !== undefined && activeTab) {
              try {
                // ユーザーの変更は絶対に反映する
                if (onContentChangeImmediate) {
                  onContentChangeImmediate(activeTab.id, value);
                }
                debouncedSave(activeTab.id, value);
                setCharCount(value.length);
                setSelectionCount(null);
                // console.log('[CodeEditor] User change detected for tab:', activeTab.id, 'length:', value.length);
              } catch (error: any) {
                console.error('[CodeEditor] Error handling user change:', error);
                // エラーが発生してもユーザーの変更は保存を試みる
                try {
                  if (onContentChangeImmediate) {
                    onContentChangeImmediate(activeTab.id, value);
                  }
                } catch (fallbackError: any) {
                  console.error('[CodeEditor] Fallback save also failed:', fallbackError);
                }
              }
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
              showSlider: 'always'
            },
            wordWrap: wordWrapConfig,
            tabSize: 2,
            insertSpaces: true,
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
              strings: true
            },
            hover: { enabled: true },
            bracketPairColorization: { enabled: true },
            guides: {
              bracketPairs: true,
              indentation: true
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
              horizontalScrollbarSize: 14
            }
          }}
          loading={
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                <p className="text-sm">エディターを読み込み中...</p>
              </div>
            </div>
          }
        />
      )}
      {/* 文字数カウント表示バー */}
      <div
        style={{
          position: 'absolute',
          right: 12,
          bottom: 8,
          background: 'rgba(30,30,30,0.85)',
          color: '#d4d4d4',
          padding: '2px 10px',
          borderRadius: 6,
          fontSize: 13,
          zIndex: 10,
          pointerEvents: 'none',
        }}
      >
        {selectionCount !== null
          ? `選択範囲: ${selectionCount}文字（スペース除外） / 全体: ${charCount}文字（スペース除外）`
          : `全体: ${charCount}文字（スペース除外）`}
      </div>
    </div>
  );
}