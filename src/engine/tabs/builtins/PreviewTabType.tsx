// src/engine/tabs/builtins/PreviewTabType.tsx
import React from 'react';
import { TabTypeDefinition, TabComponentProps, OpenTabOptions, PreviewTab } from '../types';
import MarkdownPreviewTab from '@/components/Tab/MarkdownPreviewTab';
import { useProject } from '@/engine/core/project';
import type { FileItem } from '@/types';

/**
 * プレビュータブのコンポーネント
 */
const PreviewTabComponent: React.FC<TabComponentProps> = ({ tab }) => {
  const previewTab = tab as PreviewTab;
  const { currentProject } = useProject();

  return (
    <MarkdownPreviewTab
      activeTab={previewTab}
      currentProject={currentProject || undefined}
    />
  );
};

/**
 * プレビュータブの型定義
 */
export const PreviewTabType: TabTypeDefinition = {
  kind: 'preview',
  displayName: 'Preview',
  canEdit: false,
  canPreview: false,
  
  createTab: (data: unknown, options?: OpenTabOptions) => {
    const fileItem = data as FileItem;
    const tabId = `preview-${fileItem.path}`;
    const paneId = options?.targetPaneId || '';

    return {
      id: tabId,
      name: fileItem.name,
      path: fileItem.path,
      kind: 'preview',
      paneId,
      content: fileItem.content || '',
    } as PreviewTab;
  },

  component: PreviewTabComponent,
};
