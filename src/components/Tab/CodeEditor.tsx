import { useRef, useEffect, useCallback, useState } from 'react';
import { useTheme } from '@/context/ThemeContext';
import MarkdownPreviewTab from './MarkdownPreviewTab';
import WelcomeTab from './WelcomeTab';
import Editor, { Monaco } from '@monaco-editor/react';
import { FileText } from 'lucide-react';
import { Tab } from '@/types';
import * as monaco from 'monaco-editor';

interface CodeEditorProps {
  activeTab: Tab | undefined;
  bottomPanelHeight: number;
  isBottomPanelVisible: boolean;
  onContentChange: (tabId: string, content: string) => void;
  onContentChangeImmediate?: (tabId: string, content: string) => void;
  nodeRuntimeOperationInProgress?: boolean;
}

const getLanguage = (filename: string): string => {
  const ext = filename.toLowerCase();
  if (ext.endsWith('.tsx') || ext.endsWith('.ts')) return 'javascript';
  if (ext.endsWith('.jsx') || ext.endsWith('.js')) return 'javascript';
  if (ext.endsWith('.json')) return 'json';
  if (ext.endsWith('.md') || ext.endsWith('.markdown')) return 'markdown';
  if (ext.endsWith('.html') || ext.endsWith('.htm')) return 'html';
  if (ext.endsWith('.css')) return 'css';
  if (ext.endsWith('.scss') || ext.endsWith('.sass')) return 'scss';
  if (ext.endsWith('.py')) return 'python';
  if (ext.endsWith('.java')) return 'java';
  if (ext.endsWith('.cpp') || ext.endsWith('.c')) return 'cpp';
  if (ext.endsWith('.xml')) return 'xml';
  if (ext.endsWith('.yaml') || ext.endsWith('.yml')) return 'yaml';
  if (ext.endsWith('.sql')) return 'sql';
  return 'plaintext';
};

export default function CodeEditor({
  activeTab,
  bottomPanelHeight,
  isBottomPanelVisible,
  onContentChange,
  onContentChangeImmediate,
  nodeRuntimeOperationInProgress = false
}: CodeEditorProps) {
  const { colors } = useTheme();
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 文字数カウント用 state
  const [charCount, setCharCount] = useState(0);
  const [selectionCount, setSelectionCount] = useState<number | null>(null);

  const editorHeight = isBottomPanelVisible 
    ? `calc(100vh - 40px - ${bottomPanelHeight}px)` 
    : 'calc(100vh - 40px)';

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
    }, 1000); // 1秒後に保存
  }, [onContentChange, nodeRuntimeOperationInProgress]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const handleEditorDidMount = (editor: monaco.editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    // 初期文字数カウント
    const model = editor.getModel();
    if (model) {
      setCharCount(model.getValue().length);
    }

    // 選択範囲・全体文字数の更新
    const updateCharCount = () => {
      const model = editor.getModel();
      if (model) {
        setCharCount(model.getValue().length);
        const selection = editor.getSelection();
        if (selection && !selection.isEmpty()) {
          const selectedText = model.getValueInRange(selection);
          setSelectionCount(selectedText.length);
        } else {
          setSelectionCount(null);
        }
      }
    };
    editor.onDidChangeModelContent(updateCharCount);
    editor.onDidChangeCursorSelection(updateCharCount);

    // ThemeContextの色でMonaco Editorテーマを定義
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

    // エディターの追加設定
    editor.updateOptions({
      fontSize: 14,
      lineNumbers: 'on',
      roundedSelection: false,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      minimap: { 
        enabled: true,
        maxColumn: 120,
        showSlider: 'always'
      },
      wordWrap: 'on',
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
        comments: false,
        strings: false
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
    });

    // リアルタイム構文チェック設定
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

    // コンパイラオプション
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.CommonJS,
      noEmit: true,
      esModuleInterop: true,
      jsx: monaco.languages.typescript.JsxEmit.React,
      reactNamespace: 'React',
      allowJs: true,
      typeRoots: ['node_modules/@types']
    });

    // ブラケットペアの色分け
    editor.onDidChangeModelContent(() => {
      const model = editor.getModel();
      if (model) {
        const language = model.getLanguageId();
        if (language === 'typescript' || language === 'javascript') {
          // カスタムハイライト処理をここに追加可能
        }
      }
    });
  };

  if (!activeTab) {
    return (
      <div className="flex-1" style={{ height: editorHeight }}>
        <div className="h-full flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <FileText size={48} className="mx-auto mb-4 opacity-50" />
            <p>ファイルを選択してください</p>
          </div>
        </div>
      </div>
    );
  }

  // Welcomeタブの場合は専用コンポーネントで表示
  if (activeTab.id === 'welcome') {
    // README.mdの内容をパースしてプロジェクト名・説明を抽出
    // 例: content = `# プロジェクト名\n\n説明...`
    const lines = activeTab.content.split('\n');
    const projectName = lines[0]?.replace(/^# /, '') || '';
    const description = lines[2] || '';
    return (
      <div className="flex-1" style={{ height: editorHeight }}>
        <WelcomeTab projectName={projectName} description={description} />
      </div>
    );
  }

  console.log('[CodeEditor] Rendering editor for:', activeTab.name);

  // Markdownプレビュータブの場合は専用コンポーネントで表示
  if (activeTab.preview) {
    return (
      <>
        {console.log('[CodeEditor] Rendering Markdown preview for:', activeTab.name)}
        <div className="flex-1" style={{ height: editorHeight }}>
          <MarkdownPreviewTab content={activeTab.content} fileName={activeTab.name} />
        </div>
      </>
    );
  }

  return (
    <div className="flex-1 relative" style={{ height: editorHeight }}>
      <Editor
        height="100%"
        language={getLanguage(activeTab.name)}
        value={activeTab.content}
        onChange={(value) => {
          if (value !== undefined) {
            if (onContentChangeImmediate) {
              onContentChangeImmediate(activeTab.id, value);
            }
            debouncedSave(activeTab.id, value);
            // 文字数カウントも即時更新
            setCharCount(value.length);
            setSelectionCount(null); // 編集時は選択範囲リセット
          }
        }}
        onMount={handleEditorDidMount}
        theme="pyxis-custom"
        loading={
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
              <p className="text-sm">エディターを読み込み中...</p>
            </div>
          </div>
        }
      />
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
          ? `選択範囲: ${selectionCount}文字 / 全体: ${charCount}文字`
          : `全体: ${charCount}文字`}
      </div>
    </div>
  );
}
