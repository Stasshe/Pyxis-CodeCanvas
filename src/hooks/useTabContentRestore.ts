// src/hooks/useTabContentRestore.ts
import { useCallback, useEffect, useRef } from 'react';

import { fileRepository } from '@/engine/core/fileRepository';
import { syncManager } from '@/engine/core/syncManager';
import { useTabStore } from '@/stores/tabStore';
import type { Tab, EditorTab } from '@/engine/tabs/types';
import type { EditorPane, FileItem } from '@/types';

// SyncManager sync:stop event type
interface SyncStopEvent {
  projectId: string;
  projectName: string;
  direction: 'db->fs' | 'fs->db' | 'init' | 'single:db->fs';
  success: boolean;
  error?: any;
}

// FileItem[]を平坦化する関数
function flattenFileItems(items: FileItem[]): FileItem[] {
  const result: FileItem[] = [];

  function traverse(items: FileItem[]) {
    for (const item of items) {
      result.push(item);
      if (item.children && item.children.length > 0) {
        traverse(item.children);
      }
    }
  }

  traverse(items);
  return result;
}

// ペインをフラット化する関数（再帰的に全てのリーフペインを収集）
function flattenPanes(panes: EditorPane[]): EditorPane[] {
  const result: EditorPane[] = [];
  function traverse(panes: EditorPane[]) {
    panes.forEach(pane => {
      if (pane.children && pane.children.length > 0) {
        traverse(pane.children);
      } else {
        result.push(pane);
      }
    });
  }
  traverse(panes);
  return result;
}

/**
 * タブのコンテンツを復元するカスタムフック
 *
 * 以下の役割を持つ:
 * 1. IndexedDB復元後、needsContentRestoreフラグがあるタブのコンテンツを確実に復元
 * 2. FileRepositoryからのファイル変更イベントを監視し、開いているタブを自動更新
 * 3. Git操作後にすべてのタブを強制的にリフレッシュ（syncManagerイベント経由）
 * 4. Git操作後にprojectFilesを再読み込み（FileTreeの表示を最新化）
 */
