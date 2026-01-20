/**
 * マージコンフリクト解決タブのUIコンポーネント
 *
 * 3方向マージ（base, ours, theirs）を表示し、
 * ユーザーがコンフリクトを解決できるインターフェースを提供
 */
import { DiffEditor, Editor } from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import { Check, ChevronDown, ChevronRight, GitMerge, X } from 'lucide-react';
import type * as monacoEditor from 'monaco-editor';
import type React from 'react';
import { useCallback, useRef, useState } from 'react';

import { getLanguage } from '@/components/Tab/text-editor/editors/editor-utils';
import { defineAndSetMonacoThemes } from '@/components/Tab/text-editor/editors/monaco-themes';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import type { MergeConflictFileEntry } from '@/engine/tabs/types';

interface MergeConflictResolutionTabProps {
  conflicts: MergeConflictFileEntry[];
  oursBranch: string;
  theirsBranch: string;
  projectId: string;
  projectName: string;
  /** コンフリクト解決を確定して保存 */
  onResolve: (resolvedFiles: MergeConflictFileEntry[]) => void;
  /** マージをキャンセル */
  onCancel: () => void;
  /** 解決内容の更新 */
  onUpdateResolvedContent: (filePath: string, content: string) => void;
  /** ファイルの解決状態を切り替え */
  onToggleResolved: (filePath: string, isResolved: boolean) => void;
}

type ViewMode = 'three-way' | 'ours-vs-theirs' | 'result';

