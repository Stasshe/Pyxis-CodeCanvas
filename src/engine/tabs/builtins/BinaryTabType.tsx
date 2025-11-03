// src/engine/tabs/builtins/BinaryTabType.tsx
import React from 'react';
import { TabTypeDefinition, TabComponentProps, OpenTabOptions, BinaryTab } from '../types';
import BinaryTabContent from '@/components/Tab/BinaryTabContent';
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
      guessMimeType={() => ''}
      isBufferArray={() => false}
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
      bufferContent: (fileItem as any).bufferContent,
      type: fileItem.type,
    } as BinaryTab;
  },

  component: BinaryTabComponent,
};