export function useTabContentRestore(
  projectFiles: FileItem[],
  isRestored: boolean,
  onRefreshProjectFiles?: () => Promise<void>
) {
  const store = useTabStore();
  const restorationCompleted = useRef(false);
  const restorationInProgress = useRef(false);

  // パスを正規化する関数
  const normalizePath = useCallback((p?: string) => {
    if (!p) return '';
    const withoutKindPrefix = p.includes(':') ? p.replace(/^[^:]+:/, '') : p;
    const cleaned = withoutKindPrefix.replace(/(-preview|-diff|-ai)$/, '');
    return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
  }, []);

  // コンテンツ復元を実行する関数（1回だけ確実に実行）
  const performContentRestoration = useCallback(() => {
    if (restorationCompleted.current || restorationInProgress.current) {
      return;
    }

    if (!isRestored || !store.panes.length) {
      return;
    }

    const flatPanes = flattenPanes(store.panes);
    const tabsNeedingRestore = flatPanes.flatMap(pane =>
      pane.tabs.filter((tab: any) => tab.needsContentRestore)
    );

    // 復元が不要な場合も完了イベントを発火
    if (tabsNeedingRestore.length === 0) {
      restorationCompleted.current = true;
      console.log('[useTabContentRestore] No tabs need restoration, marking as completed');
      // 完了イベントを発火（復元不要でもUIのローディングを解除するため）
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('pyxis-content-restored'));
      }, 100);
      return;
    }

    // プロジェクトファイルがまだロードされていない場合は待機
    if (!projectFiles.length) {
      return;
    }

    restorationInProgress.current = true;
    console.log(
      '[useTabContentRestore] Starting content restoration for',
      tabsNeedingRestore.length,
      'tabs'
    );

    const flattenedFiles = flattenFileItems(projectFiles);

    // 復元を非同期で実行（Monaco内部状態の同期を確実にするため）
    requestAnimationFrame(() => {
      try {
        const updatePaneRecursive = (panes: EditorPane[]): EditorPane[] => {
          return panes.map(pane => {
            if (pane.children && pane.children.length > 0) {
              return {
                ...pane,
                children: updatePaneRecursive(pane.children),
              };
            }

            // リーフペインの場合、全タブを復元
            return {
              ...pane,
              tabs: pane.tabs.map((tab: Tab) => {
                // TypeScript型ガード: needsContentRestoreはEditorTabにのみ存在
                const isEditorWithRestore = tab.kind === 'editor' && 'needsContentRestore' in tab && 
                  (tab as EditorTab & { needsContentRestore?: boolean }).needsContentRestore;
                
                if (!isEditorWithRestore) return tab;

                const correspondingFile = flattenedFiles.find(
                  f => normalizePath(f.path) === normalizePath(tab.path)
                );

                if (!correspondingFile) {
                  console.warn('[useTabContentRestore] File not found for tab:', tab.path);
                  // ファイルが見つからない場合でもフラグは解除
                  if (tab.kind === 'editor') {
                    return {
                      ...tab,
                      needsContentRestore: false,
                    } as EditorTab;
                  }
                  return tab;
                }

                console.log('[useTabContentRestore] ✓ Restored:', tab.path);

                if (tab.kind === 'editor') {
                  const editorTab = tab as EditorTab;
                  return {
                    ...editorTab,
                    content: correspondingFile.content || '',
                    bufferContent: editorTab.isBufferArray ? correspondingFile.bufferContent : undefined,
                    isDirty: false,
                    needsContentRestore: false,
                  } as EditorTab;
                }
                
                return tab;
              }),
            };
          });
        };

        store.setPanes(updatePaneRecursive(store.panes));

        // 復元完了をマーク
        restorationCompleted.current = true;
        restorationInProgress.current = false;
        console.log('[useTabContentRestore] Content restoration completed successfully');

        // Monaco強制再描画イベントを発火（100ms後）
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('pyxis-force-monaco-refresh'));
          // コンテンツ復元完了イベントも発火
          window.dispatchEvent(new CustomEvent('pyxis-content-restored'));
        }, 100);
      } catch (error) {
        console.error('[useTabContentRestore] Restoration failed:', error);
        restorationInProgress.current = false;
        // 失敗してもフラグは立てる（無限ループ防止）
        restorationCompleted.current = true;
      }
    });
  }, [isRestored, store, projectFiles, normalizePath]);

  // 1. IndexedDB復元完了後、コンテンツを復元（1回だけ）
  useEffect(() => {
    performContentRestoration();
  }, [performContentRestoration]);

  // 2. ファイル変更イベントのリスニング
  useEffect(() => {
    if (!isRestored) {
      return;
    }

    const unsubscribe = fileRepository.addChangeListener(event => {
      // 削除イベント: tabStoreに委譲
      if (event.type === 'delete') {
        store.handleFileDeleted(event.file.path);
        return;
      }

      // 作成・更新イベントの場合、該当するタブのコンテンツを更新
      if (event.type === 'create' || event.type === 'update') {
        const changedFile = event.file;

        // 変更されたファイルのパスに対応するタブがあるかチェック
        const flatPanes = flattenPanes(store.panes);
        const hasMatchingTab = flatPanes.some(pane =>
          pane.tabs.some((tab: Tab) => normalizePath(tab.path) === normalizePath(changedFile.path))
        );

        if (!hasMatchingTab) {
          return; // No matching tabs, return unchanged
        }

        console.log('[useTabContentRestore] Updating tab content for:', changedFile.path);

        // 再帰的にペインを更新（devブランチと同じ）
        const updatePaneRecursive = (panes: EditorPane[]): EditorPane[]=> {
          return panes.map(pane => {
            if (pane.children && pane.children.length > 0) {
              return {
                ...pane,
                children: updatePaneRecursive(pane.children),
              };
            }
            // リーフペインの場合、該当するタブのコンテンツを更新
            return {
              ...pane,
              tabs: pane.tabs.map((tab: Tab) => {
                // パスが一致するタブのみ更新
                if (normalizePath(tab.path) === normalizePath(changedFile.path)) {
                  console.log('[useTabContentRestore] Updating tab:', tab.id);
                  
                  if (tab.kind === 'editor') {
                    const editorTab = tab as EditorTab;
                    return {
                      ...editorTab,
                      content: (changedFile as any).content || '',
                      bufferContent: editorTab.isBufferArray
                        ? (changedFile as any).bufferContent
                        : undefined,
                      isDirty: false,
                    } as EditorTab;
                  }
                }
                return tab;
              }),
            };
          });
        };

        store.setPanes(updatePaneRecursive(store.panes));
      }
    });

    return () => {
      unsubscribe();
    };
  }, [isRestored, normalizePath]);

  // 3. Git操作完了後の強制タブ更新
  useEffect(() => {
    if (!isRestored) {
      return;
    }

    const handleSyncStop = async (event: SyncStopEvent) => {
      // fs->db方向の同期（git操作後）のみ処理
      if (event.direction !== 'fs->db' || !event.success) {
        return;
      }

      console.log('[useTabContentRestore] Git operation completed, force refreshing all open tabs');

      try {
        // 全ての開いているタブを取得
        const flatPanes = flattenPanes(store.panes);
        const allTabs = flatPanes.flatMap(pane => pane.tabs);
        const editorTabs = allTabs.filter((tab: Tab): tab is EditorTab => 
          tab.kind === 'editor' && !!tab.path
        );

        if (editorTabs.length === 0) {
          console.log('[useTabContentRestore] No editor tabs to refresh');
          return;
        }

        // IndexedDBから最新のファイル内容を一括取得
        console.log('[useTabContentRestore] Fetching latest content for', editorTabs.length, 'tabs');
        const fileUpdates = await Promise.all(
          editorTabs.map(async (tab: EditorTab) => {
            try {
              const file = await fileRepository.getFileByPath(event.projectId, tab.path || '');
              return { tabId: tab.id, path: tab.path, content: file.content || '', success: true };
            } catch (error) {
              console.warn('[useTabContentRestore] Failed to fetch file:', tab.path, error);
              return { tabId: tab.id, path: tab.path, content: '', success: false };
            }
          })
        );

        // 成功したファイル更新のみをMapに格納
        const contentMap = new Map<string, string>();
        fileUpdates.forEach(update => {
          if (update.success) {
            contentMap.set(update.tabId, update.content);
          }
        });

        if (contentMap.size === 0) {
          console.warn('[useTabContentRestore] No files were successfully fetched');
          return;
        }

        console.log('[useTabContentRestore] Successfully fetched', contentMap.size, 'files, updating tabs...');

        // 全ペインを一括更新
        const updatePaneRecursive = (panes: EditorPane[]): EditorPane[] => {
          return panes.map(pane => {
            if (pane.children && pane.children.length > 0) {
              return {
                ...pane,
                children: updatePaneRecursive(pane.children),
              };
            }

            // リーフペインの場合、タブを更新
            return {
              ...pane,
              tabs: pane.tabs.map((tab: Tab) => {
                const newContent = contentMap.get(tab.id);
                if (newContent !== undefined && tab.kind === 'editor') {
                  console.log('[useTabContentRestore] Updating tab:', tab.path);
                  return {
                    ...tab,
                    content: newContent,
                    isDirty: false,
                  } as EditorTab;
                }
                return tab;
              }),
            };
          });
        };

        store.setPanes(updatePaneRecursive(store.panes));

        // projectFilesを再読み込み（FileTreeの表示を最新化、タブ再オープン時のstale data防止）
        if (onRefreshProjectFiles) {
          console.log('[useTabContentRestore] Refreshing projectFiles...');
          await onRefreshProjectFiles();
          console.log('[useTabContentRestore] ProjectFiles refreshed');
        }

        // Monaco/CodeMirrorに強制再描画を指示
        console.log('[useTabContentRestore] Dispatching force refresh event');
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('pyxis-force-monaco-refresh'));
        }, 100);

      } catch (error) {
        console.error('[useTabContentRestore] Git operation tab refresh failed:', error);
      }
    };

    syncManager.on('sync:stop', handleSyncStop);

    return () => {
      syncManager.off('sync:stop', handleSyncStop);
    };
  }, [isRestored, normalizePath, onRefreshProjectFiles]);
}
