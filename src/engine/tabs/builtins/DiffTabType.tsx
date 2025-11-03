// src/engine/tabs/builtins/DiffTabType.tsx
import React from 'react';
import { TabTypeDefinition, DiffTab, TabComponentProps } from '../types';
import DiffTabComponent from '@/components/Tab/DiffTab';
import { useTabStore } from '@/stores/tabStore';
import { useProject } from '@/engine/core/project';
import { useGitContext } from '@/components/PaneContainer';

/**
 * Diffタブのコンポーネント
 */
const DiffTabRenderer: React.FC<TabComponentProps> = ({ tab }) => {
  const diffTab = tab as DiffTab;
  const updateTab = useTabStore(state => state.updateTab);
  const { saveFile } = useProject();
  const { setGitRefreshTrigger } = useGitContext();

  const handleImmediateContentChange = (content: string) => {
    // 即座にコンテンツを更新（isDirtyをtrue）
    if (diffTab.diffs.length > 0) {
      const updatedDiffs = [...diffTab.diffs];
      updatedDiffs[0] = {
        ...updatedDiffs[0],
        latterContent: content,
      };
      updateTab(diffTab.paneId, diffTab.id, {
        diffs: updatedDiffs,
        isDirty: true,
      } as Partial<DiffTab>);
    }
  };

  const handleContentChange = async (content: string) => {
    // ファイルを保存
    if (saveFile && diffTab.path && diffTab.editable) {
      await saveFile(diffTab.path, content);
      updateTab(diffTab.paneId, diffTab.id, { isDirty: false } as Partial<DiffTab>);
      // Git状態を更新
      setGitRefreshTrigger(prev => prev + 1);
    }
  };

  return (
    <DiffTabComponent
      diffs={diffTab.diffs}
      editable={diffTab.editable}
      onImmediateContentChange={handleImmediateContentChange}
      onContentChange={handleContentChange}
    />
  );
};

/**
 * Diffタブタイプの定義
 */
export const DiffTabType: TabTypeDefinition = {
  kind: 'diff',
  displayName: 'Diff',
  icon: 'GitCompare',
  canEdit: false,
  canPreview: false,
  component: DiffTabRenderer,

  createTab: (data, options): DiffTab => {
    // dataには { files: SingleFileDiff | SingleFileDiff[], editable: boolean } が渡される
    const files = data.files;
    const isMultiFile = Array.isArray(files);
    const diffs = isMultiFile ? files : [files];

    // タブIDとラベルを生成
    let tabId: string;
    let tabName: string;

    if (isMultiFile) {
      // 複数ファイルのDiff（コミット全体）
      const firstDiff = diffs[0];
      tabId = `diff-all-${firstDiff.formerCommitId}-${firstDiff.latterCommitId}`;
      tabName = `Diff: ${firstDiff.formerCommitId?.slice(0, 6) || ''}..${firstDiff.latterCommitId?.slice(0, 6) || ''}`;
    } else {
      // 単一ファイルのDiff
      const diff = diffs[0];
      tabId = `diff-${diff.formerCommitId}-${diff.latterCommitId}-${diff.formerFullPath}`;
      tabName = `Diff: ${diff.formerFullPath.split('/').pop()} (${diff.formerCommitId?.slice(0, 6) || ''}..${diff.latterCommitId?.slice(0, 6) || ''})`;
    }

    return {
      id: tabId,
      name: tabName,
      kind: 'diff',
      path: isMultiFile ? '' : diffs[0].formerFullPath,
      paneId: options?.paneId || '',
      diffs: diffs,
      editable: data.editable ?? false,
    };
  },

  shouldReuseTab: (existingTab, newFile, options) => {
    return existingTab.path === newFile.path && existingTab.kind === 'diff';
  },
};
