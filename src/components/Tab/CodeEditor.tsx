/**
 * CodeEditor_new.tsx - リファクタリング版エディターコンポーネント
 *
 * 責務:
 * - タブの状態判定とルーティング（Monaco/CodeMirror/プレビュー/バイナリ/Welcome）
 * - デバウンス保存の制御
 * - エディター間の共通インターフェース提供
 *
 * 保持された機能:
 * - jumpToLine/jumpToColumn
 * - ブレークポイント管理
 * - 文字数カウント
 * - デバウンス保存
 * - モデル管理とundo/redo履歴
 *
 * 改善点:
 * - コンテンツ復元中はエディターをブロック（データ不整合防止）
 * - 復元完了後に確実にエディターを再描画
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import CodeMirrorEditor from './text-editor/editors/CodeMirrorEditor'
import MonacoEditor from './text-editor/editors/MonacoEditor'
import { useCharCount } from './text-editor/hooks/useCharCount'
import CharCountDisplay from './text-editor/ui/CharCountDisplay'
import EditorPlaceholder from './text-editor/ui/EditorPlaceholder'

import type { EditorTab } from '@/engine/tabs/types'
import { useKeyBinding } from '@/hooks/useKeyBindings'
import { useSettings } from '@/hooks/useSettings'
import { useTabStore } from '@/stores/tabStore'
import type { Project } from '@/types'

interface CodeEditorProps {
  activeTab: EditorTab | undefined
  bottomPanelHeight: number
  isBottomPanelVisible: boolean
  onContentChange: (tabId: string, content: string) => void
  wordWrapConfig: 'on' | 'off'
  nodeRuntimeOperationInProgress?: boolean
  currentProject?: Project
  isCodeMirror?: boolean
  // 即時ローカル編集反映ハンドラ: 全ペーンの同ファイルタブに対して isDirty を立てる
  onImmediateContentChange?: (tabId: string, content: string) => void
  // タブがアクティブかどうか（フォーカス制御用）
  isActive?: boolean
}

export default function CodeEditor({
  activeTab,
  onContentChange,
  nodeRuntimeOperationInProgress = false,
  isCodeMirror = false,
  onImmediateContentChange,
  currentProject,
  wordWrapConfig,
  isActive = false,
}: CodeEditorProps) {
  // プロジェクトIDは優先的に props の currentProject?.id を使い、なければ activeTab の projectId を参照
  const projectId =
    currentProject?.id ||
    (activeTab && 'projectId' in activeTab ? (activeTab as any).projectId : undefined)
  const { settings, updateSettings } = useSettings(projectId)
  const { isContentRestored } = useTabStore()
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // コンテンツ復元中かどうかを判定
  const isRestoringContent =
    activeTab &&
    'needsContentRestore' in activeTab &&
    (activeTab as any).needsContentRestore &&
    !isContentRestored

  const {
    charCount,
    setCharCount,
    selectionCount,
    setSelectionCount,
    showCharCountPopup,
    setShowCharCountPopup,
  } = useCharCount(activeTab?.content)

  const editorHeight = '100%'

  // Mobile / touch device 判定: ポインタが coarse、または画面幅が小さい、または navigator.maxTouchPoints をチェック
  const [isMobileDevice, setIsMobileDevice] = useState(false)
  useEffect(() => {
    const updateIsMobile = () => {
      try {
        const hasTouchPoints =
          typeof navigator !== 'undefined' &&
          'maxTouchPoints' in navigator &&
          (navigator.maxTouchPoints || 0) > 0
        const mqPointer =
          typeof window !== 'undefined' && window.matchMedia
            ? window.matchMedia('(pointer: coarse)')
            : null
        const mqWidth =
          typeof window !== 'undefined' && window.matchMedia
            ? window.matchMedia('(max-width: 640px)')
            : null
        const isMobile =
          !!hasTouchPoints || (!!mqPointer && mqPointer.matches) || (!!mqWidth && mqWidth.matches)
        setIsMobileDevice(isMobile)
      } catch (e) {
        setIsMobileDevice(false)
      }
    }

    updateIsMobile()

    const mqPointer =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(pointer: coarse)')
        : null
    const mqWidth =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(max-width: 640px)')
        : null

    mqPointer?.addEventListener?.('change', updateIsMobile)
    mqWidth?.addEventListener?.('change', updateIsMobile)

    return () => {
      mqPointer?.removeEventListener?.('change', updateIsMobile)
      mqWidth?.removeEventListener?.('change', updateIsMobile)
    }
  }, [])

  // デバウンス付きの保存関数（5秒）
  const debouncedSave = useCallback(
    (tabId: string, content: string) => {
      if (nodeRuntimeOperationInProgress) {
        console.log('[CodeEditor_new] Skipping debounced save during NodeRuntime operation')
        return
      }

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      const currentTabId = tabId
      const currentContent = content

      // One-shot: schedule single save after debounce interval. No retries.
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          console.log('[CodeEditor_new] Debounced save triggered for:', currentTabId)
          await onContentChange(currentTabId, currentContent)
        } catch (e) {
          console.error('[CodeEditor_new] Debounced save failed:', e)
        }
      }, 5000)
    },
    [onContentChange, nodeRuntimeOperationInProgress]
  )

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  // エディター変更ハンドラー（デバウンス保存のみ）
  // [REMOVED] onContentChangeImmediate - fileRepositoryのイベントシステムで自動更新
  // ユーザー入力時はデバウンス保存のみ行い、タブの更新はfileRepository.emitChangeに任せる
  const handleEditorChange = useCallback(
    (value: string) => {
      if (!activeTab) return
      // 即時フラグ反映（isDirty を全ペーンに立てる）
      try {
        onImmediateContentChange?.(activeTab.id, value)
      } catch (e) {
        // 保険: 何か例外が起きても保存は続行する
        console.error('[CodeEditor_new] onImmediateContentChange handler failed', e)
      }

      // デバウンス保存のみ実行
      debouncedSave(activeTab.id, value)
    },
    [activeTab, debouncedSave, onImmediateContentChange]
  )

  // Ctrl+S 等のキーボードショートカットで即時保存するハンドラを登録
  // 意図: デバウンスによる遅延保存とは別に、ユーザーが明示的に保存を要求したら即時に保存を行う
  useKeyBinding(
    'saveFile',
    async () => {
      if (!activeTab) return
      // コンテンツ復元中やランタイム操作中は保存を無視
      if (isRestoringContent) return
      if (nodeRuntimeOperationInProgress) {
        console.log('[CodeEditor] Save skipped during NodeRuntime operation')
        return
      }

      // 既存のデバウンスタイマーをクリアして即時保存
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        // @ts-ignore - NodeJS.Timeout 型 とブラウザのタイマー型の差を無視
        saveTimeoutRef.current = null
      }

      try {
        await onContentChange(activeTab.id, activeTab.content)
      } catch (e) {
        console.error('[CodeEditor] Immediate save failed:', e)
      }
    },
    // 依存: アクティブタブやコンテンツ、状態フラグ
    [
      activeTab?.id,
      activeTab?.content,
      isRestoringContent,
      nodeRuntimeOperationInProgress,
      onContentChange,
    ]
  )

  // 折り返しのトグルショートカット登録 (Alt+Z)
  useKeyBinding(
    'toggleWordWrap',
    async () => {
      if (!projectId || !updateSettings) return
      const current = settings?.editor?.wordWrap ?? false
      try {
        await updateSettings(prev => ({
          editor: {
            ...(prev?.editor || {}),
            wordWrap: !current,
          },
        }))
      } catch (e) {
        console.error('[CodeEditor] toggleWordWrap failed:', e)
      }
    },
    [projectId, settings?.editor?.wordWrap, updateSettings]
  )

  // === タブなし ===
  if (!activeTab) {
    return <EditorPlaceholder type="no-tab" />
  }

  // === コンテンツ復元中 ===
  if (isRestoringContent) {
    return (
      <div
        className="flex-1 min-h-0 relative flex items-center justify-center"
        style={{ height: editorHeight }}
      >
        <div className="text-muted-foreground">Restoring content...</div>
      </div>
    )
  }

  // === CodeMirrorエディター ===
  if (isCodeMirror) {
    return (
      <div className="flex-1 min-h-0 relative" style={{ height: editorHeight }}>
        <CodeMirrorEditor
          tabId={activeTab.id}
          fileName={activeTab.name}
          content={activeTab.content}
          onChange={handleEditorChange}
          onSelectionChange={setSelectionCount}
          tabSize={settings?.editor.tabSize ?? 2}
          insertSpaces={settings?.editor.insertSpaces ?? true}
          fontSize={settings?.editor.fontSize ?? 14}
          isActive={isActive}
        />
        <CharCountDisplay
          charCount={charCount}
          selectionCount={selectionCount}
          showCharCountPopup={showCharCountPopup}
          onTogglePopup={() => setShowCharCountPopup(v => !v)}
          onClosePopup={() => setShowCharCountPopup(false)}
          content={activeTab.content || ''}
          alignLeft={isMobileDevice}
        />
      </div>
    )
  }

  // === Monaco Editorエディター（デフォルト）===
  return (
    <div className="flex-1 min-h-0 relative" style={{ height: editorHeight }}>
      <MonacoEditor
        tabId={activeTab.id}
        fileName={activeTab.name}
        content={activeTab.content}
        wordWrapConfig={wordWrapConfig}
        jumpToLine={activeTab.jumpToLine}
        jumpToColumn={activeTab.jumpToColumn}
        onChange={handleEditorChange}
        onCharCountChange={setCharCount}
        onSelectionCountChange={setSelectionCount}
        tabSize={settings?.editor.tabSize ?? 2}
        insertSpaces={settings?.editor.insertSpaces ?? true}
        fontSize={settings?.editor.fontSize ?? 14}
        isActive={isActive}
      />
      <CharCountDisplay
        charCount={charCount}
        selectionCount={selectionCount}
        showCharCountPopup={showCharCountPopup}
        onTogglePopup={() => setShowCharCountPopup(v => !v)}
        onClosePopup={() => setShowCharCountPopup(false)}
        content={activeTab.content || ''}
        alignLeft={isMobileDevice}
      />
    </div>
  )
}
