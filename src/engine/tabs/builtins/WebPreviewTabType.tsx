// src/engine/tabs/builtins/WebPreviewTabType.tsx
import type React from 'react';

import type { TabComponentProps, TabTypeDefinition, WebPreviewTab } from '../types';

import WebPreviewTabComponent from '@/components/Tab/WebPreviewTab';

/**
 * Webプレビュータブのコンポーネント
 */
const WebPreviewTabRenderer: React.FC<TabComponentProps> = ({ tab }) => {
  const webTab = tab as WebPreviewTab;

  // タブに保存されたprojectNameを優先、なければcurrentProjectから取得
  const projectName = webTab.projectName;

  return <WebPreviewTabComponent filePath={webTab.path} currentProjectName={projectName} />;
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
  needsSessionRestore: false, // WebPreviewはprojectNameさえあれば復元可能

  createTab: (file, options): WebPreviewTab => {
    const filePath = String(file.path || file.name || Date.now());
    const tabId = `webPreview:${filePath}`;
    return {
      id: tabId,
      name: `Preview: ${String(file.name || '')}`,
      kind: 'webPreview',
      path: String(file.path || ''),
      paneId: options?.paneId || '',
      url: options?.webPreviewUrl,
      projectName: options?.projectName as string | undefined,
    };
  },

  shouldReuseTab: (existingTab, newFile, options) => {
    return existingTab.path === newFile.path && existingTab.kind === 'webPreview';
  },

  // projectName はシリアライズ時に保持されるべき（デフォルト動作で保持される）
};
