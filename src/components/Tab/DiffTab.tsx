import React, { useRef } from 'react';
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
  // 各diff領域へのref
  const diffRefs = useRef<(HTMLDivElement | null)[]>([]);

  // ファイルリストクリック時に該当diff領域へスクロール
  const handleFileClick = (idx: number) => {
    const ref = diffRefs.current[idx];
    if (ref) {
      ref.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (diffs.length === 0) {
    return <div style={{ padding: 16, color: '#aaa' }}>差分ファイルがありません</div>;
  }

  // allfiles時のみ左側にファイルリスト
  const showFileList = diffs.length > 1;

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'row',
        overflow: 'hidden',
      }}
    >
      {showFileList && (
        <div
          style={{
            width: 120,
            background: '#23272e',
            color: '#d4d4d4',
            borderRight: '1px solid #333',
            padding: '4px 0',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              fontWeight: 'bold',
              fontSize: 11,
              padding: '0 8px 4px 8px',
              borderBottom: '1px solid #333',
              letterSpacing: 0.5,
            }}
          >
            ファイル一覧
          </div>
          {diffs.map((diff, idx) => (
            <div
              key={idx}
              style={{
                padding: '4px 8px',
                cursor: 'pointer',
                background: '#23272e',
                color: '#d4d4d4',
                borderBottom: '1px solid #222',
                fontSize: 11,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                transition: 'background 0.2s',
              }}
              onClick={() => handleFileClick(idx)}
              onMouseOver={e => (e.currentTarget.style.background = '#2d323c')}
              onMouseOut={e => (e.currentTarget.style.background = '#23272e')}
              title={diff.latterFullPath}
            >
              {diff.latterFullPath}
            </div>
          ))}
        </div>
      )}
      <div
        style={{ flex: 1, height: '100%', overflowY: 'auto', paddingLeft: showFileList ? 0 : 0 }}
      >
        {diffs.map((diff, idx) => {
          const showLatter = diff.latterFullPath !== diff.formerFullPath;
          return (
            <div
              key={idx}
              ref={el => {
                diffRefs.current[idx] = el ?? null;
              }}
              style={{ marginBottom: 24, borderBottom: '1px solid #333', scrollMarginTop: 24 }}
            >
              <div
                style={{
                  padding: '8px 16px',
                  background: '#23272e',
                  color: '#d4d4d4',
                  fontSize: 13,
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <span style={{ fontWeight: 'bold' }}>{diff.formerFullPath}</span>
                  <span style={{ marginLeft: 8, color: '#aaa' }}>
                    @{diff.formerCommitId?.slice(0, 6)}
                  </span>
                </div>
                <div>
                  {showLatter && <span style={{ fontWeight: 'bold' }}>{diff.latterFullPath}</span>}
                  <span style={{ marginLeft: showLatter ? 8 : 0, color: '#aaa' }}>
                    @{diff.latterCommitId?.slice(0, 6)}
                  </span>
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
          );
        })}
      </div>
    </div>
  );
};

export default DiffTab;
