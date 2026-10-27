import type React from 'react';
import WebPreviewTabComponent from '@/components/preview/WebPreviewTab';
import { tabActions } from '@/stores/tabState';
import type {
  TabComponentProps,
  TabTypeDefinition,
  WebPreviewTab,
} from '../../../engine/ide/tabs/types';

/**
 * Webプレビュータブのコンポーネント
 */
const WebPreviewTabRenderer: React.FC<TabComponentProps> = ({ tab }) => {
  const webTab = tab as WebPreviewTab;

  return (
    <WebPreviewTabComponent
      filePath={webTab.path}
      onTitleChange={title => {
        if (webTab.name === title) return;
        tabActions.updateTab(webTab.paneId, webTab.id, { name: title });
      }}
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
  needsSessionRestore: false,

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
    };
  },

  shouldReuseTab: (existingTab, newFile, options) => {
    return existingTab.path === newFile.path && existingTab.kind === 'webPreview';
  },
};
