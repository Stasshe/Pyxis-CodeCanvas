import { oneDark } from '@codemirror/theme-one-dark';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { useEffect, useRef } from 'react';
import { countCharsNoSpaces } from '../../engine/ide/editor/contentInfo';
import { getCMExtensions } from '../../lib/codemirror/extensions';

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
  const {
    tabId,
    fileName,
    content,
    onChange,
    onSelectionChange,
    tabSize,
    insertSpaces,
    fontSize = 14,
    isActive = false,
  } = props;

  // CodeMirror instance ref
  const cmRef = useRef<ReactCodeMirrorRef | null>(null);

  // Apply content changes made outside the editor.
  useEffect(() => {
    if (cmRef.current) {
      const view = cmRef.current.view;
      if (view && view.state.doc.toString() !== content) {
        // Preserve the cursor while replacing the document.
        const transaction = view.state.update({
          changes: { from: 0, to: view.state.doc.length, insert: content },
        });
        view.dispatch(transaction);
      }
    }
  }, [content]);

  // Focus the editor when its tab becomes active and blur it when inactive.
  useEffect(() => {
    if (!cmRef.current?.view) return;

    if (isActive) {
      // Focus after the tab switch has rendered.
      const timeoutId = setTimeout(() => {
        cmRef.current?.view?.focus();
      }, 50);
      return () => clearTimeout(timeoutId);
    }
    // CodeMirror has no blur method, so blur its content element.
    cmRef.current.view.contentDOM?.blur();
  }, [isActive]);

  return (
    <div
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
        onUpdate={vu => {
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
          fontSize,
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
