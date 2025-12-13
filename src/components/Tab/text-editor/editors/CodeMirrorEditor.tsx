import { oneDark } from '@codemirror/theme-one-dark';
import CodeMirror from '@uiw/react-codemirror';
import { useRef, useEffect } from 'react';

import { getCMExtensions } from './codemirror-utils';
import { countCharsNoSpaces } from './editor-utils';

interface CodeMirrorEditorProps {
  tabId: string;
  fileName: string;
  content: string;
  onChange: (value: string) => void;
  onSelectionChange: (count: number | null) => void;
  tabSize: number;
  insertSpaces: boolean;
  fontSize?: number;
  isActive?: boolean;
}

export default function CodeMirrorEditor(props: CodeMirrorEditorProps) {
  const { tabId, fileName, content, onChange, onSelectionChange, tabSize, insertSpaces, fontSize = 14, isActive = false } = props;

  // CodeMirrorインスタンスのref
  const cmRef = useRef<any>(null);

  // contentの外部変更を強制反映
  useEffect(() => {
    if (cmRef.current) {
      const view = cmRef.current.view;
      if (view && view.state.doc.toString() !== content) {
        // カーソル位置を維持しつつ内容を更新
        const transaction = view.state.update({
          changes: { from: 0, to: view.state.doc.length, insert: content },
        });
        view.dispatch(transaction);
      }
    }
  }, [content]);

  // タブがアクティブになった時にエディタにフォーカスを当てる
  // タブが非アクティブになった時にフォーカスを外す
  useEffect(() => {
    if (!cmRef.current) return;
    
    if (isActive) {
      // アクティブになったらフォーカスを当てる
      const timeoutId = setTimeout(() => {
        cmRef.current?.view?.focus();
      }, 50);
      return () => clearTimeout(timeoutId);
    } else {
      // 非アクティブになったらフォーカスを外す
      if (cmRef.current.view && cmRef.current.view.hasFocus) {
        // CodeMirrorにはblurメソッドがないため、DOM要素からフォーカスを外す
        cmRef.current.view.contentDOM?.blur();
      }
    }
  }, [isActive]);

  return (
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
        key={tabId}
        ref={cmRef}
        value={content}
        height="100%"
        theme={oneDark}
        extensions={getCMExtensions(fileName, tabSize, insertSpaces)}
        basicSetup={false}
        onChange={onChange}
        onUpdate={(vu: any) => {
          const sel = vu.state.selection.main;
          if (sel.empty) {
            onSelectionChange(null);
          } else {
            const text = vu.state.sliceDoc(sel.from, sel.to);
            onSelectionChange(countCharsNoSpaces(text));
          }
        }}
        style={{
          height: '100%',
          minHeight: '100%',
          width: '100%',
          fontSize: typeof fontSize === 'number' ? `${fontSize}px` : fontSize,
          userSelect: 'text',
          WebkitUserSelect: 'text',
          msUserSelect: 'text',
          MozUserSelect: 'text',
          touchAction: 'auto',
          WebkitTapHighlightColor: 'transparent',
        }}
      />
    </div>
  );
}
