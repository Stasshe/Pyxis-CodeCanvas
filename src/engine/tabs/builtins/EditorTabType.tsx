import { useGitContext } from '@/components/Pane/PaneContainer';
import CodeEditor from '@/components/Tab/CodeEditor';
import { useSettings } from '@/hooks/state/useSettings';
import { useProjectSnapshot } from '@/stores/projectStore';
import { setBufferContent, setTabContent } from '@/stores/tabContentStore';
import { addSaveListener, initTabSaveSync, tabActions } from '@/stores/tabState';
// src/engine/tabs/builtins/EditorTabType.tsx
import type React from 'react';
import { useCallback, useEffect } from 'react';
import type { EditorTab, TabComponentProps, TabTypeDefinition } from '../types';

/**
 * エディタタブのコンポーネント
 * EditorMemoryManagerを使用した統一的なメモリ管理システムに対応。
 * - コンテンツ変更はEditorMemoryManagerを通じて行う
 * - デバウンス保存、タブ間同期は自動的に処理される
 * - Git状態更新は保存完了時に自動実行
 */
const EditorTabComponent: React.FC<TabComponentProps> = ({ tab, isActive }) => {
  const editorTab = tab as EditorTab;
  // グローバルストアからプロジェクト情報を取得
  const { currentProject } = useProjectSnapshot();
  const projectId = currentProject?.id;
  const { settings } = useSettings(projectId);
  const { setGitRefreshTrigger } = useGitContext();
  const wordWrapConfig = settings?.editor?.wordWrap ? 'on' : 'off';

  // Initialize save sync once on mount
  useEffect(() => {
    initTabSaveSync();
  }, []);

  // 保存完了時にGit状態を更新
  useEffect(() => {
    if (!editorTab.path) return;
    const unsubscribe = addSaveListener((_savedPath, success) => {
      if (success) setGitRefreshTrigger(prev => prev + 1);
    });
    return unsubscribe;
  }, [editorTab.path, setGitRefreshTrigger]);

  // デバウンス保存付きのコンテンツ変更ハンドラー
  const handleContentChange = useCallback(
    async (tabId: string, content: string) => {
      if (!editorTab.path) return;
      // tabState へ更新 (デバウンス保存は tabState 側でスケジュールされる)
      tabActions.updateTabContent(tabId, content, true);
    },
    [editorTab.path]
  );

  // 即時反映ハンドラー（UIのみ、デバウンス保存をトリガー）
  const handleImmediateContentChange = useCallback(
    (tabId: string, content: string) => {
      if (!editorTab.path) return;
      // tabState へ即時反映
      tabActions.updateTabContent(tabId, content, true);
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
    // Use unique ID to allow same file open in multiple panes independently.
    // Content is keyed by tabId in tabContentStore, so each pane instance
    // must have its own key to avoid content sharing / clearTabContent conflicts.
    const basePath = String(file.path || file.name || 'editor');
    const tabId = `${basePath}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const content = String(file.content || '');
    const bufferContent = file.bufferContent as ArrayBuffer | undefined;
    setTabContent(tabId, content, false);
    if (file.isBufferArray && bufferContent) setBufferContent(tabId, bufferContent);
    return {
      id: tabId,
      name: String(file.name || ''),
      kind: 'editor',
      path: String(file.path || ''),
      paneId: options?.paneId || '',
      content,
      isDirty: false,
      isCodeMirror: Boolean(file.isCodeMirror),
      isBufferArray: Boolean(file.isBufferArray),
      bufferContent,
      jumpToLine: options?.jumpToLine,
      jumpToColumn: options?.jumpToColumn,
    };
  },
  shouldReuseTab: (existingTab, newFile, options) => {
    return existingTab.path === newFile.path && existingTab.kind === 'editor';
  },
  getContentPath: tab => tab.path || undefined,
};
