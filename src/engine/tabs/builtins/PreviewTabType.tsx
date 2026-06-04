// src/engine/tabs/builtins/PreviewTabType.tsx
import type React from 'react';
import { lazy, Suspense } from 'react';
import { useProjectSnapshot } from '@/stores/projectStore';
import { setTabContent } from '@/stores/tabContentStore';
import type { FileItem } from '@/types';
import type {
  OpenTabOptions,
  PreviewTab,
  SessionRestoreContext,
  TabComponentProps,
  TabTypeDefinition,
} from '../types';

const MarkdownPreviewTab = lazy(() => import('@/components/Tab/MarkdownPreviewTab'));

/**
 * プレビュータブのコンポーネント
 *
 * NOTE: useProject()は各コンポーネントで独立したステートを持つため、
 * グローバルなprojectStoreからプロジェクト情報を取得する。
 */
const PreviewTabComponent: React.FC<TabComponentProps> = ({ tab }) => {
  const previewTab = tab as PreviewTab;
  const { currentProject } = useProjectSnapshot();

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Loading preview...
        </div>
      }
    >
      <MarkdownPreviewTab activeTab={previewTab} currentProject={currentProject || undefined} />
    </Suspense>
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
    const tabId = fileItem.path ? `preview:${fileItem.path}` : `preview:${fileItem.name}`;
    // Support both `targetPaneId` (preferred) and `paneId` for backward compatibility
    const paneId = options?.targetPaneId || (options as any)?.paneId || '';
    const content = fileItem.content || '';
    setTabContent(tabId, content, false);
    return {
      id: tabId,
      name: fileItem.name,
      path: fileItem.path,
      kind: 'preview',
      paneId,
      content,
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

    if (!filePath) {
      return previewTab;
    }

    const file = await context.getFileByPath(filePath);

    if (file?.content) {
      console.log('[PreviewTabType] ✓ Restored content for:', filePath);
      return {
        ...previewTab,
        content: file.content,
      };
    }

    console.warn('[PreviewTabType] File not found for content:', filePath);
    return previewTab;
  },
};
