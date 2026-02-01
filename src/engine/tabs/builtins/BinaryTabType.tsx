// src/engine/tabs/builtins/BinaryTabType.tsx
import type React from 'react';

import type {
  BinaryTab,
  OpenTabOptions,
  SessionRestoreContext,
  TabComponentProps,
  TabTypeDefinition,
} from '../types';

import BinaryTabContent from '@/components/Tab/BinaryTabContent';
import { guessMimeType } from '@/components/Tab/text-editor/editors/editor-utils';
import { toAppPath } from '@/engine/core/pathUtils';
import type { FileItem } from '@/types';

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
      guessMimeType={(fileName: string, buffer?: ArrayBuffer) => guessMimeType(fileName, buffer)}
      isBufferArray={(arg: any) => arg instanceof ArrayBuffer}
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

  createTab: (data: unknown, options?: OpenTabOptions) => {
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
      type: fileItem.type,
    } as BinaryTab;
  },

  component: BinaryTabComponent,

  /**
   * セッション保存時: content と bufferContent を除外（ファイルから復元可能）
   */
  serializeForSession: (tab): BinaryTab => {
    const binaryTab = tab as BinaryTab;
    const { content, bufferContent, ...rest } = binaryTab;
    return rest as BinaryTab;
  },

  /**
   * セッション復元時: bufferContent をファイルから復元
   */
  restoreContent: async (tab, context: SessionRestoreContext): Promise<BinaryTab> => {
    const binaryTab = tab as BinaryTab;
    const filePath = binaryTab.path;

    if (!filePath || !context.projectFiles) {
      return binaryTab;
    }

    // projectFiles から対応するファイルを検索
    const correspondingFile = context.projectFiles.find(
      f => toAppPath(f.path) === toAppPath(filePath)
    );

    if (correspondingFile) {
      console.log('[BinaryTabType] ✓ Restored bufferContent for:', filePath);
      return {
        ...binaryTab,
        content: (correspondingFile.content as string) || '',
        bufferContent: correspondingFile.bufferContent,
      };
    }

    console.warn('[BinaryTabType] File not found for bufferContent:', filePath);
    return binaryTab;
  },
};
