// src/hooks/useTabContentRestore.ts
import { useCallback, useEffect, useRef } from 'react';

import { fileRepository } from '@/engine/core/fileRepository';
import { syncManager } from '@/engine/core/syncManager';
import { useTabStore } from '@/stores/tabStore';
import type { DiffTab, EditorTab, Tab } from '@/engine/tabs/types';
import type { EditorPane, FileItem } from '@/types';

// SyncManager イベントの型定義
interface SyncEvent {
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
 * 3. Git操作後にprojectFilesを再読み込みしてFileTreeの表示を最新化
 *
 * 改善点:
 * - 復元を1回だけ確実に実行（重複実行防止）
 * - 復元状態を明示的に追跡
 * - Monaco内部状態の強制同期
 * - Git操作後のprojectFiles再読み込み（タブ再オープン時のstale data問題を解決）
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
                // TypeScript型ガード：needsContentRestoreはEditorTabにのみ存在
                if (!('needsContentRestore' in tab) || !(tab as any).needsContentRestore) return tab;

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
        const updatePaneRecursive = (panes: EditorPane[]): EditorPane[] => {
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
                      isDirty: false, // ファイルが保存されたので、タブを非ダーティ状態にする
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
  }, [isRestored, store.panes, normalizePath]);

  // 3. Git操作後の強制リフレッシュ（git revert, reset, checkout等）
  useEffect(() => {
    if (!isRestored) {
      return;
    }

    const handleSyncStop = (event: SyncEvent) => {
      // fs->db方向の同期（git操作後）のみ処理
      if (event.direction !== 'fs->db' || !event.success) {
        return;
      }

      console.log('[useTabContentRestore] Git operation detected, force refreshing all tabs');

      // 全タブのコンテンツを強制的にリフレッシュ
      // IndexedDBから最新のファイル内容を取得して全タブを更新
      const refreshAllTabs = async () => {
        const flatPanes = flattenPanes(store.panes);
        const allTabs = flatPanes.flatMap(pane => pane.tabs);

        // 各タブのパスからファイルを取得
        const updates = await Promise.all(
          allTabs
            .filter((tab: Tab) => tab.path && (tab.kind === 'editor' || tab.kind === 'diff'))
            .map(async (tab: Tab) => {
              try {
                const file = await fileRepository.getFileByPath(event.projectId, tab.path || '');
                return { tab, file };
              } catch (error) {
                console.warn(
                  `[useTabContentRestore] Failed to refresh tab ${tab.path}:`,
                  error
                );
                return null;
              }
            })
        );

        // ペインを再帰的に更新
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
                const update = updates.find(u => u?.tab.id === tab.id);
                if (update?.file) {
                  console.log('[useTabContentRestore] Force refreshing tab:', tab.path);
                  
                  // Editorタブの更新
                  if (tab.kind === 'editor') {
                    const editorTab = tab as EditorTab;
                    return {
                      ...editorTab,
                      content: update.file.content || '',
                      bufferContent: editorTab.isBufferArray ? update.file.bufferContent : undefined,
                      isDirty: false,
                    } as EditorTab;
                  }
                  
                  // Diffタブの更新（editableなタブのみ）
                  if (tab.kind === 'diff') {
                    const diffTab = tab as DiffTab;
                    if (diffTab.editable && diffTab.diffs && diffTab.diffs.length > 0) {
                      return {
                        ...diffTab,
                        diffs: diffTab.diffs.map((diff, idx) => {
                          // 最初のdiff（通常は1つだけ）のlatterContentを更新
                          if (idx === 0 && update?.file) {
                            return {
                              ...diff,
                              latterContent: update.file.content || '',
                            };
                          }
                          return diff;
                        }),
                        isDirty: false,
                      } as DiffTab;
                    }
                  }
                }
                return tab;
              }),
            };
          });
        };

        store.setPanes(updatePaneRecursive(store.panes));

        // projectFilesを再読み込み（FileTreeが最新の状態を表示できるようにする）
        // これにより、タブを閉じて再度開いた場合でもstaleなデータが使われなくなる
        if (onRefreshProjectFiles) {
          console.log('[useTabContentRestore] Refreshing projectFiles after git operation');
          await onRefreshProjectFiles();
        }

        // Monaco/CodeMirrorの強制再描画をトリガー
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('pyxis-force-monaco-refresh'));
        }, 100);
      };

      refreshAllTabs();
    };

    syncManager.on('sync:stop', handleSyncStop);

    return () => {
      syncManager.off('sync:stop', handleSyncStop);
    };
  }, [isRestored, store, normalizePath, onRefreshProjectFiles]);
}
