// src/engine/tabs/builtins/EditorTabType.tsx
import React from 'react';

import { TabTypeDefinition, EditorTab, TabComponentProps } from '../types';

import { useGitContext } from '@/components/PaneContainer';
import CodeEditor from '@/components/Tab/CodeEditor';
import { useProject } from '@/engine/core/project';
import { useSettings } from '@/hooks/useSettings';
import { useTabStore } from '@/stores/tabStore';

/**
 * エディタタブのコンポーネント
 */
const EditorTabComponent: React.FC<TabComponentProps> = ({ tab, isActive }) => {
  const editorTab = tab as EditorTab;
  const { saveFile, currentProject } = useProject();
  const { settings } = useSettings(currentProject?.id);
  const updateTabContent = useTabStore(state => state.updateTabContent);
  const { setGitRefreshTrigger } = useGitContext();

  const wordWrapConfig = settings?.editor?.wordWrap ? 'on' : 'off';

  const handleContentChange = async (tabId: string, content: string) => {
    // 同一パスの全タブに対して即時フラグ（isDirty=true）を立てる
    updateTabContent(tabId, content, true);

    // ファイルを保存
    if (saveFile && editorTab.path) {
      await saveFile(editorTab.path, content);
      // 保存後は全タブの isDirty をクリア
      updateTabContent(tabId, content, false);
      // Git状態を更新
      setGitRefreshTrigger(prev => prev + 1);
    }
  };

  const handleImmediateContentChange = (tabId: string, content: string) => {
    // 即座に同一ファイルを開いている全タブの内容を更新し、isDirty を立てる
    updateTabContent(tabId, content, true);
  };

  return (
    <CodeEditor
      activeTab={editorTab}
      currentProject={currentProject || undefined}
      isCodeMirror={editorTab.isCodeMirror || false}
      bottomPanelHeight={200}
      isBottomPanelVisible={false}
      wordWrapConfig={wordWrapConfig}
      onContentChange={handleContentChange}
      onImmediateContentChange={handleImmediateContentChange}
    />
  );
};

/**
 * エディタタブタイプの定義
 */
export const EditorTabType: TabTypeDefinition = {
  kind: 'editor',
  displayName: 'Editor',
  icon: 'FileText',
  canEdit: true,
  canPreview: false,
  component: EditorTabComponent,

  createTab: (file, options): EditorTab => {
    const tabId = file.path || file.name || `editor-${Date.now()}`;
    return {
      id: tabId,
      name: file.name,
      kind: 'editor',
      path: file.path || '',
      paneId: options?.paneId || '',
      content: file.content || '',
      isDirty: false,
      isCodeMirror: file.isCodeMirror || false,
      isBufferArray: file.isBufferArray || false,
      bufferContent: file.bufferContent,
      jumpToLine: options?.jumpToLine,
      jumpToColumn: options?.jumpToColumn,
    };
  },

  shouldReuseTab: (existingTab, newFile, options) => {
    return existingTab.path === newFile.path && existingTab.kind === 'editor';
  },
};
