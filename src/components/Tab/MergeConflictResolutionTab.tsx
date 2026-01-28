/**
 * Merge Conflict Resolution Tab UI Component
 *
 * Displays 3-way merge (base, ours, theirs) and allows
 * users to resolve conflicts interactively.
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
import { type ThemeColors, useTheme } from '@/context/ThemeContext';
import type { MergeConflictFileEntry } from '@/engine/tabs/types';

interface MergeConflictResolutionTabProps {
  conflicts: ReadonlyArray<MergeConflictFileEntry>;
  oursBranch: string;
  theirsBranch: string;
  projectId: string;
  projectName: string;
  /** Confirm conflict resolution and save */
  onResolve: (resolvedFiles: ReadonlyArray<MergeConflictFileEntry>) => void;
  /** Cancel merge */
  onCancel: () => void;
  /** Update resolved content */
  onUpdateResolvedContent: (filePath: string, content: string) => void;
  /** Toggle file resolution state */
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

  // Apply theme
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

  // Resolved content change handler
  const handleResolvedContentChange = useCallback(
    (value: string | undefined) => {
      if (value !== undefined && selectedFile) {
        onUpdateResolvedContent(selectedFile.filePath, value);
      }
    },
    [selectedFile, onUpdateResolvedContent]
  );

  // Accept Ours - resolve with OURS content
  const handleAcceptOurs = useCallback(() => {
    if (selectedFile) {
      onUpdateResolvedContent(selectedFile.filePath, selectedFile.oursContent);
    }
  }, [selectedFile, onUpdateResolvedContent]);

  // Accept Theirs - resolve with THEIRS content
  const handleAcceptTheirs = useCallback(() => {
    if (selectedFile) {
      onUpdateResolvedContent(selectedFile.filePath, selectedFile.theirsContent);
    }
  }, [selectedFile, onUpdateResolvedContent]);

  // Accept Both - combine both
  const handleAcceptBoth = useCallback(() => {
    if (selectedFile) {
      const combined = `${selectedFile.oursContent}\n${selectedFile.theirsContent}`;
      onUpdateResolvedContent(selectedFile.filePath, combined);
    }
  }, [selectedFile, onUpdateResolvedContent]);

  // Toggle resolved flag
  const handleToggleResolved = useCallback(() => {
    if (selectedFile) {
      onToggleResolved(selectedFile.filePath, !selectedFile.isResolved);
    }
  }, [selectedFile, onToggleResolved]);

  // File expand/collapse
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

  // File selection
  const handleSelectFile = useCallback((index: number) => {
    setSelectedFileIndex(index);
    setExpandedFiles(prev => new Set(prev).add(index));
  }, []);

  // Final resolution
  const handleFinalResolve = useCallback(() => {
    if (allResolved) {
      onResolve(conflicts);
    }
  }, [allResolved, conflicts, onResolve]);

  if (conflicts.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        {t('mergeConflict.noConflicts') || 'No conflicts'}
      </div>
    );
  }

  const resolvedCount = conflicts.filter(f => f.isResolved).length;

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#252526] border-b border-[#3c3c3c]">
        <div className="flex items-center gap-2">
          <GitMerge className="w-5 h-5 text-yellow-500" />
          <span className="font-medium text-white">
            {t('mergeConflict.title') || 'Merge Conflict Resolution'}
          </span>
          <span className="text-sm text-gray-400">
            ({resolvedCount}/{conflicts.length} {t('mergeConflict.resolved') || 'resolved'})
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
            {t('common.cancel') || 'Cancel'}
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
            {t('mergeConflict.completeResolve') || 'Complete Resolution'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* File list */}
        <div className="w-48 bg-[#252526] border-r border-[#3c3c3c] overflow-y-auto flex-shrink-0">
          <div className="p-2 text-xs text-gray-400 border-b border-[#3c3c3c]">
            {t('mergeConflict.conflictFiles') || 'Conflict Files'}
          </div>
          {conflicts.map((conflict, index) => (
            <div key={conflict.filePath}>
              <button
                type="button"
                onClick={() => handleSelectFile(index)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left hover:bg-[#2a2d2e] ${selectedFileIndex === index ? 'bg-[#37373d]' : ''}`}
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
                  className={`flex-1 truncate ${conflict.isResolved ? 'text-green-400' : 'text-yellow-400'}`}
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
                <div className="pl-6 text-xs text-gray-500 py-1">{conflict.filePath}</div>
              )}
            </div>
          ))}
        </div>

        {/* Main editor area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* View mode switch + actions */}
          <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-[#3c3c3c]">
            <div className="flex items-center gap-2">
              <select
                value={viewMode}
                onChange={e => setViewMode(e.target.value as ViewMode)}
                className="px-2 py-1 text-sm bg-[#3c3c3c] text-white rounded border border-[#555]"
              >
                <option value="three-way">{t('mergeConflict.threeWayView') || '3-Way View'}</option>
                <option value="ours-vs-theirs">
                  {t('mergeConflict.oursVsTheirs') || 'Ours vs Theirs'}
                </option>
                <option value="result">{t('mergeConflict.resultView') || 'Result Only'}</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAcceptOurs}
                className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded"
              >
                {t('mergeConflict.acceptOurs') || 'Accept Ours'}
              </button>
              <button
                type="button"
                onClick={handleAcceptTheirs}
                className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded"
              >
                {t('mergeConflict.acceptTheirs') || 'Accept Theirs'}
              </button>
              <button
                type="button"
                onClick={handleAcceptBoth}
                className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-700 text-white rounded"
              >
                {t('mergeConflict.acceptBoth') || 'Accept Both'}
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
                    {t('mergeConflict.resolved') || 'Resolved'}
                  </>
                ) : (
                  <>{t('mergeConflict.markAsResolved') || 'Mark as Resolved'}</>
                )}
              </button>
            </div>
          </div>

          {/* Editor display area */}
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
 * Three-way view component
 * Displays Base, Ours, Theirs, and resolved result
 */
interface ThreeWayViewProps {
  file: MergeConflictFileEntry;
  oursBranch: string;
  theirsBranch: string;
  onMount: (editor: monacoEditor.editor.IStandaloneDiffEditor, monaco: Monaco) => void;
  onResolvedContentChange: (value: string | undefined) => void;
  colors: ThemeColors;
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
      {/* Top: Base vs Ours / Base vs Theirs */}
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
      {/* Bottom: Resolved result editor */}
      <div className="flex-1 flex flex-col">
        <div className="px-2 py-1 text-xs bg-[#2d2d2d] text-green-400 border-b border-[#3c3c3c]">
          {t('mergeConflict.resolvedResult') || 'Resolved Result'} (
          {t('common.editable') || 'Editable'})
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
