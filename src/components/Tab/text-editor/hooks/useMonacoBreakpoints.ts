import type { Monaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useRef, useCallback, useEffect } from 'react';

import { useBreakpointContext } from '@/context/BreakpointContext';

export const BREAKPOINT_GUTTER_CLASS = 'pyxis-breakpoint-gutter';

export const BREAKPOINT_GUTTER_STYLE = `
/* Monaco Editorのブレークポイント表示用スタイル
 * glyphMarginClassNameで指定されたクラスは.cgmr(codicon-glyph-margin-right)配下に配置される
 */
.monaco-editor .margin-view-overlays .cgmr.codicon.${BREAKPOINT_GUTTER_CLASS}::before {
  content: "" !important;
  display: block !important;
  width: 16px !important;
  height: 16px !important;
  border-radius: 50% !important;
  background-color: #e51400 !important;
  border: 1px solid rgba(255, 255, 255, 0.8) !important;
  position: absolute !important;
  left: 50% !important;
  top: 50% !important;
  transform: translate(-50%, -50%) !important;
  z-index: 5 !important;
}

/* ホバー時の視覚的フィードバック */
.monaco-editor .margin-view-overlays .cgmr.codicon.${BREAKPOINT_GUTTER_CLASS}:hover::before {
  background-color: #ff1a00 !important;
  box-shadow: 0 0 4px rgba(229, 20, 0, 0.6) !important;
}

/* グリフマージン全体のスタイル調整 */
.monaco-editor .margin-view-overlays .cgmr.codicon.${BREAKPOINT_GUTTER_CLASS} {
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  /* タッチデバイス対応 */
  touch-action: manipulation !important;
  -webkit-tap-highlight-color: transparent !important;
  user-select: none !important;
  -webkit-user-select: none !important;
}

/* タッチデバイス（iPad等）用のタップ領域拡大 */
@media (pointer: coarse) {
  .monaco-editor .margin-view-overlays .cgmr.codicon.${BREAKPOINT_GUTTER_CLASS}::before {
    width: 20px !important;
    height: 20px !important;
  }
  
  /* タップしやすいように擬似的な大きなヒット領域を作成 */
  .monaco-editor .margin-view-overlays .cgmr.codicon.${BREAKPOINT_GUTTER_CLASS}::after {
    content: "" !important;
    position: absolute !important;
    left: 50% !important;
    top: 50% !important;
    transform: translate(-50%, -50%) !important;
    width: 44px !important;  /* Appleのガイドライン: 最小44x44px */
    height: 44px !important;
    background: transparent !important;
    z-index: 6 !important;
  }
}

/* タッチデバイスでのアクティブ（タップ）状態の視覚的フィードバック */
@media (pointer: coarse) {
  .monaco-editor .margin-view-overlays .cgmr.codicon.${BREAKPOINT_GUTTER_CLASS}:active::before {
    background-color: #ff3d00 !important;
    box-shadow: 0 0 6px rgba(255, 61, 0, 0.8) !important;
    transform: translate(-50%, -50%) scale(1.1) !important;
    transition: all 0.1s ease !important;
  }
}
`;

/**
 * Monaco Editor用のブレークポイント管理フック
 */
