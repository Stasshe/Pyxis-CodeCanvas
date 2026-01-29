// src/engine/tabs/builtins/BinaryTabType.tsx
import type React from 'react';

import type { BinaryTab, OpenTabOptions, TabComponentProps, TabTypeDefinition } from '../types';

import BinaryTabContent from '@/components/Tab/BinaryTabContent';
import { guessMimeType } from '@/components/Tab/text-editor/editors/editor-utils';
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
      // bufferContent が ArrayBuffer 等であるか
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
};
