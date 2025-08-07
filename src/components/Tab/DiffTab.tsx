import React from 'react';

import { DiffEditor } from '@monaco-editor/react';

export interface DiffTabProps {
  formerFullPath: string;
  formerCommitId: string;
  latterFullPath: string;
  latterCommitId: string;
  formerContent: string;
  latterContent: string;
}

const DiffTab: React.FC<DiffTabProps> = ({
  formerFullPath,
  formerCommitId,
  latterFullPath,
  latterCommitId,
  formerContent,
  latterContent,
}) => {
  // ファイル名やコミットIDの表示
  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 16px', background: '#23272e', color: '#d4d4d4', fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontWeight: 'bold' }}>{formerFullPath}</span>
          <span style={{ marginLeft: 8, color: '#aaa' }}>@{formerCommitId}</span>
        </div>
        <div>
          <span style={{ fontWeight: 'bold' }}>{latterFullPath}</span>
          <span style={{ marginLeft: 8, color: '#aaa' }}>@{latterCommitId}</span>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <DiffEditor
          width="100%"
          height="100%"
          language="plaintext"
          original={formerContent}
          modified={latterContent}
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
  );
};

export default DiffTab;