const MergeConflictResolutionTab: React.FC<MergeConflictResolutionTabProps> = ({
  conflicts,
  oursBranch,
  theirsBranch,
  projectId,
  projectName,
  onResolve,
  onCancel,
  onUpdateResolvedContent,
  onToggleResolved,
}) => {
  const { colors, themeName } = useTheme();
  const { t } = useTranslation();
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('three-way');
  const [expandedFiles, setExpandedFiles] = useState<Set<number>>(new Set([0]));
  const editorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);

  const selectedFile = conflicts[selectedFileIndex];
  const allResolved = conflicts.every(f => f.isResolved);

  // テーマを適用
  const handleEditorMount = useCallback(
    (editor: monacoEditor.editor.IStandaloneCodeEditor, monaco: Monaco) => {
      editorRef.current = editor;
      try {
        defineAndSetMonacoThemes(monaco, colors, themeName);
      } catch (e) {
        console.warn('[MergeConflictResolutionTab] Failed to define/set themes:', e);
      }
    },
    [colors, themeName]
  );

  const handleDiffEditorMount = useCallback(
    (editor: monacoEditor.editor.IStandaloneDiffEditor, monaco: Monaco) => {
      try {
        defineAndSetMonacoThemes(monaco, colors, themeName);
      } catch (e) {
        console.warn('[MergeConflictResolutionTab] Failed to define/set themes:', e);
      }
    },
    [colors, themeName]
  );

  // 解決エディタの内容変更
  const handleResolvedContentChange = useCallback(
    (value: string | undefined) => {
      if (value !== undefined && selectedFile) {
        onUpdateResolvedContent(selectedFile.filePath, value);
      }
    },
    [selectedFile, onUpdateResolvedContent]
  );

  // Accept Ours - OURSの内容で解決
  const handleAcceptOurs = useCallback(() => {
    if (selectedFile) {
      onUpdateResolvedContent(selectedFile.filePath, selectedFile.oursContent);
    }
  }, [selectedFile, onUpdateResolvedContent]);

  // Accept Theirs - THEIRSの内容で解決
  const handleAcceptTheirs = useCallback(() => {
    if (selectedFile) {
      onUpdateResolvedContent(selectedFile.filePath, selectedFile.theirsContent);
    }
  }, [selectedFile, onUpdateResolvedContent]);

  // Accept Both - 両方を結合
  const handleAcceptBoth = useCallback(() => {
    if (selectedFile) {
      const combined = `${selectedFile.oursContent}\n${selectedFile.theirsContent}`;
      onUpdateResolvedContent(selectedFile.filePath, combined);
    }
  }, [selectedFile, onUpdateResolvedContent]);

  // 解決フラグのトグル
  const handleToggleResolved = useCallback(() => {
    if (selectedFile) {
      onToggleResolved(selectedFile.filePath, !selectedFile.isResolved);
    }
  }, [selectedFile, onToggleResolved]);

  // ファイルの展開/折りたたみ
  const toggleFileExpanded = useCallback((index: number) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  // ファイル選択
  const handleSelectFile = useCallback((index: number) => {
    setSelectedFileIndex(index);
    setExpandedFiles(prev => new Set(prev).add(index));
  }, []);

  // 最終確定
  const handleFinalResolve = useCallback(() => {
    if (allResolved) {
      onResolve(conflicts);
    }
  }, [allResolved, conflicts, onResolve]);

  if (conflicts.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        {t('mergeConflict.noConflicts') || 'コンフリクトはありません'}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#252526] border-b border-[#3c3c3c]">
        <div className="flex items-center gap-2">
          <GitMerge className="w-5 h-5 text-yellow-500" />
          <span className="font-medium text-white">
            {t('mergeConflict.title') || 'マージコンフリクト解決'}
          </span>
          <span className="text-sm text-gray-400">
            ({conflicts.filter(f => f.isResolved).length}/{conflicts.length} {t('mergeConflict.resolved') || '解決済み'})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">
            {oursBranch} ← {theirsBranch}
          </span>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1 text-sm text-gray-300 hover:bg-[#3c3c3c] rounded"
          >
            {t('common.cancel') || 'キャンセル'}
          </button>
          <button
            type="button"
            onClick={handleFinalResolve}
            disabled={!allResolved}
            className={`px-3 py-1 text-sm rounded flex items-center gap-1 ${
              allResolved
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-gray-600 text-gray-400 cursor-not-allowed'
            }`}
          >
            <Check className="w-4 h-4" />
            {t('mergeConflict.completeResolve') || '解決完了'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ファイルリスト */}
        <div className="w-64 bg-[#252526] border-r border-[#3c3c3c] overflow-y-auto">
          <div className="p-2 text-xs text-gray-400 border-b border-[#3c3c3c]">
            {t('mergeConflict.conflictFiles') || 'コンフリクトファイル'}
          </div>
          {conflicts.map((conflict, index) => (
            <div key={conflict.filePath}>
              <button
                type="button"
                onClick={() => handleSelectFile(index)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left hover:bg-[#2a2d2e] ${
                  selectedFileIndex === index ? 'bg-[#37373d]' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    toggleFileExpanded(index);
                  }}
                  className="p-0.5"
                >
                  {expandedFiles.has(index) ? (
                    <ChevronDown className="w-3 h-3 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-gray-400" />
                  )}
                </button>
                <span
                  className={`flex-1 truncate ${
                    conflict.isResolved ? 'text-green-400' : 'text-yellow-400'
                  }`}
                >
                  {conflict.filePath.split('/').pop()}
                </span>
                {conflict.isResolved ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <X className="w-4 h-4 text-yellow-400" />
                )}
              </button>
              {expandedFiles.has(index) && (
                <div className="pl-6 text-xs text-gray-500 py-1">
                  {conflict.filePath}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* メインエディタエリア */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* ビューモード切り替え + アクション */}
          <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-[#3c3c3c]">
            <div className="flex items-center gap-2">
              <select
                value={viewMode}
                onChange={e => setViewMode(e.target.value as ViewMode)}
                className="px-2 py-1 text-sm bg-[#3c3c3c] text-white rounded border border-[#555]"
              >
                <option value="three-way">{t('mergeConflict.threeWayView') || '3方向表示'}</option>
                <option value="ours-vs-theirs">{t('mergeConflict.oursVsTheirs') || 'Ours vs Theirs'}</option>
                <option value="result">{t('mergeConflict.resultView') || '結果のみ'}</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAcceptOurs}
                className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded"
              >
                {t('mergeConflict.acceptOurs') || 'Oursを採用'}
              </button>
              <button
                type="button"
                onClick={handleAcceptTheirs}
                className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded"
              >
                {t('mergeConflict.acceptTheirs') || 'Theirsを採用'}
              </button>
              <button
                type="button"
                onClick={handleAcceptBoth}
                className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-700 text-white rounded"
              >
                {t('mergeConflict.acceptBoth') || '両方採用'}
              </button>
              <button
                type="button"
                onClick={handleToggleResolved}
                className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${
                  selectedFile?.isResolved
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-yellow-600 hover:bg-yellow-700 text-white'
                }`}
              >
                {selectedFile?.isResolved ? (
                  <>
                    <Check className="w-3 h-3" />
                    {t('mergeConflict.resolved') || '解決済み'}
                  </>
                ) : (
                  <>{t('mergeConflict.markAsResolved') || '解決済みにする'}</>
                )}
              </button>
            </div>
          </div>

          {/* エディタ表示エリア */}
          <div className="flex-1 overflow-hidden">
            {selectedFile && viewMode === 'three-way' && (
              <ThreeWayView
                file={selectedFile}
                oursBranch={oursBranch}
                theirsBranch={theirsBranch}
                onMount={handleDiffEditorMount}
                onResolvedContentChange={handleResolvedContentChange}
                colors={colors}
                themeName={themeName}
              />
            )}
            {selectedFile && viewMode === 'ours-vs-theirs' && (
              <div className="h-full">
                <DiffEditor
                  width="100%"
                  height="100%"
                  language={getLanguage(selectedFile.filePath)}
                  original={selectedFile.oursContent}
                  modified={selectedFile.theirsContent}
                  theme="pyxis-custom"
                  onMount={handleDiffEditorMount}
                  options={{
                    renderSideBySide: true,
                    readOnly: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 13,
                  }}
                />
              </div>
            )}
            {selectedFile && viewMode === 'result' && (
              <div className="h-full">
                <Editor
                  width="100%"
                  height="100%"
                  language={getLanguage(selectedFile.filePath)}
                  value={selectedFile.resolvedContent}
                  theme="pyxis-custom"
                  onChange={handleResolvedContentChange}
                  onMount={handleEditorMount}
                  options={{
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 13,
                    wordWrap: 'on',
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * 3方向表示コンポーネント
 * Base, Ours, Theirs, 解決結果を表示
 */
interface ThreeWayViewProps {
  file: MergeConflictFileEntry;
  oursBranch: string;
  theirsBranch: string;
  onMount: (editor: monacoEditor.editor.IStandaloneDiffEditor, monaco: Monaco) => void;
  onResolvedContentChange: (value: string | undefined) => void;
  colors: any;
  themeName: string;
}

const ThreeWayView: React.FC<ThreeWayViewProps> = ({
  file,
  oursBranch,
  theirsBranch,
  onMount,
  onResolvedContentChange,
  colors,
  themeName,
}) => {
  const { t } = useTranslation();
  const handleEditorMount = useCallback(
    (editor: monacoEditor.editor.IStandaloneCodeEditor, monaco: Monaco) => {
      try {
        defineAndSetMonacoThemes(monaco, colors, themeName);
      } catch (e) {
        console.warn('[ThreeWayView] Failed to define/set themes:', e);
      }
    },
    [colors, themeName]
  );

  return (
    <div className="flex flex-col h-full">
      {/* 上部: Base vs Ours / Base vs Theirs */}
      <div className="flex-1 flex overflow-hidden border-b border-[#3c3c3c]">
        {/* Base vs Ours */}
        <div className="flex-1 flex flex-col border-r border-[#3c3c3c]">
          <div className="px-2 py-1 text-xs bg-[#2d2d2d] text-blue-400 border-b border-[#3c3c3c]">
            Base ↔ {oursBranch} (Ours)
          </div>
          <div className="flex-1">
            <DiffEditor
              width="100%"
              height="100%"
              language={getLanguage(file.filePath)}
              original={file.baseContent}
              modified={file.oursContent}
              theme="pyxis-custom"
              onMount={onMount}
              options={{
                renderSideBySide: false,
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 12,
              }}
            />
          </div>
        </div>
        {/* Base vs Theirs */}
        <div className="flex-1 flex flex-col">
          <div className="px-2 py-1 text-xs bg-[#2d2d2d] text-purple-400 border-b border-[#3c3c3c]">
            Base ↔ {theirsBranch} (Theirs)
          </div>
          <div className="flex-1">
            <DiffEditor
              width="100%"
              height="100%"
              language={getLanguage(file.filePath)}
              original={file.baseContent}
              modified={file.theirsContent}
              theme="pyxis-custom"
              onMount={onMount}
              options={{
                renderSideBySide: false,
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 12,
              }}
            />
          </div>
        </div>
      </div>
      {/* 下部: 解決結果エディタ */}
      <div className="flex-1 flex flex-col">
        <div className="px-2 py-1 text-xs bg-[#2d2d2d] text-green-400 border-b border-[#3c3c3c]">
          {t('mergeConflict.resolvedResult') || '解決結果'} ({t('common.editable') || '編集可能'})
        </div>
        <div className="flex-1">
          <Editor
            width="100%"
            height="100%"
            language={getLanguage(file.filePath)}
            value={file.resolvedContent}
            theme="pyxis-custom"
            onChange={onResolvedContentChange}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 13,
              wordWrap: 'on',
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default MergeConflictResolutionTab;
