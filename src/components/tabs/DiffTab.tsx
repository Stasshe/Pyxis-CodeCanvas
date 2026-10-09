import type { Monaco } from '@monaco-editor/react';
import { DiffEditor } from '@monaco-editor/react';
import type * as monacoEditor from 'monaco-editor';
import type React from 'react';
import { useEffect, useRef } from 'react';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { getLanguage } from '@/engine/ide/editor/contentInfo';
import { defineAndSetMonacoThemes } from '@/lib/monaco/monaco-themes';

interface SingleFileDiff {
  formerFullPath: string;
  formerCommitId: string;
  latterFullPath: string;
  latterCommitId: string;
  formerContent: string;
  latterContent: string;
}

// Use shared getLanguage utility from editor-utils to infer Monaco language ids.

interface DiffTabProps {
  diffs: ReadonlyArray<SingleFileDiff>;
  editable?: boolean; // 編集可能かどうか（true: 編集可能, false: 読み取り専用）
  // 即時反映用ハンドラ: 編集が発生したら即座に呼ばれる（isDirty フラグ立てに使用）
  onImmediateContentChange?: (content: string) => void;
  // 折り返し設定（CodeEditorと同じくユーザー設定から取得）
  wordWrapConfig?: 'on' | 'off';
}

const DiffTab: React.FC<DiffTabProps> = ({
  diffs,
  editable = false,
  onImmediateContentChange,
  wordWrapConfig = 'off',
}) => {
  const { colors, themeName } = useTheme();
  // 各diff領域へのref
  const diffRefs = useRef<(HTMLDivElement | null)[]>([]);

  // DiffEditor owns each editor; this component owns the models and listeners.
  const modelsRef = useRef<
    Map<
      number,
      { original: monacoEditor.editor.ITextModel; modified: monacoEditor.editor.ITextModel }
    >
  >(new Map());

  // クリーンアップ処理
  useEffect(() => {
    return () => {
      // リスナ破棄
      listenersRef.current.forEach((l, idx) => {
        try {
          if (l) l.dispose();
        } catch (e) {
          console.warn('[DiffTab.tsx] caught non-fatal error', e);
          /* ignore */
        }
      });
      listenersRef.current.clear();

      modelsRef.current.forEach((models, idx) => {
        try {
          if (models.original && !models.original.isDisposed()) {
            models.original.dispose();
          }
          if (models.modified && !models.modified.isDisposed()) {
            models.modified.dispose();
          }
        } catch (e) {
          console.warn(`[DiffTab] Failed to dispose models ${idx}:`, e);
        }
      });
      modelsRef.current.clear();
    };
  }, []);

  // 編集リスナの参照を保持（cleanupのため）
  const listenersRef = useRef<Map<number, { dispose: () => void }>>(new Map());

  // DiffEditorマウント時のハンドラ
  const handleDiffEditorMount = (
    editor: monacoEditor.editor.IStandaloneDiffEditor,
    monaco: Monaco,
    idx: number
  ) => {
    // テーマ定義と適用
    try {
      defineAndSetMonacoThemes(monaco, colors, themeName);
    } catch (e) {
      console.warn('[DiffTab] Failed to define/set themes:', e);
    }

    // モデルを取得して保存
    const diffModel = editor.getModel();
    if (diffModel) {
      modelsRef.current.set(idx, {
        original: diffModel.original,
        modified: diffModel.modified,
      });
      // 既にリスナがあれば破棄
      const existing = listenersRef.current.get(idx);
      if (existing) {
        try {
          existing.dispose();
        } catch (e) {
          console.warn('[DiffTab.tsx] caught non-fatal error', e);
          /* ignore */
        }
      }

      // Editable single-file diffs write through the shared tab content store.
      const isEditableSingle = editable && diffs.length === 1;
      if (isEditableSingle && diffModel.modified) {
        const listener = diffModel.modified.onDidChangeContent(() => {
          try {
            const current = diffModel.modified.getValue();
            onImmediateContentChange?.(current);
          } catch (e) {
            console.error('[DiffTab] immediate change handler failed', e);
          }
        });
        listenersRef.current.set(idx, listener);
      }
    }
  };

  // ファイルリストクリック時に該当diff領域へスクロール
  const handleFileClick = (idx: number) => {
    const ref = diffRefs.current[idx];
    if (ref) {
      ref.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const { t } = useTranslation();
  if (diffs.length === 0) {
    return <div style={{ padding: 16, color: '#aaa' }}>{t('diffTab.noDiffFiles')}</div>;
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
            {t('diffTab.fileList')}
          </div>
          {diffs.map((diff, idx) => (
            <div
              key={diff.latterFullPath || diff.formerFullPath}
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
        style={{
          flex: 1,
          height: '100%',
          overflowY: diffs.length > 1 ? 'auto' : 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {diffs.map((diff, idx) => {
          const showLatter = diff.latterFullPath !== diff.formerFullPath;
          // 単一ファイルの場合は全高さを使用、複数ファイルの場合は固定高さ
          const isSingleFile = diffs.length === 1;
          return (
            <div
              key={diff.latterFullPath || diff.formerFullPath}
              ref={el => {
                diffRefs.current[idx] = el ?? null;
              }}
              style={{
                ...(isSingleFile
                  ? {
                      flex: 1,
                      minHeight: 0,
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                    }
                  : { marginBottom: 24, scrollMarginTop: 24 }),
                borderBottom: isSingleFile ? 'none' : '1px solid #333',
              }}
            >
              <div
                style={{
                  padding: '8px 16px',
                  background: '#23272e',
                  color: '#d4d4d4',
                  fontSize: 13,
                  display: 'flex',
                  justifyContent: 'space-between',
                  flexShrink: 0,
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
              <div
                style={
                  isSingleFile
                    ? { flex: 1, minHeight: 0, height: '100%' }
                    : { height: 500, minHeight: 0 }
                }
              >
                <DiffEditor
                  width="100%"
                  height="100%"
                  keepCurrentOriginalModel
                  keepCurrentModifiedModel
                  language={getLanguage(diff.latterFullPath || diff.formerFullPath)}
                  original={diff.formerContent}
                  modified={diff.latterContent}
                  theme="pyxis-custom"
                  onMount={(editor, monaco) => handleDiffEditorMount(editor, monaco, idx)}
                  options={{
                    editContext: false,
                    renderSideBySide: true,
                    // 単一ファイルのdiffかつeditableがtrueの場合のみ編集可能
                    readOnly: !(editable && diffs.length === 1),
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 14,
                    wordWrap: wordWrapConfig,
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
