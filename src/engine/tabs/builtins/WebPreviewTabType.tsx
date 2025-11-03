// src/engine/tabs/builtins/WebPreviewTabType.tsx
import React from 'react';
import { TabTypeDefinition, WebPreviewTab, TabComponentProps } from '../types';
import WebPreviewTabComponent from '@/components/Tab/WebPreviewTab';

/**
 * Webプレビュータブのコンポーネント
 */
const WebPreviewTabRenderer: React.FC<TabComponentProps> = ({ tab }) => {
  const webTab = tab as WebPreviewTab;

  return (
    <WebPreviewTabComponent
      filePath={webTab.path}
      currentProjectName={undefined} // プロジェクト名はコンテキストから取得
    />
  );
};

/**
 * Webプレビュータブタイプの定義
 */
export const WebPreviewTabType: TabTypeDefinition = {
  kind: 'webPreview',
  displayName: 'Web Preview',
  icon: 'Globe',
  canEdit: false,
  canPreview: true,
  component: WebPreviewTabRenderer,
  
  createTab: (file, options): WebPreviewTab => {
    const tabId = `webPreview:${file.path || file.name || Date.now()}`;
    return {
      id: tabId,
      name: `Preview: ${file.name}`,
      kind: 'webPreview',
      path: file.path || '',
      paneId: options?.paneId || '',
      url: options?.webPreviewUrl,
    };
  },
  
  shouldReuseTab: (existingTab, newFile, options) => {
    return existingTab.path === newFile.path && existingTab.kind === 'webPreview';
  },
};
