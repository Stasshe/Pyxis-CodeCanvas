// src/engine/tabs/builtins/EditorTabType.tsx
import type React from 'react';
import { useCallback, useEffect } from 'react';

import type { EditorTab, TabComponentProps, TabTypeDefinition } from '../types';

import { useGitContext } from '@/components/Pane/PaneContainer';
import CodeEditor from '@/components/Tab/CodeEditor';
import { useSettings } from '@/hooks/state/useSettings';
import { useProjectStore } from '@/stores/projectStore';
import {
  addSaveListener,
  initTabSaveSync,
  setContent as setTabContent,
} from '@/stores/tabState';

/**
 * エディタタブのコンポーネント
 *
 * tabState (Valtio) でコンテンツ・デバウンス保存・タブ間同期を管理。
 */
const EditorTabComponent: React.FC<TabComponentProps> = ({ tab, isActive }) => {
  const editorTab = tab as EditorTab;

  const currentProject = useProjectStore(state => state.currentProject);
  const projectId = currentProject?.id;

  const { settings } = useSettings(projectId);
  const { setGitRefreshTrigger } = useGitContext();

  const wordWrapConfig = settings?.editor?.wordWrap ? 'on' : 'off';

  useEffect(() => {
    initTabSaveSync();
  }, []);

  useEffect(() => {
    if (!editorTab.path) return;
    const unsubscribe = addSaveListener((_path, success) => {
      if (success) setGitRefreshTrigger(prev => prev + 1);
    });
    return unsubscribe;
  }, [editorTab.path, setGitRefreshTrigger]);

  const handleContentChange = useCallback(
    async (_tabId: string, content: string) => {
      if (!editorTab.path) return;
      setTabContent(editorTab.path, content);
    },
    [editorTab.path]
  );

  const handleImmediateContentChange = useCallback(
    (_tabId: string, content: string) => {
      if (!editorTab.path) return;
      setTabContent(editorTab.path, content);
    },
    [editorTab.path]
  );

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
      isActive={isActive}
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
    const tabId = String(file.path || file.name || `editor-${Date.now()}`);
    return {
      id: tabId,
      name: String(file.name || ''),
      kind: 'editor',
      path: String(file.path || ''),
      paneId: options?.paneId || '',
      content: String(file.content || ''),
      isDirty: false,
      isCodeMirror: Boolean(file.isCodeMirror),
      isBufferArray: Boolean(file.isBufferArray),
      bufferContent: file.bufferContent as ArrayBuffer | undefined,
      jumpToLine: options?.jumpToLine,
      jumpToColumn: options?.jumpToColumn,
    };
  },

  shouldReuseTab: (existingTab, newFile, options) => {
    return existingTab.path === newFile.path && existingTab.kind === 'editor';
  },

  updateContent: (tab, content, isDirty) => {
    const editorTab = tab as EditorTab;
    // 変更がない場合は元のタブを返す
    if (editorTab.content === content && editorTab.isDirty === isDirty) {
      return tab;
    }
    return { ...editorTab, content, isDirty };
  },

  getContentPath: tab => {
    return tab.path || undefined;
  },
};
