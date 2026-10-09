import type React from 'react';
import BinaryTabContent from '@/components/tabs/BinaryTabContent';
import { guessMimeType } from '@/engine/ide/editor/contentInfo';
import type { FileItem } from '@/types/index';
import type {
  BinaryTab,
  OpenTabOptions,
  SessionRestoreContext,
  Tab,
  TabComponentProps,
  TabTypeDefinition,
} from '../../../engine/ide/tabs/types';

/**
 * バイナリタブのコンポーネント
 */
const BinaryTabComponent: React.FC<TabComponentProps> = ({ tab }) => {
  const binaryTab = tab as BinaryTab;

  return (
    <BinaryTabContent
      activeTab={binaryTab}
      editorHeight="100%"
      // ファイル名・buffer から MIME を推定
      guessMimeType={(fileName: string, buffer?: ArrayBuffer, mimeType?: string) =>
        guessMimeType(fileName, buffer, mimeType)
      }
    />
  );
};

/**
 * バイナリタブの型定義
 */
export const BinaryTabType: TabTypeDefinition = {
  kind: 'binary',
  displayName: 'Binary',
  canEdit: false,
  canPreview: false,

  createTab: (data, options?: OpenTabOptions) => {
    const fileItem = data as FileItem;
    const tabId = `binary-${fileItem.path}`;
    const paneId = options?.targetPaneId || '';

    return {
      id: tabId,
      name: fileItem.name,
      path: fileItem.path,
      kind: 'binary',
      paneId,
      content: fileItem.content || '',
      bufferContent: fileItem.bufferContent,
      mimeType: fileItem.mimeType,
      isSnapshot: data.isSnapshot === true,
      type: fileItem.type,
    } as BinaryTab;
  },

  component: BinaryTabComponent,

  /**
   * セッション保存時: content と bufferContent を除外（ファイルから復元可能）
   */
  serializeForSession: (tab): BinaryTab => {
    const binaryTab = tab as BinaryTab;
    if (binaryTab.isSnapshot) return binaryTab;
    const { content, bufferContent, ...rest } = binaryTab;
    return rest as BinaryTab;
  },

  /**
   * セッション復元時: bufferContent をファイルから復元
   */
  restoreContent: async (tab, context: SessionRestoreContext): Promise<Tab> => {
    const binaryTab = tab as BinaryTab;
    if (binaryTab.isSnapshot) return binaryTab;
    const filePath = binaryTab.path;

    if (!filePath) {
      return binaryTab;
    }

    const file = await context.getFileByPath(filePath);

    if (file) {
      if (file.bufferContent === undefined) {
        return { ...binaryTab, kind: 'editor', content: file.content ?? '', isDirty: false };
      }
      console.log('[BinaryTabType] ✓ Restored bufferContent for:', filePath);
      return {
        ...binaryTab,
        content: '',
        mimeType: file.mimeType,
        bufferContent: file.bufferContent,
      };
    }

    console.warn('[BinaryTabType] File not found for bufferContent:', filePath);
    return binaryTab;
  },
};
