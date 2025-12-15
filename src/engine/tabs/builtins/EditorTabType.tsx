// src/engine/tabs/builtins/EditorTabType.tsx
import React, { useCallback } from 'react'

import { TabTypeDefinition, EditorTab, TabComponentProps } from '../types'

import { useGitContext } from '@/components/PaneContainer'
import CodeEditor from '@/components/Tab/CodeEditor'
import { fileRepository } from '@/engine/core/fileRepository'
import { useSettings } from '@/hooks/useSettings'
import { useProjectStore } from '@/stores/projectStore'
import { useTabStore } from '@/stores/tabStore'

/**
 * エディタタブのコンポーネント
 *
 * NOTE: NEW-ARCHITECTURE.mdに従い、ファイル操作はfileRepositoryを直接使用。
 * useProject()フックは各コンポーネントで独立した状態を持つため、
 * currentProjectがnullになりファイルが保存されない問題があった。
 * 代わりにグローバルなprojectStoreからプロジェクト情報を取得する。
 */
const EditorTabComponent: React.FC<TabComponentProps> = ({ tab, isActive }) => {
  const editorTab = tab as EditorTab

  // グローバルストアからプロジェクト情報を取得
  const currentProject = useProjectStore(state => state.currentProject)
  const projectId = currentProject?.id

  const { settings } = useSettings(projectId)
  const updateTabContent = useTabStore(state => state.updateTabContent)
  const { setGitRefreshTrigger } = useGitContext()

  const wordWrapConfig = settings?.editor?.wordWrap ? 'on' : 'off'

  const handleContentChange = useCallback(
    async (tabId: string, content: string) => {
      // 同一パスの全タブに対して即時フラグ（isDirty=true）を立てる
      updateTabContent(tabId, content, true)

      // ファイルを保存
      const currentProjectId = projectId
      if (currentProjectId && editorTab.path) {
        try {
          // fileRepositoryを直接使用してファイルを保存（NEW-ARCHITECTURE.mdに従う）
          await fileRepository.saveFileByPath(currentProjectId, editorTab.path, content)
          // 保存後は全タブの isDirty をクリア
          updateTabContent(tabId, content, false)
          // Git状態を更新
          setGitRefreshTrigger(prev => prev + 1)
        } catch (error) {
          console.error('[EditorTabType] Failed to save file:', error)
        }
      }
    },
    [editorTab.path, updateTabContent, setGitRefreshTrigger, projectId]
  )

  const handleImmediateContentChange = useCallback(
    (tabId: string, content: string) => {
      // 即座に同一ファイルを開いている全タブの内容を更新し、isDirty を立てる
      updateTabContent(tabId, content, true)
    },
    [updateTabContent]
  )

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
  )
}

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
    const tabId = file.path || file.name || `editor-${Date.now()}`
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
    }
  },

  shouldReuseTab: (existingTab, newFile, options) => {
    return existingTab.path === newFile.path && existingTab.kind === 'editor'
  },
}
