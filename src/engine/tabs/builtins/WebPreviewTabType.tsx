// src/engine/tabs/builtins/WebPreviewTabType.tsx
import React from 'react';
import { TabTypeDefinition, WebPreviewTab, TabComponentProps } from '../types';
import WebPreviewTabComponent from '@/components/Tab/WebPreviewTab';

/**
 * Webプレビュータブのコンポーネント
 */
const WebPreviewTabRenderer: React.FC<TabComponentProps> = ({ tab }) => {
  const webTab = tab as WebPreviewTab;

  // タブに保存されたprojectNameを優先、なければcurrentProjectから取得
  const projectName = webTab.projectName;

  return (
    <WebPreviewTabComponent
      filePath={webTab.path}
      currentProjectName={projectName}
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
      projectName: options?.projectName as string | undefined,
    };
  },

  shouldReuseTab: (existingTab, newFile, options) => {
    return existingTab.path === newFile.path && existingTab.kind === 'webPreview';
  },
};
