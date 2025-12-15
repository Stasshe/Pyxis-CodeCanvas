// src/hooks/useTabContentRestore.ts
/**
 * タブコンテンツ復元フック（完全リニューアル版）
 *
 * 【復元フロー】
 * 1. プロジェクトロード/切替時: page.tsx が loadSession() を呼ぶ
 * 2. loadSession完了: tabStore.isRestored = true, ペイン構造復元完了
 * 3. projectFiles読み込み完了を待機
 * 4. 両方揃ったらタブコンテンツを復元 → isContentRestored = true
 * 5. ファイル変更イベントを監視して開いているタブを自動更新
 *
 * 【信頼性向上】
 * - プロジェクト切替時に状態を完全リセット
 * - タイムアウト処理（10秒待ってファイルが来なければ諦める）
 * - 復元の重複実行を確実に防止
 */
import { useCallback, useEffect, useRef } from 'react'

import { fileRepository } from '@/engine/core/fileRepository'
import { useTabStore } from '@/stores/tabStore'
import { useProjectStore } from '@/stores/projectStore'
import type { EditorPane, FileItem } from '@/types'

const RESTORATION_TIMEOUT_MS = 10000 // 10秒

// FileItem[]を平坦化する関数
function flattenFileItems(items: FileItem[]): FileItem[] {
  const result: FileItem[] = []
  function traverse(items: FileItem[]) {
    for (const item of items) {
      result.push(item)
      if (item.children && item.children.length > 0) {
        traverse(item.children)
      }
    }
  }
  traverse(items)
  return result
}

// ペインをフラット化する関数（再帰的に全てのリーフペインを収集）
function flattenPanes(panes: EditorPane[]): EditorPane[] {
  const result: EditorPane[] = []
  function traverse(panes: EditorPane[]) {
    panes.forEach(pane => {
      if (pane.children && pane.children.length > 0) {
        traverse(pane.children)
      } else {
        result.push(pane)
      }
    })
  }
  traverse(panes)
  return result
}

