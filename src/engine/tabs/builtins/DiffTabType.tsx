// src/engine/tabs/builtins/DiffTabType.tsx
import React from 'react';
import { TabTypeDefinition, DiffTab, TabComponentProps } from '../types';
import DiffTabComponent from '@/components/Tab/DiffTab';
import { useTabStore } from '@/stores/tabStore';
import { useProject } from '@/engine/core/project';

/**
 * Diffタブのコンポーネント
 */
const DiffTabRenderer: React.FC<TabComponentProps> = ({ tab }) => {
  const diffTab = tab as DiffTab;
  const updateTab = useTabStore(state => state.updateTab);
  const { saveFile } = useProject();

  const handleImmediateContentChange = (content: string) => {
    // 即座にコンテンツを更新
    if (diffTab.diffs.length > 0) {
      const updatedDiffs = [...diffTab.diffs];
      updatedDiffs[0] = {
        ...updatedDiffs[0],
        latterContent: content,
      };
      updateTab(diffTab.paneId, diffTab.id, { diffs: updatedDiffs } as Partial<DiffTab>);
    }
  };

  const handleContentChange = async (content: string) => {
    // ファイルを保存
    if (saveFile && diffTab.path && diffTab.editable) {
      await saveFile(diffTab.path, content);
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
  
  createTab: (file, options): DiffTab => {
    const tabId = `diff:${file.path || file.name || Date.now()}`;
    return {
      id: tabId,
      name: `Diff: ${file.name}`,
      kind: 'diff',
      path: file.path || '',
      paneId: options?.paneId || '',
      diffs: options?.diffProps?.diffs || [],
      editable: options?.diffProps?.editable || false,
    };
  },
  
  shouldReuseTab: (existingTab, newFile, options) => {
    return existingTab.path === newFile.path && existingTab.kind === 'diff';
  },
};
