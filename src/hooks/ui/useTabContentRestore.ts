// src/hooks/useTabContentRestore.ts
/**
 * タブのコンテンツを復元するカスタムフック
 *
 * 責務:
 * - ページリロード時のセッション復帰によるコンテンツ復元に徹する
 * - IndexedDB復元後、needsContentRestoreフラグがあるタブのコンテンツを復元
 *
 * 注意:
 * - ファイル変更・リアルタイム同期は tabState (Valtio) が担当
 */

import { useCallback, useEffect, useRef } from 'react';
import { useSnapshot } from 'valtio';

import { initTabSaveSync, tabActions, tabState } from '@/stores/tabState';
import type { EditorPane, FileItem } from '@/types';
import { snapshot } from 'valtio';

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
function flattenPanes(panes: readonly EditorPane[]): EditorPane[] {
  const result: EditorPane[] = [];
  function traverse(panes: readonly EditorPane[]) {
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
 * ページリロード時のセッション復帰によるコンテンツ復元専用。
 * ファイル変更・リアルタイム同期は tabState (initTabSaveSync) が担当する。
 */
export function useTabContentRestore(projectFiles: FileItem[], isRestored: boolean) {
  const { panes } = useSnapshot(tabState);
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

    if (!isRestored || panes.length === 0) {
      return;
    }

    const flatPanes = flattenPanes(panes);
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
    requestAnimationFrame(async () => {
      try {
        await initTabSaveSync();

        const updatePaneRecursive = (paneList: readonly EditorPane[]): EditorPane[] => {
          return paneList.map(pane => {
            if (pane.children && pane.children.length > 0) {
              return {
                ...pane,
                children: updatePaneRecursive(pane.children),
              };
            }

            return {
              ...pane,
              tabs: pane.tabs.map((tab: any) => {
                if (!tab.needsContentRestore) return tab;

                const correspondingFile = flattenedFiles.find(
                  f => normalizePath(f.path) === normalizePath(tab.path)
                );

                if (!correspondingFile) {
                  console.warn('[useTabContentRestore] File not found for tab:', tab.path);
                  return { ...tab, needsContentRestore: false };
                }

                const restoredContent = correspondingFile.content || '';
                console.log('[useTabContentRestore] ✓ Restored:', tab.path);

                return {
                  ...tab,
                  content: restoredContent,
                  bufferContent: tab.isBufferArray ? correspondingFile.bufferContent : undefined,
                  isDirty: false,
                  needsContentRestore: false,
                };
              }),
            };
          });
        };

        tabActions.setPanes(updatePaneRecursive(snapshot(tabState).panes));

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
  }, [isRestored, projectFiles, normalizePath]);

  // IndexedDB復元完了後、コンテンツを復元（1回だけ）
  useEffect(() => {
    performContentRestoration();
  }, [performContentRestoration]);

  // ファイル変更・リアルタイム同期は tabState の initTabSaveSync が担当
}
