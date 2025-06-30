import Editor from '@monaco-editor/react';
import { FileText } from 'lucide-react';
import { Tab } from '../types';

interface CodeEditorProps {
  activeTab: Tab | undefined;
  bottomPanelHeight: number;
  isBottomPanelVisible: boolean;
  onContentChange: (tabId: string, content: string) => void;
}

const getLanguage = (filename: string): string => {
  if (filename.endsWith('.tsx') || filename.endsWith('.ts')) return 'typescript';
  if (filename.endsWith('.json')) return 'json';
  if (filename.endsWith('.md')) return 'markdown';
  return 'plaintext';
};

export default function CodeEditor({
  activeTab,
  bottomPanelHeight,
  isBottomPanelVisible,
  onContentChange
}: CodeEditorProps) {
  const editorHeight = isBottomPanelVisible 
    ? `calc(100vh - 40px - ${bottomPanelHeight}px)` 
    : 'calc(100vh - 40px)';

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

  return (
    <div className="flex-1" style={{ height: editorHeight }}>
      <Editor
        height="100%"
        language={getLanguage(activeTab.name)}
        value={activeTab.content}
        onChange={(value) => value !== undefined && onContentChange(activeTab.id, value)}
        theme="vs-dark"
        options={{
          fontSize: 14,
          lineNumbers: 'on',
          roundedSelection: false,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          minimap: { enabled: true },
          wordWrap: 'on',
          tabSize: 2,
          insertSpaces: true
        }}
      />
    </div>
  );
}
