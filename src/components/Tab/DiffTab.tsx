
import React from 'react';
import { DiffEditor } from '@monaco-editor/react';

export interface SingleFileDiff {
  formerFullPath: string;
  formerCommitId: string;
  latterFullPath: string;
  latterCommitId: string;
  formerContent: string;
  latterContent: string;
}

export interface DiffTabProps {
  diffs: SingleFileDiff[];
}

const DiffTab: React.FC<DiffTabProps> = ({ diffs }) => {
  return (
    <div style={{ height: '100%', width: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      {diffs.length === 0 ? (
        <div style={{ padding: 16, color: '#aaa' }}>差分ファイルがありません</div>
      ) : (
        diffs.map((diff, idx) => (
          <div key={idx} style={{ marginBottom: 24, borderBottom: '1px solid #333' }}>
            <div style={{ padding: '8px 16px', background: '#23272e', color: '#d4d4d4', fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontWeight: 'bold' }}>{diff.formerFullPath}</span>
                <span style={{ marginLeft: 8, color: '#aaa' }}>@{diff.formerCommitId}</span>
              </div>
              <div>
                <span style={{ fontWeight: 'bold' }}>{diff.latterFullPath}</span>
                <span style={{ marginLeft: 8, color: '#aaa' }}>@{diff.latterCommitId}</span>
              </div>
            </div>
            <div style={{ height: 360, minHeight: 0 }}>
              <DiffEditor
                width="100%"
                height="100%"
                language="plaintext"
                original={diff.formerContent}
                modified={diff.latterContent}
                theme="pyxis-custom"
                options={{
                  renderSideBySide: true,
                  readOnly: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 14,
                  wordWrap: 'on',
                  lineNumbers: 'on',
                  automaticLayout: true,
                }}
              />
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default DiffTab;
