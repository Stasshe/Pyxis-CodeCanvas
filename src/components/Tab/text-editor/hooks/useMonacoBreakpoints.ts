import { useRef, useState, useCallback, useEffect } from 'react';
import * as monaco from 'monaco-editor';
import type { Monaco } from '@monaco-editor/react';
import { useBreakpointContext } from '@/context/BreakpointContext';

export const BREAKPOINT_GUTTER_CLASS = 'pyxis-breakpoint-gutter';

export const BREAKPOINT_GUTTER_STYLE = `
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
    const model = editorRef.current.getModel && editorRef.current.getModel();
    if (!model) return;

    const tabId = currentModelId || activeTabId;
    if (!tabId) return;

    const lines = breakpointsMap[tabId] || [];
    const prevIds = decorationsMapRef.current[tabId] || [];

    if (!lines || lines.length === 0) {
      try {
        if (prevIds && prevIds.length > 0 && editorRef.current) {
          editorRef.current.deltaDecorations(prevIds, []);
          decorationsMapRef.current[tabId] = [];
          console.debug('[useMonacoBreakpoints] Cleared decorations for', tabId);
        }
      } catch (e) {
        console.warn('[useMonacoBreakpoints] Failed to clear decorations for tab', tabId, e);
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
      console.debug('[useMonacoBreakpoints] Applied decorations for', tabId, 'ids:', newIds);
    } catch (e) {
      console.warn('[useMonacoBreakpoints] Failed to apply decorations for tab', tabId, e);
    }
  }, [breakpointsMap, currentModelId, activeTabId, editorRef, monacoRef]);

  const handleEditorGutterClick = useCallback(
    (e: any) => {
      if (typeof window === 'undefined') return;
      const mon = monacoRef.current;
      if (!mon) return;

      const GUTTER_GLYPH_MARGIN = mon.editor.MouseTargetType?.GUTTER_GLYPH_MARGIN ?? 2;
      const GUTTER_LINE_NUMBERS = mon.editor.MouseTargetType?.GUTTER_LINE_NUMBERS ?? 3;

      const clickedType = e?.target?.type;

      console.debug(
        '[useMonacoBreakpoints] onMouseDown target type:',
        clickedType,
        'position:',
        e?.target?.position,
        'browserEvent:',
        e?.event?.browserEvent?.type
      );

      let lineNumber: number | undefined;

      if (e.target?.position?.lineNumber) {
        lineNumber = e.target.position.lineNumber;
      }

      if (!lineNumber && e.target && (e.target.element || e.target.detail)) {
        const el = e.target.element || e.target.detail?.target || null;
        try {
          if (el && typeof (el as Element).closest === 'function') {
            const glyph = (el as Element).closest('.glyph-margin');
            if (glyph) {
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

      if (
        !lineNumber &&
        (clickedType === GUTTER_GLYPH_MARGIN || clickedType === GUTTER_LINE_NUMBERS)
      ) {
        lineNumber = e.target?.position?.lineNumber;
      }

      if (lineNumber) {
        toggleBreakpoint(lineNumber);
        console.debug('[useMonacoBreakpoints] Toggled breakpoint at line:', lineNumber);
      }
    },
    [toggleBreakpoint, monacoRef]
  );

  return {
    breakpointsMap,
    decorationsMapRef,
    toggleBreakpoint,
    updateBreakpointDecorations,
    handleEditorGutterClick,
  };
}
