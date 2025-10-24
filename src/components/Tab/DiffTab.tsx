import React, { useRef, useEffect } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import type * as monacoEditor from 'monaco-editor';
import { useTranslation } from '@/context/I18nContext';

interface SingleFileDiff {
  formerFullPath: string;
  formerCommitId: string;
  latterFullPath: string;
  latterCommitId: string;
  formerContent: string;
  latterContent: string;
}

interface DiffTabProps {
  diffs: SingleFileDiff[];
  editable?: boolean; // 編集可能かどうか（true: 編集可能, false: 読み取り専用）
  onContentChange?: (content: string) => void; // 編集内容の保存用（デバウンス後）
  onContentChangeImmediate?: (content: string) => void; // 編集内容の即時更新用
}

const DiffTab: React.FC<DiffTabProps> = ({
  diffs,
  editable = false,
  onContentChange,
  onContentChangeImmediate,
}) => {
  // 各diff領域へのref
  const diffRefs = useRef<(HTMLDivElement | null)[]>([]);

  // DiffEditorインスタンスとモデルを管理
  const editorsRef = useRef<Map<number, monacoEditor.editor.IStandaloneDiffEditor>>(new Map());
  const modelsRef = useRef<
    Map<
      number,
      { original: monacoEditor.editor.ITextModel; modified: monacoEditor.editor.ITextModel }
    >
  >(new Map());

  // デバウンス保存用のタイマー
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // クリーンアップ処理
  useEffect(() => {
    return () => {
      // デバウンスタイマーをクリア
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // エディタをリセットしてからモデルを破棄
      editorsRef.current.forEach((editor, idx) => {
        try {
          // まずエディタのモデルをnullに設定
          const diffModel = editor.getModel();
          if (diffModel) {
            editor.setModel(null);
          }
        } catch (e) {
          console.warn(`[DiffTab] Failed to reset editor ${idx}:`, e);
        }
      });

      // エディタを破棄
      editorsRef.current.forEach((editor, idx) => {
        try {
          if (editor && typeof editor.dispose === 'function') {
            editor.dispose();
          }
        } catch (e) {
          console.warn(`[DiffTab] Failed to dispose editor ${idx}:`, e);
        }
      });

      // 最後にモデルを破棄
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

      editorsRef.current.clear();
      modelsRef.current.clear();
    };
  }, []);

  // デバウンス付き保存関数
  const debouncedSave = (content: string) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      console.log('[DiffTab] Debounced save triggered');
      if (onContentChange) {
        onContentChange(content);
      }
    }, 5000); // CodeEditorと同じく5秒
  };

  // DiffEditorマウント時のハンドラ
  const handleDiffEditorMount = (
    editor: monacoEditor.editor.IStandaloneDiffEditor,
    monaco: Monaco,
    idx: number
  ) => {
    editorsRef.current.set(idx, editor);

    // モデルを取得して保存
    const diffModel = editor.getModel();
    if (diffModel) {
      modelsRef.current.set(idx, {
        original: diffModel.original,
        modified: diffModel.modified,
      });

      // 編集可能かつ単一ファイルのdiffの場合のみ変更イベントを監視
      // 複数ファイルのdiffでは、どのファイルが編集されたか特定が困難なため無効化
      if (editable && diffModel.modified && diffs.length === 1) {
        const modifiedEditor = editor.getModifiedEditor();

        // 変更イベントリスナーを追加
        const disposable = diffModel.modified.onDidChangeContent(() => {
          const newContent = diffModel.modified.getValue();

          console.log('[DiffTab] Content changed, triggering save');

          // 即座に状態を更新
          if (onContentChangeImmediate) {
            onContentChangeImmediate(newContent);
          }

          // デバウンス保存をトリガー
          debouncedSave(newContent);
        });

        // クリーンアップ用に保存（エディタ破棄時に一緒に破棄される）
        // disposableはエディタと共に破棄されるため、明示的な管理は不要
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
                  onMount={(editor, monaco) => handleDiffEditorMount(editor, monaco, idx)}
                  options={{
                    renderSideBySide: true,
                    // 単一ファイルのdiffかつeditableがtrueの場合のみ編集可能
                    readOnly: !(editable && diffs.length === 1),
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