export function useTabContentRestore(projectFiles: FileItem[], isRestored: boolean) {
  const store = useTabStore()
  const currentProjectId = useProjectStore(state => state.currentProjectId)
  
  // 復元状態管理
  const restorationState = useRef({
    completed: false,
    inProgress: false,
    lastProjectId: null as string | null,
    timeoutId: null as NodeJS.Timeout | null,
  })

  // パスを正規化する関数
  const normalizePath = useCallback((p?: string) => {
    if (!p) return ''
    const withoutKindPrefix = p.includes(':') ? p.replace(/^[^:]+:/, '') : p
    const cleaned = withoutKindPrefix.replace(/(-preview|-diff|-ai)$/, '')
    return cleaned.startsWith('/') ? cleaned : `/${cleaned}`
  }, [])

  // 復元完了をマークする共通関数
  const markRestorationComplete = useCallback(() => {
    console.log('[TabContentRestore] ✓ Restoration completed')
    restorationState.current.completed = true
    restorationState.current.inProgress = false
    
    if (restorationState.current.timeoutId) {
      clearTimeout(restorationState.current.timeoutId)
      restorationState.current.timeoutId = null
    }

    store.setIsContentRestored(true)
    store.setIsLoading(false)

    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('pyxis-content-restored'))
      window.dispatchEvent(new CustomEvent('pyxis-force-monaco-refresh'))
    }, 50)
  }, [store])

  // コンテンツ復元を実行する関数
  const performContentRestoration = useCallback(() => {
    const state = restorationState.current

    // 重複実行防止
    if (state.inProgress || state.completed) {
      return
    }

    // IndexedDB復元が完了していなければ待機
    if (!isRestored) {
      console.log('[TabContentRestore] Waiting for IndexedDB restoration...')
      return
    }

    // ペインが存在しない場合は即座に完了
    if (!store.panes.length) {
      console.log('[TabContentRestore] No panes found, marking as completed')
      markRestorationComplete()
      return
    }

    const flatPanes = flattenPanes(store.panes)
    const tabsNeedingRestore = flatPanes.flatMap(pane =>
      pane.tabs.filter((tab: any) => tab.needsContentRestore)
    )

    // 復元が必要なタブがない場合は即座に完了
    if (tabsNeedingRestore.length === 0) {
      console.log('[TabContentRestore] No tabs need restoration, marking as completed')
      markRestorationComplete()
      return
    }

    console.log(`[TabContentRestore] Found ${tabsNeedingRestore.length} tabs needing restoration`)

    // プロジェクトファイルがまだ来ていない場合は待機（タイムアウト設定）
    if (!projectFiles.length) {
      console.log('[TabContentRestore] Waiting for project files...')
      
      // タイムアウト設定（10秒待ってもファイルが来なければ諦める）
      if (!state.timeoutId) {
        state.timeoutId = setTimeout(() => {
          console.warn('[TabContentRestore] Timeout: project files not loaded, marking as completed anyway')
          markRestorationComplete()
        }, RESTORATION_TIMEOUT_MS)
      }
      return
    }

    // 復元開始
    state.inProgress = true
    store.setIsLoading(true)
    console.log('[TabContentRestore] Starting content restoration...')

    const flattenedFiles = flattenFileItems(projectFiles)

    // 非同期で復元実行（Monaco内部状態の同期を確実にするため）
    requestAnimationFrame(() => {
      try {
        const updatePaneRecursive = (panes: EditorPane[]): EditorPane[] => {
          return panes.map(pane => {
            if (pane.children && pane.children.length > 0) {
              return {
                ...pane,
                children: updatePaneRecursive(pane.children),
              }
            }

            // リーフペインの場合、全タブを復元
            return {
              ...pane,
              tabs: pane.tabs.map((tab: any) => {
                if (!tab.needsContentRestore) return tab

                const correspondingFile = flattenedFiles.find(
                  f => normalizePath(f.path) === normalizePath(tab.path)
                )

                if (!correspondingFile) {
                  console.warn(`[TabContentRestore] File not found for tab: ${tab.path}`)
                  // ファイルが見つからない場合でもフラグは解除
                  return {
                    ...tab,
                    needsContentRestore: false,
                  }
                }

                console.log(`[TabContentRestore] ✓ Restored: ${tab.path}`)

                return {
                  ...tab,
                  content: correspondingFile.content || '',
                  bufferContent: tab.isBufferArray ? correspondingFile.bufferContent : undefined,
                  isDirty: false,
                  needsContentRestore: false,
                }
              }),
            }
          })
        }

        store.setPanes(updatePaneRecursive(store.panes))
        markRestorationComplete()
      } catch (error) {
        console.error('[TabContentRestore] Restoration failed:', error)
        // エラーが発生しても完了扱いにする（無限ループ防止）
        markRestorationComplete()
      }
    })
  }, [isRestored, store, projectFiles, normalizePath, markRestorationComplete])

  // プロジェクト切替時に状態をリセット
  useEffect(() => {
    const state = restorationState.current

    if (currentProjectId !== state.lastProjectId) {
      console.log(`[TabContentRestore] Project changed: ${state.lastProjectId} → ${currentProjectId}`)
      
      // タイムアウトをクリア
      if (state.timeoutId) {
        clearTimeout(state.timeoutId)
        state.timeoutId = null
      }

      // 状態を完全リセット
      state.completed = false
      state.inProgress = false
      state.lastProjectId = currentProjectId

      // プロジェクトがnullの場合は復元不要
      if (!currentProjectId) {
        console.log('[TabContentRestore] No project, skipping restoration')
        store.setIsContentRestored(true)
        store.setIsLoading(false)
        return
      }
    }
  }, [currentProjectId, store])

  // isRestored, projectFiles, currentProjectId のいずれかが変わったら復元を試みる
  useEffect(() => {
    performContentRestoration()
  }, [performContentRestoration])

  // ファイル変更イベントのリスニング（復元完了後に有効化）
  useEffect(() => {
    if (!isRestored) {
      return
    }

    console.log('[TabContentRestore] Setting up file change listener')

    const unsubscribe = fileRepository.addChangeListener(event => {
      // 削除イベント: tabStoreに委譲
      if (event.type === 'delete') {
        store.handleFileDeleted(event.file.path)
        return
      }

      // 作成・更新イベントの場合、該当するタブのコンテンツを更新
      if (event.type === 'create' || event.type === 'update') {
        const changedFile = event.file

        // 変更されたファイルのパスに対応するタブがあるかチェック
        const flatPanes = flattenPanes(store.panes)
        const hasMatchingTab = flatPanes.some(pane =>
          pane.tabs.some((tab: any) => normalizePath(tab.path) === normalizePath(changedFile.path))
        )

        if (!hasMatchingTab) {
          return
        }

        console.log(`[TabContentRestore] File changed, updating tab: ${changedFile.path}`)

        // 再帰的にペインを更新
        const updatePaneRecursive = (panes: EditorPane[]): EditorPane[] => {
          return panes.map(pane => {
            if (pane.children && pane.children.length > 0) {
              return {
                ...pane,
                children: updatePaneRecursive(pane.children),
              }
            }
            // リーフペインの場合、該当するタブのコンテンツを更新
            return {
              ...pane,
              tabs: pane.tabs.map((tab: any) => {
                // パスが一致するタブのみ更新
                if (normalizePath(tab.path) === normalizePath(changedFile.path)) {
                  return {
                    ...tab,
                    content: (changedFile as any).content || '',
                    bufferContent: tab.isBufferArray
                      ? (changedFile as any).bufferContent
                      : undefined,
                    isDirty: false,
                  }
                }
                return tab
              }),
            }
          })
        }

        store.setPanes(updatePaneRecursive(store.panes))
      }
    })

    return () => {
      unsubscribe()
    }
  }, [isRestored, normalizePath, store])

  // クリーンアップ: アンマウント時にタイムアウトをクリア
  useEffect(() => {
    return () => {
      if (restorationState.current.timeoutId) {
        clearTimeout(restorationState.current.timeoutId)
      }
    }
  }, [])
}
