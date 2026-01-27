// src/engine/tabs/builtins/EditorTabType.tsx

import type React from 'react';

import { useCallback, useEffect } from 'react';



import type { EditorTab, TabComponentProps, TabTypeDefinition } from '../types';



import { useGitContext } from '@/components/Pane/PaneContainer';

import CodeEditor from '@/components/Tab/CodeEditor';

import { editorMemoryManager } from '@/engine/editor';

import { useSettings } from '@/hooks/state/useSettings';

import { useProjectStore } from '@/stores/projectStore';



/**

 * エディタタブのコンポーネント

 *

 * EditorMemoryManagerを使用した統一的なメモリ管理システムに対応。

 * - コンテンツ変更はEditorMemoryManagerを通じて行う

 * - デバウンス保存、タブ間同期は自動的に処理される

 * - Git状態更新は保存完了時に自動実行

 */

const EditorTabComponent: React.FC<TabComponentProps> = ({ tab, isActive }) => {

  const editorTab = tab as EditorTab;



  // グローバルストアからプロジェクト情報を取得

  const currentProject = useProjectStore(state => state.currentProject);

  const projectId = currentProject?.id;



  const { settings } = useSettings(projectId);

  const { setGitRefreshTrigger } = useGitContext();



  const wordWrapConfig = settings?.editor?.wordWrap ? 'on' : 'off';



  // EditorMemoryManagerを初期化し、初期コンテンツを登録

  useEffect(() => {

    const initMemory = async () => {

      await editorMemoryManager.init();

      if (editorTab.path && editorTab.content !== undefined) {

        editorMemoryManager.registerInitialContent(editorTab.path, editorTab.content);

      }

    };

    initMemory();

  }, [editorTab.path, editorTab.content]);



  // 保存完了時にGit状態を更新

  useEffect(() => {

    if (!editorTab.path) return;



    const unsubscribe = editorMemoryManager.addSaveListener((savedPath, success) => {

      if (success) {

        setGitRefreshTrigger(prev => prev + 1);

      }

    });



    return unsubscribe;

  }, [editorTab.path, setGitRefreshTrigger]);



  // デバウンス保存付きのコンテンツ変更ハンドラー

  const handleContentChange = useCallback(

    async (tabId: string, content: string) => {

      if (!editorTab.path) return;

      // EditorMemoryManagerを通じてコンテンツを更新

      // デバウンス保存、タブ間同期は自動的に処理される

      editorMemoryManager.setContent(editorTab.path, content);

    },

    [editorTab.path]

  );



  // 即時反映ハンドラー（UIのみ、デバウンス保存をトリガー）

  const handleImmediateContentChange = useCallback(

    (tabId: string, content: string) => {

      if (!editorTab.path) return;

      // EditorMemoryManagerを通じて即時反映

      editorMemoryManager.setContent(editorTab.path, content);

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

