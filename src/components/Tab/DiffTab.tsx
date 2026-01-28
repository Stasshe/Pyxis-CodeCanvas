import { DiffEditor } from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import type * as monacoEditor from 'monaco-editor';
import type React from 'react';
import { useEffect, useRef } from 'react';

import { getLanguage } from '@/components/Tab/text-editor/editors/editor-utils';
import { defineAndSetMonacoThemes } from '@/components/Tab/text-editor/editors/monaco-themes';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { isBufferArray } from '@/engine/helper/isBufferArray';

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
  onContentChange?: (content: string) => void; // 編集内容の保存用（デバウンス後）
  // 即時反映用ハンドラ: 編集が発生したら即座に呼ばれる（isDirty フラグ立てに使用）
  onImmediateContentChange?: (content: string) => void;
  // 折り返し設定（CodeEditorと同じくユーザー設定から取得）
  wordWrapConfig?: 'on' | 'off';
}

const DiffTab: React.FC<DiffTabProps> = ({
  diffs,
  editable = false,
  onContentChange,
  onImmediateContentChange,
  wordWrapConfig = 'off',
}) => {
  const { colors, themeName } = useTheme();
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

      // リスナ破棄
      listenersRef.current.forEach((l, idx) => {
        try {
          if (l && typeof l.dispose === 'function') l.dispose();
        } catch (e) {
          /* ignore */
        }
      });
      listenersRef.current.clear();

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

  // 編集リスナの参照を保持（cleanupのため）
  const listenersRef = useRef<Map<number, any>>(new Map());

  // 簡易バイナリ判定: NULバイトや制御文字の割合が高ければバイナリと見なす
  const isBinaryContent = (content: any) => {
    if (!content) return false;
    // まずバイナリ配列判定ユーティリティを利用
    try {
      if (isBufferArray(content)) return true;
    } catch (e) {
      // ignore
    }

    // 文字列は常にテキストとして扱う（日本語や他言語が含まれていてもバイナリ誤判定しない）
    // バッファやArrayBuffer等のバイナリ型は上で isBufferArray により判定されるため、
    // ここでは string 型は例外なくテキスト扱いとする。
    if (typeof content === 'string') {
      return false;
    }

    // その他の型（オブジェクトなど）はバイナリ扱いしない
    return false;
  };

  // DiffEditorマウント時のハンドラ
  const handleDiffEditorMount = (
    editor: monacoEditor.editor.IStandaloneDiffEditor,
    monaco: Monaco,
    idx: number
  ) => {
    editorsRef.current.set(idx, editor);

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
      if (existing && typeof existing.dispose === 'function') {
        try {
          existing.dispose();
        } catch (e) {
          /* ignore */
        }
      }

      // 編集可能で単一ファイルのとき、modifiedモデルの変更を監視して
      // 即時ハンドラ(onImmediateContentChange)を呼び、デバウンス保存を走らせる
      const isEditableSingle = editable && diffs.length === 1;
      if (
        isEditableSingle &&
        diffModel.modified &&
        typeof diffModel.modified.onDidChangeContent === 'function'
      ) {
        const listener = diffModel.modified.onDidChangeContent(() => {
          try {
            const current = diffModel.modified.getValue();
            // 即時反映ハンドラ（タブ全体の isDirty を立てる用途）
            onImmediateContentChange?.(current);
            // デバウンス保存
            debouncedSave(current);
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
              key={idx}
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
                {(() => {
                  const formerBinary = isBinaryContent(diff.formerContent);
                  const latterBinary = isBinaryContent(diff.latterContent);
                  const isBinary = formerBinary || latterBinary;
                  if (isBinary) {
                    return (
                      <div
                        style={{
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: '#1f2328',
                          color: '#ccc',
                          fontSize: 13,
                        }}
                      >
                        <div style={{ padding: 12, textAlign: 'center' }}>
                          <div style={{ fontWeight: 'bold', marginBottom: 6 }}>
                            {t('diffTab.binaryFile') || 'バイナリファイルは表示できません'}
                          </div>
                          <div style={{ color: '#999', fontSize: 12 }}>
                            {diff.latterFullPath || diff.formerFullPath}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <DiffEditor
                      width="100%"
                      height="100%"
                      language={getLanguage(diff.latterFullPath || diff.formerFullPath)}
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
                        wordWrap: wordWrapConfig,
                        lineNumbers: 'on',
                        automaticLayout: true,
                      }}
                    />
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DiffTab;
