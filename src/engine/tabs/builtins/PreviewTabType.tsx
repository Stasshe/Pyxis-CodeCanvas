// src/engine/tabs/builtins/PreviewTabType.tsx
import React from 'react';

import { TabTypeDefinition, TabComponentProps, OpenTabOptions, PreviewTab } from '../types';

import MarkdownPreviewTab from '@/components/Tab/MarkdownPreviewTab';
import { useProjectStore } from '@/stores/projectStore';
import type { FileItem } from '@/types';

/**
 * プレビュータブのコンポーネント
 *
 * NOTE: useProject()は各コンポーネントで独立したステートを持つため、
 * グローバルなprojectStoreからプロジェクト情報を取得する。
 */
const PreviewTabComponent: React.FC<TabComponentProps> = ({ tab }) => {
  const previewTab = tab as PreviewTab;
  const currentProject = useProjectStore(state => state.currentProject);

  return <MarkdownPreviewTab activeTab={previewTab} currentProject={currentProject || undefined} />;
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
    const tabId = fileItem.path ? `preview:${fileItem.path}` : `preview:${fileItem.name}`;
    // Support both `targetPaneId` (preferred) and `paneId` for backward compatibility
    const paneId = options?.targetPaneId || (options as any)?.paneId || '';

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
