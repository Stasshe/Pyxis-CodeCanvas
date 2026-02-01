// src/engine/tabs/builtins/PreviewTabType.tsx
import type React from 'react';

import type {
  OpenTabOptions,
  PreviewTab,
  SessionRestoreContext,
  TabComponentProps,
  TabTypeDefinition,
} from '../types';

import MarkdownPreviewTab from '@/components/Tab/MarkdownPreviewTab';
import { toAppPath } from '@/engine/core/pathUtils';
import { useProjectSnapshot } from '@/stores/projectStore';
import type { FileItem } from '@/types';

/**
 * プレビュータブのコンポーネント
 *
 * NOTE: useProject()は各コンポーネントで独立したステートを持つため、
 * グローバルなprojectStoreからプロジェクト情報を取得する。
 */
const PreviewTabComponent: React.FC<TabComponentProps> = ({ tab }) => {
  const previewTab = tab as PreviewTab;
  const { currentProject } = useProjectSnapshot();

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

  /**
   * セッション保存時: content を除外（ファイルから復元可能）
   */
  serializeForSession: (tab): PreviewTab => {
    const previewTab = tab as PreviewTab;
    const { content, ...rest } = previewTab;
    return { ...rest, content: '' } as PreviewTab;
  },

  /**
   * セッション復元時: content をファイルから復元
   */
  restoreContent: async (tab, context: SessionRestoreContext): Promise<PreviewTab> => {
    const previewTab = tab as PreviewTab;
    const filePath = previewTab.path;

    if (!filePath || !context.projectFiles) {
      return previewTab;
    }

    // projectFiles から対応するファイルを検索
    const correspondingFile = context.projectFiles.find(
      f => toAppPath(f.path) === toAppPath(filePath)
    );

    if (correspondingFile?.content) {
      console.log('[PreviewTabType] ✓ Restored content for:', filePath);
      return {
        ...previewTab,
        content: correspondingFile.content,
      };
    }

    console.warn('[PreviewTabType] File not found for content:', filePath);
    return previewTab;
  },
};
