// ブレークポイント用のガターアイコンCSSクラス名
const BREAKPOINT_GUTTER_CLASS = 'pyxis-breakpoint-gutter';
const BREAKPOINT_GUTTER_STYLE = `
/* Monaco は glyphMarginClassName に指定したクラスを '.glyph-margin' 要素に直接付与します。
   そのためスペース無し（.glyph-margin.pyxis-breakpoint-gutter）での指定が必要です。加えて
   互換性のためにいくつかのバリエーションを用意します。*/
/* 汎用セレクタ: 構造が異なる場合でもクラス名自体を狙う */
.pyxis-breakpoint-gutter,
.glyph-margin.pyxis-breakpoint-gutter,
.glyph-margin .pyxis-breakpoint-gutter,
.monaco-editor .pyxis-breakpoint-gutter,
.monaco-editor .margin .glyph-margin.pyxis-breakpoint-gutter,
.monaco-editor.vs .margin .glyph-margin.pyxis-breakpoint-gutter,
.monaco-editor.vs-dark .margin .glyph-margin.pyxis-breakpoint-gutter,
/* 互換性: 要素が子要素として挿入されるケースをカバー */
.monaco-editor .margin .glyph-margin .pyxis-breakpoint-gutter,
.monaco-editor.vs .margin .glyph-margin .pyxis-breakpoint-gutter,
.monaco-editor.vs-dark .margin .glyph-margin .pyxis-breakpoint-gutter {
  /* タッチデバイス（iPad など）でもタップしやすいように大きめにする */
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 24px !important;
  height: 24px !important;
  min-width: 24px !important;
  min-height: 24px !important;
  padding: 2px !important;
  position: relative !important;
  z-index: 10000 !important; /* 高めにして上書きを避ける */
  box-sizing: border-box !important;
  /* pointer-events を有効にしてタッチやホバーを受け取れるようにする */
  pointer-events: auto !important;
  touch-action: manipulation !important;
  -webkit-tap-highlight-color: rgba(0,0,0,0) !important;
  overflow: visible !important;
}

/* アイコン本体は擬似要素に描画（クリック判定は親要素で行う） */
.pyxis-breakpoint-gutter::after,
.monaco-editor .margin .glyph-margin.pyxis-breakpoint-gutter::after,
.monaco-editor.vs .margin .glyph-margin.pyxis-breakpoint-gutter::after,
.monaco-editor.vs-dark .margin .glyph-margin.pyxis-breakpoint-gutter::after,
.monaco-editor .margin .glyph-margin .pyxis-breakpoint-gutter::after,
.monaco-editor.vs .margin .glyph-margin .pyxis-breakpoint-gutter::after,
.monaco-editor.vs-dark .margin .glyph-margin .pyxis-breakpoint-gutter::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 12px !important;
  height: 12px !important;
  border-radius: 50% !important;
  background: #e06c75 !important; /* 赤系の円 */
  border: 2px solid rgba(255,255,255,0.95) !important;
  box-sizing: border-box !important;
  z-index: 10001 !important;
  pointer-events: none !important; /* アイコン自体はクリックを邪魔しない */
}


/* タッチ操作向けヒット領域を控えめに（ガバ防止） */
.pyxis-breakpoint-gutter::before,
.monaco-editor .margin .glyph-margin .${BREAKPOINT_GUTTER_CLASS}::before,
.monaco-editor .glyph-margin.${BREAKPOINT_GUTTER_CLASS}::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 22px; /* 控えめなサイズ */
  height: 22px;
  border-radius: 11px;
  background: transparent;
  z-index: 10002 !important;
  pointer-events: auto !important; /* タッチを受けるために有効 */
}

/* ポインタが粗いデバイス（タッチ）でも控えめなヒット領域 */
@media (pointer: coarse) {
  .monaco-editor .margin .glyph-margin .${BREAKPOINT_GUTTER_CLASS},
  .monaco-editor .glyph-margin.${BREAKPOINT_GUTTER_CLASS},
  .pyxis-breakpoint-gutter {
    width: 26px !important;
    height: 26px !important;
    min-width: 26px !important;
    min-height: 26px !important;
  }
  .monaco-editor .margin .glyph-margin .${BREAKPOINT_GUTTER_CLASS}::before,
  .monaco-editor .glyph-margin.${BREAKPOINT_GUTTER_CLASS}::before,
  .pyxis-breakpoint-gutter::before {
    width: 28px !important;
    height: 28px !important;
    border-radius: 14px !important;
  }
}
`;