export function useMonacoBreakpoints(
  editorRef: React.RefObject<monaco.editor.IStandaloneCodeEditor | null>,
  monacoRef: React.RefObject<Monaco | null>,
  currentModelId: string | null,
  activeTabId?: string
) {
  const { breakpointsMap, setBreakpointsMap } = useBreakpointContext();
  const decorationsMapRef = useRef<Record<string, string[]>>({});

  // SSR対策: クライアントのみでガターCSSを注入（一度だけ）
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const styleId = 'pyxis-breakpoint-gutter-style';
    let style = document.getElementById(styleId);

    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      style.textContent = BREAKPOINT_GUTTER_STYLE;
      document.head.appendChild(style);
      console.debug('[useMonacoBreakpoints] Injected breakpoint styles');
    }
  }, []);

  const toggleBreakpoint = useCallback(
    (line: number) => {
      const tabId = currentModelId || activeTabId;
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
    },
    [currentModelId, activeTabId, setBreakpointsMap]
  );

  const updateBreakpointDecorations = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (!editorRef.current) return;
    const mon = monacoRef.current;
    if (!mon) return;

    const editor = editorRef.current;
    const model = editor.getModel();
    if (!model || model.isDisposed()) return;

    const tabId = currentModelId || activeTabId;
    if (!tabId) return;

    const lines = breakpointsMap[tabId] || [];
    const prevIds = decorationsMapRef.current[tabId] || [];

    // ブレークポイントがない場合は既存の装飾をクリア
    if (lines.length === 0) {
      if (prevIds.length > 0) {
        try {
          editor.deltaDecorations(prevIds, []);
          decorationsMapRef.current[tabId] = [];
          console.debug('[useMonacoBreakpoints] Cleared decorations for', tabId);
        } catch (e) {
          console.warn('[useMonacoBreakpoints] Failed to clear decorations:', e);
        }
      }
      return;
    }

    // モデルの行数を取得して、範囲外の行番号を除外
    const lineCount = model.getLineCount();
    const validLines = lines.filter(line => line >= 1 && line <= lineCount);

    if (validLines.length === 0) {
      if (prevIds.length > 0) {
        try {
          editor.deltaDecorations(prevIds, []);
          decorationsMapRef.current[tabId] = [];
        } catch (e) {
          console.warn('[useMonacoBreakpoints] Failed to clear invalid decorations:', e);
        }
      }
      return;
    }

    // 装飾を作成
    const decorations = validLines.map(line => ({
      range: new mon.Range(line, 1, line, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: `codicon ${BREAKPOINT_GUTTER_CLASS}`,
        glyphMarginHoverMessage: { value: `ブレークポイント (Line ${line})` },
        stickiness: mon.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    }));

    try {
      const newIds = editor.deltaDecorations(prevIds, decorations);
      decorationsMapRef.current[tabId] = newIds;
      console.debug('[useMonacoBreakpoints] Applied', newIds.length, 'decorations for', tabId);
    } catch (e) {
      console.warn('[useMonacoBreakpoints] Failed to apply decorations:', e);
    }
  }, [breakpointsMap, currentModelId, activeTabId, editorRef, monacoRef]);

  const handleEditorGutterClick = useCallback(
    (e: monaco.editor.IEditorMouseEvent) => {
      if (typeof window === 'undefined') return;
      const mon = monacoRef.current;
      if (!mon) return;

      const GUTTER_GLYPH_MARGIN = mon.editor.MouseTargetType.GUTTER_GLYPH_MARGIN;
      const targetType = e.target.type;

      // グリフマージン（ブレークポイント表示領域）のクリックのみを処理
      if (targetType !== GUTTER_GLYPH_MARGIN) {
        return;
      }

      // タッチデバイスでの誤動作を防ぐため、イベントの伝播を停止
      if (e.event && e.event.browserEvent) {
        e.event.browserEvent.preventDefault();
        e.event.browserEvent.stopPropagation();
      }

      // 行番号を取得
      const lineNumber = e.target.position?.lineNumber;
      if (!lineNumber || lineNumber < 1) {
        console.debug('[useMonacoBreakpoints] Invalid line number:', lineNumber);
        return;
      }

      // エディターのモデルを確認
      const editor = editorRef.current;
      if (!editor) return;

      const model = editor.getModel();
      if (!model || model.isDisposed()) {
        console.warn('[useMonacoBreakpoints] Model is not available');
        return;
      }

      // モデルの行数範囲内かチェック
      const lineCount = model.getLineCount();
      if (lineNumber > lineCount) {
        console.warn(
          '[useMonacoBreakpoints] Line number out of range:',
          lineNumber,
          '/',
          lineCount
        );
        return;
      }

      // ブレークポイントをトグル
      toggleBreakpoint(lineNumber);
      console.debug('[useMonacoBreakpoints] Toggled breakpoint at line:', lineNumber);
    },
    [toggleBreakpoint, monacoRef, editorRef]
  );

  return {
    breakpointsMap,
    decorationsMapRef,
    toggleBreakpoint,
    updateBreakpointDecorations,
    handleEditorGutterClick,
  };
}