// ブレークポイント管理用型
type Breakpoint = { line: number };
import { useRef, useEffect, useCallback, useState, useContext, useMemo } from 'react';
import { useBreakpointContext } from '@/context/BreakpointContext';
import { useTheme } from '@/context/ThemeContext';
import MarkdownPreviewTab from './MarkdownPreviewTab';
import WelcomeTab from './WelcomeTab';
import BinaryTabContent from './BinaryTabContent';
import Editor, { Monaco, OnMount } from '@monaco-editor/react';
import { FileText } from 'lucide-react';
import { Tab } from '@/types';
import { isBufferArray } from '@/engine/helper/isBufferArray';
import CharCountDetails from './CharCountDetails';
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
import {
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  lineNumbers,
} from '@codemirror/view';
import { keymap } from '@codemirror/view';
import { history } from '@codemirror/commands';
// 編集支援
import { autocompletion } from '@codemirror/autocomplete';
// 検索機能
import { searchKeymap } from '@codemirror/search';
// キーマップ（基本操作）
import { defaultKeymap, historyKeymap } from '@codemirror/commands';
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
  if (
    ext.endsWith('.cpp') ||
    ext.endsWith('.cc') ||
    ext.endsWith('.cxx') ||
    ext.endsWith('.hpp') ||
    ext.endsWith('.hxx')
  )
    return 'cpp';
  if (ext.endsWith('.c') || ext.endsWith('.h')) return 'c';
  if (ext.endsWith('.cs')) return 'csharp';
  if (ext.endsWith('.xml') || ext.endsWith('.xsd') || ext.endsWith('.xslt') || ext.endsWith('.xsl'))
    return 'xml';
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
  if (ext.endsWith('.f90') || ext.endsWith('.f95') || ext.endsWith('.for') || ext.endsWith('.f'))
    return 'fortran';
  if (ext.endsWith('.ada')) return 'ada';
  if (ext.endsWith('.dart')) return 'dart';
  if (ext.endsWith('.tsv') || ext.endsWith('.csv')) return 'plaintext';
  return 'plaintext';
};

const getCMExtensions = (filename: string) => {
  const ext = filename.toLowerCase();
  let lang: any[] = [];
  if (
    ext.endsWith('.js') ||
    ext.endsWith('.jsx') ||
    ext.endsWith('.mjs') ||
    ext.endsWith('.ts') ||
    ext.endsWith('.tsx')
  )
    lang = [javascript()];
  else if (ext.endsWith('.md') || ext.endsWith('.markdown')) lang = [markdown()];
  else if (ext.endsWith('.xml')) lang = [xml()];
  else if (ext.endsWith('.css')) lang = [css()];
  else if (ext.endsWith('.py')) lang = [python()];
  else if (ext.endsWith('.yaml') || ext.endsWith('.yml')) lang = [yaml()];
  else if (ext.endsWith('.html') || ext.endsWith('.htm') || ext.endsWith('.xhtml')) lang = [html()];
  // shellは拡張なし
  return [
    keymap.of([...defaultKeymap, ...historyKeymap, ...defaultKeymap, ...searchKeymap]),
    history(),
    autocompletion(),
    lineNumbers(),
    oneDark,
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    highlightSelectionMatches(),
    ...lang,
  ];
};

export default function CodeEditor({
  activeTab,
  onContentChange,
  onContentChangeImmediate,
  nodeRuntimeOperationInProgress = false,
  isCodeMirror = false,
  currentProjectName,
  projectFiles,
  wordWrapConfig,
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
  // ポップアップ表示状態
  const [showCharCountPopup, setShowCharCountPopup] = useState(false);
  // 文字数カウント（スペース除外）
  const countCharsNoSpaces = (text: string) => text.replace(/\s/g, '').length;

  // 親のflex-1 + min-h-0で高さ制御するため、height: '100%'に統一
  const editorHeight = '100%';

  // デバウンス付きの保存関数
  const debouncedSave = useCallback(
    (tabId: string, content: string) => {
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
    },
    [onContentChange, nodeRuntimeOperationInProgress]
  );

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
    return editorRef.current && !(editorRef.current as any)._isDisposed && isMountedRef.current;
  }, []);

  const isModelSafe = useCallback((model: monaco.editor.ITextModel | null | undefined) => {
    return model && typeof model.isDisposed === 'function' && !model.isDisposed();
  }, []);

  useEffect(() => {
    if (!activeTab || !isCodeMirror) return;
    if (
      isBufferArray((activeTab as any).bufferContent) ||
      activeTab.id === 'welcome' ||
      activeTab.preview
    ) {
      return;
    }
    setCharCount(countCharsNoSpaces(activeTab.content || ''));
    setSelectionCount(null);
  }, [isCodeMirror, activeTab?.id, activeTab?.content]);

  // SSR対策: クライアントのみでガターCSSを注入
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let style = document.getElementById('pyxis-breakpoint-gutter-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'pyxis-breakpoint-gutter-style';
      style.innerHTML = BREAKPOINT_GUTTER_STYLE;
      document.head.appendChild(style);
    } else {
      style.innerHTML = BREAKPOINT_GUTTER_STYLE;
    }
  }, []);

  // --- ブレークポイント機能 ---
  // ブレークポイントはContextで管理する
  const { breakpointsMap, setBreakpointsMap } = useBreakpointContext();
  // デコレーションIDはレンダリングに影響させたくないためrefで管理
  const decorationsMapRef = useRef<Record<string, string[]>>({});

  // 指定行のトグル（現在のモデル or activeTab に紐づける）
  const toggleBreakpoint = useCallback((line: number) => {
    const tabId = currentModelIdRef.current || (activeTab && activeTab.id);
    if (!tabId) return;
    setBreakpointsMap(prev => {
      const prevLines = new Set(prev[tabId] || []);
      if (prevLines.has(line)) {
        prevLines.delete(line);
      } else {
        prevLines.add(line);
      }
      return { ...prev, [tabId]: Array.from(prevLines).sort((a, b) => a - b) };
    });
  }, [activeTab?.id]);

  // タブごとにデコレーションを更新する
  const updateBreakpointDecorations = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (!editorRef.current) return;
    const mon = monacoRef.current;
    if (!mon) return;
    const model = editorRef.current.getModel && editorRef.current.getModel();
    if (!model) return;

    const tabId = currentModelIdRef.current || (activeTab && activeTab.id);
    if (!tabId) return;

    const lines = breakpointsMap[tabId] || [];
    const prevIds = decorationsMapRef.current[tabId] || [];

    if (!lines || lines.length === 0) {
      // 既存のデコレーションを削除
      try {
        if (prevIds && prevIds.length > 0 && editorRef.current) {
          const removed = editorRef.current.deltaDecorations(prevIds, []);
          decorationsMapRef.current[tabId] = [];
          console.debug('[CodeEditor] Cleared decorations for', tabId, 'removed:', removed);
        }
      } catch (e) {
        console.warn('[CodeEditor] Failed to clear decorations for tab', tabId, e);
      }
      return;
    }

    const decorations = lines.map(line => ({
      range: new mon.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        glyphMarginClassName: BREAKPOINT_GUTTER_CLASS,
        glyphMarginHoverMessage: { value: 'ブレークポイント' },
        stickiness:
          mon.editor.TrackedRangeStickiness &&
          mon.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    }));

    try {
      const newIds = editorRef.current.deltaDecorations(prevIds, decorations);
      decorationsMapRef.current[tabId] = newIds;
      console.debug('[CodeEditor] Applied decorations for', tabId, 'ids:', newIds);
    } catch (e) {
      console.warn('[CodeEditor] Failed to apply decorations for tab', tabId, e);
    }
  }, [breakpointsMap, activeTab?.id]);

  // ガタークリック（タップ）処理を強化
  const handleEditorGutterClick = useCallback((e: any) => {
    if (typeof window === 'undefined') return;
    const monaco = monacoRef.current;
    if (!monaco) return;

    // いくつかのバージョンでのType定数を取得
    const GUTTER_GLYPH_MARGIN = monaco.editor.MouseTargetType?.GUTTER_GLYPH_MARGIN ?? 2;
    const GUTTER_LINE_NUMBERS = monaco.editor.MouseTargetType?.GUTTER_LINE_NUMBERS ?? 3;

    // 基本的にGUTTER_GLYPH_MARGINを期待するが、ライン番号や近接エリアでタップされる場合もあるため
    const clickedType = e?.target?.type;

    // デバッグ: ターゲットの情報をログに出す
    // eslint-disable-next-line no-console
    console.debug('[CodeEditor] onMouseDown target type:', clickedType, 'position:', e?.target?.position, 'browserEvent:', e?.event?.browserEvent?.type);

    let lineNumber: number | undefined;

    // 優先: 明示的に報告された行番号
    if (e.target?.position?.lineNumber) {
      lineNumber = e.target.position.lineNumber;
    }

    // 代替: 要素走査でglyph-margin内かどうか判断
    if (!lineNumber && e.target && (e.target.element || e.target.detail)) {
      const el = e.target.element || e.target.detail?.target || null;
      try {
        if (el && typeof (el as Element).closest === 'function') {
          const glyph = (el as Element).closest('.glyph-margin');
          if (glyph) {
            // 行番号情報はDOM属性に含まれる場合がある
            const lineAttr = glyph.getAttribute && glyph.getAttribute('data-line-number');
            if (lineAttr) {
              const parsed = parseInt(lineAttr, 10);
              if (!Number.isNaN(parsed)) lineNumber = parsed;
            }
          }
        }
      } catch (er) {
        // ignore
      }
    }

    // 最終手段: MouseTargetTypeが該当するならpositionから取得
    if (!lineNumber && (clickedType === GUTTER_GLYPH_MARGIN || clickedType === GUTTER_LINE_NUMBERS)) {
      lineNumber = e.target?.position?.lineNumber;
    }

    if (lineNumber) {
      toggleBreakpoint(lineNumber);
      console.debug('[CodeEditor] Toggled breakpoint at line:', lineNumber);
    }
  }, [toggleBreakpoint]);

  // Monaco Editor: ファイルごとにTextModelを管理し、タブ切り替え時にモデルを切り替える
  const handleEditorDidMount: OnMount = (editor, monaco) => {
    if (typeof window !== 'undefined') {
      // ガタークリックイベント登録
      editor.onMouseDown(handleEditorGutterClick);
    }
    editorRef.current = editor;
    monacoRef.current = monaco;

    // テーマ定義（初回のみ）
    try {
      Promise.all([
        fetch('https://unpkg.com/@types/react/index.d.ts').then(r => r.text()),
        fetch('https://unpkg.com/@types/react-dom/index.d.ts').then(r => r.text()),
      ])
        .then(([reactTypes, reactDomTypes]) => {
          monaco.languages.typescript.typescriptDefaults.addExtraLib(
            reactTypes,
            'file:///node_modules/@types/react/index.d.ts'
          );
          monaco.languages.typescript.typescriptDefaults.addExtraLib(
            reactDomTypes,
            'file:///node_modules/@types/react-dom/index.d.ts'
          );
        })
        .catch(e => {
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
        },
      });
      monaco.editor.setTheme('pyxis-custom');
    } catch (e) {
      // テーマが既に定義されている場合は無視
      console.warn('[CodeEditor] Theme already defined:', e);
    }

    // エディター初期化直後に現在のブレークポイントを反映する
    try {
      // 少し遅延させることでモデルのセットが完了しているケースにも対応
      setTimeout(() => {
        try {
          updateBreakpointDecorations();
        } catch (err) {
          console.warn('[CodeEditor] Failed to apply breakpoint decorations on mount:', err);
        }
      }, 10);
    } catch (err) {
      console.warn('[CodeEditor] Error scheduling breakpoint decoration update on mount:', err);
    }

    // TypeScript/JavaScript設定
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: false,
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: false,
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
        setSelectionCount(null);
      } else {
        setSelectionCount(length);
      }
    });

    // 初期モデルを設定（activeTabがある場合）
    if (
      activeTab &&
      !isBufferArray((activeTab as any).bufferContent) &&
      activeTab.id !== 'welcome' &&
      !activeTab.preview &&
      !isCodeMirror
    ) {
      const monacoModelMap = monacoModelMapRef.current;
      let model = monacoModelMap.get(activeTab.id);

      if (!isModelSafe(model)) {
        // 既存のモデルが破棄されている場合は削除
        if (model) {
          monacoModelMap.delete(activeTab.id);
        }

        model = monaco.editor.createModel(activeTab.content, getLanguage(activeTab.name));
        monacoModelMap.set(activeTab.id, model);
        // ブレークポイントデコレーション初期化（タブ単位で管理）
        try {
          const tabIdInit = activeTab.id;
          // 明示的に空配列で初期化
          setBreakpointsMap(prev => ({ ...prev, [tabIdInit]: [] }));
          // 既存のデコレーションが残っていれば削除する
          const prevIdsInit = decorationsMapRef.current[tabIdInit] || [];
          if (prevIdsInit.length > 0 && editorRef.current) {
            try {
              editorRef.current.deltaDecorations(prevIdsInit, []);
            } catch (e) {
              console.warn('[CodeEditor] Failed to clear previous decorations on init for', tabIdInit, e);
            }
          }
          decorationsMapRef.current[tabIdInit] = [];
        } catch (e) {
          console.warn('[CodeEditor] Failed to initialize breakpoint state for tab:', activeTab.id, e);
        }
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
              // モデル切り替え時にタブ単位のデコレーション／ブレークポイントを初期化
              try {
                const tabToClear = activeTab.id;
                setBreakpointsMap(prev => ({ ...prev, [tabToClear]: [] }));
                const prevIds = decorationsMapRef.current[tabToClear] || [];
                if (prevIds.length > 0 && editorRef.current) {
                  try {
                    editorRef.current.deltaDecorations(prevIds, []);
                  } catch (clearErr) {
                    console.warn('[CodeEditor] Failed to clear decorations during model dispose for', tabToClear, clearErr);
                  }
                }
                decorationsMapRef.current[tabToClear] = [];
              } catch (initErr) {
                console.warn('[CodeEditor] Failed to reset breakpoint state during model dispose:', initErr);
              }
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
            setCharCount(countCharsNoSpaces(activeTab.content));
          } catch (retryError) {
            console.error('[CodeEditor] Model creation retry failed:', retryError);
          }
        }
      }
    }
  };

  // ブレークポイント配列や表示タブが変わったらデコレーションを更新する
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Editor がまだない場合は何もしない
    if (!isEditorSafe() || !monacoRef.current) return;
    try {
      updateBreakpointDecorations();
    } catch (e) {
      console.warn('[CodeEditor] Failed to update breakpoint decorations in effect:', e);
    }
    // activeTab.id を依存に入れることでモデル切替時にもデコレーションを再適用する
  }, [breakpointsMap, activeTab?.id, isEditorSafe]);

  // activeTabが変わるたびにモデルを切り替え、必要ならジャンプ
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


    let didSetModel = false;
    // --- 1. モデルがなければ新規作成 ---
    if (!model) {
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
      if (!isEditorSafe()) return;
      // --- 2. setModel前に古いデコレーションを必ずクリア ---
      try {
        const prevIds = decorationsMapRef.current[activeTab.id] || [];
        if (prevIds.length > 0 && editorRef.current) {
          editorRef.current.deltaDecorations(prevIds, []);
        }
        decorationsMapRef.current[activeTab.id] = [];
      } catch (e) {
        console.warn('[CodeEditor] Failed to clear decorations before setModel (new model):', e);
      }
      try {
        editorRef.current!.setModel(model);
        currentModelIdRef.current = activeTab.id;
        setCharCount(countCharsNoSpaces(model.getValue()));
        didSetModel = true;
        // --- 3. setModel後にデコレーション再適用 ---
        updateBreakpointDecorations();
      } catch (e: any) {
        console.warn('[CodeEditor] setModel failed:', e?.message);
        setTimeout(() => {
          if (isEditorSafe() && isModelSafe(model) && model) {
            try {
              editorRef.current!.setModel(model);
              currentModelIdRef.current = activeTab.id;
              setCharCount(model.getValue().length);
              updateBreakpointDecorations();
            } catch (retryError: any) {
              console.error('[CodeEditor] setModel retry failed:', retryError);
            }
          }
        }, 50);
      }
    } else {
      // --- 既存モデル ---
      // 1. モデル切り替え時は必ず古いデコレーションをクリア
      if (currentModelIdRef.current !== activeTab.id) {
        if (!isEditorSafe()) return;
        try {
          const prevIds = decorationsMapRef.current[currentModelIdRef.current || ''] || [];
          if (prevIds.length > 0 && editorRef.current) {
            editorRef.current.deltaDecorations(prevIds, []);
          }
          decorationsMapRef.current[currentModelIdRef.current || ''] = [];
        } catch (e) {
          console.warn('[CodeEditor] Failed to clear decorations before setModel (existing model):', e);
        }
        try {
          editorRef.current!.setModel(model);
          currentModelIdRef.current = activeTab.id;
          didSetModel = true;
          setCharCount(countCharsNoSpaces(model.getValue()));
          // --- 2. setModel後にデコレーション再適用 ---
          updateBreakpointDecorations();
        } catch (e: any) {
          console.warn('[CodeEditor] setModel for existing model failed:', e?.message);
          monacoModelMap.delete(activeTab.id);
          try {
            model.dispose();
          } catch (disposeError) {
            console.warn('[CodeEditor] Failed to dispose broken model:', disposeError);
          }
          try {
            const newModel = monacoRef.current!.editor.createModel(
              activeTab.content,
              getLanguage(activeTab.name)
            );
            monacoModelMap.set(activeTab.id, newModel);
            // --- setModel前にデコレーションクリア ---
            try {
              const prevIds = decorationsMapRef.current[activeTab.id] || [];
              if (prevIds.length > 0 && editorRef.current) {
                editorRef.current.deltaDecorations(prevIds, []);
              }
              decorationsMapRef.current[activeTab.id] = [];
            } catch (e) {}
            editorRef.current!.setModel(newModel);
            currentModelIdRef.current = activeTab.id;
            setCharCount(newModel.getValue().length);
            didSetModel = true;
            updateBreakpointDecorations();
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
          // --- 内容更新時もデコレーション再適用 ---
          updateBreakpointDecorations();
        } catch (e: any) {
          console.warn('[CodeEditor] Model setValue failed:', e?.message);
          monacoModelMap.delete(activeTab.id);
          return;
        }
      }
      if (isModelSafe(model)) {
        setCharCount(countCharsNoSpaces(model!.getValue()));
      }
    }

    // --- JUMP TO LINE/COLUMN ---
    // ここでactiveTab.jumpToLine/jumpToColumnがあればジャンプ
    if (
      isEditorSafe() &&
      (activeTab as any).jumpToLine !== undefined &&
      typeof (activeTab as any).jumpToLine === 'number'
    ) {
      const jumpToLine = (activeTab as any).jumpToLine;
      const jumpToColumn = (activeTab as any).jumpToColumn || 1;
      try {
        // MonacoのエディタAPIでジャンプ
        const editor = editorRef.current!;
        editor.revealPositionInCenter({ lineNumber: jumpToLine, column: jumpToColumn });
        editor.setPosition({ lineNumber: jumpToLine, column: jumpToColumn });
        editor.focus();
        console.log('[CodeEditor] JUMP: line', jumpToLine, 'col', jumpToColumn, 'tab', activeTab.id);
      } catch (e) {
        console.warn('[CodeEditor] Failed to jump to line/column:', e);
      }
    } else {
      if ((activeTab as any).jumpToLine !== undefined) {
        console.log('[CodeEditor] jumpToLine present but editor not ready or not a number:', (activeTab as any).jumpToLine);
      }
    }
  }, [activeTab?.id, isCodeMirror, isEditorSafe, isModelSafe]);

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
        setCharCount(countCharsNoSpaces(activeTab.content));
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
            setCharCount(countCharsNoSpaces(activeTab.content));
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
      <div
        className="flex-1 min-h-0 select-none"
        style={{ height: editorHeight }}
      >
        <div className="h-full flex items-center justify-center text-muted-foreground select-none">
          <div className="text-center select-none">
            <FileText
              size={48}
              className="mx-auto mb-4 opacity-50"
            />
            <p className="select-none">ファイルを選択してください</p>
          </div>
        </div>
      </div>
    );
  }

  // needsContentRestoreがtrueならローディング表示
  if (activeTab.needsContentRestore) {
    return (
      <div
        className="flex-1 min-h-0 select-none"
        style={{ height: editorHeight }}
      >
        <div className="h-full flex items-center justify-center text-muted-foreground select-none">
          <div className="text-center select-none">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
            <p className="select-none">ファイル内容を復元中...</p>
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
      <div
        className="flex-1 min-h-0"
        style={{ height: editorHeight }}
      >
        <WelcomeTab />
      </div>
    );
  }

  if (activeTab.preview) {
    return (
      <>
        {console.log('[CodeEditor] Rendering Markdown preview for:', activeTab.name)}
        <div
          className="flex-1 min-h-0"
          style={{ height: editorHeight }}
        >
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
    <div
      className="flex-1 min-h-0 relative"
      style={{ height: editorHeight }}
    >
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
            basicSetup={false}
            onChange={value => {
              onContentChangeImmediate?.(activeTab.id, value);
              debouncedSave(activeTab.id, value);
              setCharCount(countCharsNoSpaces(value));
              setSelectionCount(null);
            }}
            // これを追加：選択範囲の文字数（スペース除外）
            onUpdate={(vu: any) => {
              const sel = vu.state.selection.main;
              if (sel.empty) {
                setSelectionCount(null);
              } else {
                const text = vu.state.sliceDoc(sel.from, sel.to);
                setSelectionCount(countCharsNoSpaces(text));
              }
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
          onChange={value => {
            if (value !== undefined && activeTab) {
              try {
                // ユーザーの変更は絶対に反映する
                if (onContentChangeImmediate) {
                  onContentChangeImmediate(activeTab.id, value);
                }
                debouncedSave(activeTab.id, value);
                setCharCount(countCharsNoSpaces(value));
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
              showSlider: 'always',
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
            glyphMargin: true, // ← これを追加: ガターのマージン有効化
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
      {/* 文字数カウント表示バー（クリックでポップアップ展開） */}
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
          cursor: 'pointer',
          userSelect: 'none',
          boxShadow: showCharCountPopup ? '0 2px 8px rgba(0,0,0,0.25)' : undefined,
        }}
        onClick={() => setShowCharCountPopup(v => !v)}
        title="クリックで詳細表示"
      >
        {selectionCount !== null
          ? `選択範囲: ${selectionCount}文字（スペース除外）/ 全体: ${charCount}文字（スペース除外）`
          : `全体: ${charCount}文字（スペース除外）`}
      </div>
      {showCharCountPopup && (
        <div
          style={{
            position: 'absolute',
            right: 12,
            bottom: 40,
            zIndex: 20,
            background: 'rgba(30,30,30,0.98)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
            padding: '12px 18px',
            minWidth: 180,
            maxWidth: 320,
          }}
          onClick={e => e.stopPropagation()}
        >
          <CharCountDetails content={activeTab.content || ''} />
          <div style={{ textAlign: 'right', marginTop: 8 }}>
            <button
              style={{
                background: '#444',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '2px 10px',
                cursor: 'pointer',
                fontSize: 12,
              }}
              onClick={() => setShowCharCountPopup(false)}
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
