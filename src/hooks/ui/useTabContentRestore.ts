// src/hooks/useTabContentRestore.ts
/**
 * タブのコンテンツを復元するカスタムフック
 *
 * 責務:
 * - ページリロード時のセッション復帰によるコンテンツ復元
 * - 各タブタイプの restoreContent メソッドを使用
 * - ファイルベースのタブはプロジェクトファイルから復元
 *
 * 注意:
 * - ファイル変更・リアルタイム同期は tabState (Valtio) が担当
 */

import { useCallback, useEffect, useRef } from 'react';
import { snapshot, useSnapshot } from 'valtio';

import { tabRegistry } from '@/engine/tabs/TabRegistry';
import type { SessionRestoreContext, Tab } from '@/engine/tabs/types';
import { getCurrentProjectId } from '@/stores/projectStore';
import { initTabSaveSync, tabActions, tabState } from '@/stores/tabState';
import type { EditorPane, FileItem } from '@/types';

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

// パスを正規化する関数
function normalizePath(p?: string): string {
  if (!p) return '';
  const withoutKindPrefix = p.includes(':') ? p.replace(/^[^:]+:/, '') : p;
  const cleaned = withoutKindPrefix.replace(/(-preview|-diff|-ai)$/, '');
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

/**
 * デフォルトのファイルベース復元
 * タブタイプが restoreContent を実装していない場合に使用
 */
async function defaultFileRestore(
  tab: Tab & { needsContentRestore?: boolean },
  context: SessionRestoreContext
): Promise<Tab> {
  const { projectFiles } = context;
  const flattenedFiles = flattenFileItems(projectFiles as FileItem[]);

  const correspondingFile = flattenedFiles.find(
    f => normalizePath(f.path) === normalizePath(tab.path)
  );

  if (!correspondingFile) {
    console.warn('[useTabContentRestore] File not found for tab:', tab.path);
    return { ...tab, needsContentRestore: false } as any;
  }

  console.log('[useTabContentRestore] ✓ Restored (default):', tab.path);

  return {
    ...tab,
    content: correspondingFile.content || '',
    bufferContent: (tab as any).isBufferArray ? correspondingFile.bufferContent : undefined,
    isDirty: false,
    needsContentRestore: false,
  } as any;
}

/**
 * タブのコンテンツを復元するカスタムフック
 *
 * ページリロード時のセッション復帰によるコンテンツ復元専用。
 * 各タブタイプの restoreContent を使用し、未実装の場合はファイルから復元。
 * ファイル変更・リアルタイム同期は tabState (initTabSaveSync) が担当する。
 */
export function useTabContentRestore(projectFiles: FileItem[], isRestored: boolean) {
  const { panes } = useSnapshot(tabState);
  const restorationCompleted = useRef(false);
  const restorationInProgress = useRef(false);

  // コンテンツ復元を実行する関数（1回だけ確実に実行）
  const performContentRestoration = useCallback(async () => {
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
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('pyxis-content-restored'));
      }, 100);
      return;
    }

    // プロジェクトファイルがまだロードされていない場合は待機
    // ただし、ファイルベースでないタブタイプは projectFiles 不要かもしれない
    // 最低限 isRestored が true になるまで待つ
    restorationInProgress.current = true;
    console.log(
      '[useTabContentRestore] Starting content restoration for',
      tabsNeedingRestore.length,
      'tabs'
    );

    // 復元を非同期で実行（Monaco内部状態の同期を確実にするため）
    requestAnimationFrame(async () => {
      try {
        await initTabSaveSync();

        // 復元コンテキストを準備
        const projectId = getCurrentProjectId();
        const context: SessionRestoreContext = {
          projectFiles: flattenFileItems(projectFiles),
          projectId: projectId || undefined,
        };

        // 全タブを復元（非同期）
        const currentPanes = snapshot(tabState).panes;

        const restoreTabAsync = async (
          tab: Tab & { needsContentRestore?: boolean }
        ): Promise<Tab> => {
          if (!tab.needsContentRestore) return tab;

          const tabDef = tabRegistry.get(tab.kind);

          try {
            // タブタイプが restoreContent を実装している場合はそれを使用
            if (tabDef?.restoreContent) {
              const restored = await tabDef.restoreContent(tab, context);
              console.log(
                '[useTabContentRestore] ✓ Restored (custom):',
                tab.kind,
                tab.path || tab.name
              );
              return { ...restored, needsContentRestore: false } as any;
            }

            // needsSessionRestore === false のタブはそのまま返す
            if (tabDef?.needsSessionRestore === false) {
              return { ...tab, needsContentRestore: false } as any;
            }

            // 拡張機能タブ（まだ登録されていない可能性がある）はそのまま返す
            // 拡張機能タブのデータは既にシリアライズされているため復元不要
            if (tab.kind.startsWith('extension:') && !tabDef) {
              console.log(
                '[useTabContentRestore] Extension tab type not registered yet, preserving data:',
                tab.kind
              );
              return { ...tab, needsContentRestore: false } as any;
            }

            // デフォルト: ファイルベースの復元を試みる（projectFiles がある場合のみ）
            if (projectFiles.length > 0) {
              return await defaultFileRestore(tab, context);
            }

            // projectFiles がない場合は復元スキップ
            console.warn(
              '[useTabContentRestore] No projectFiles, skipping restoration for:',
              tab.path
            );
            return { ...tab, needsContentRestore: false } as any;
          } catch (error) {
            console.error(
              '[useTabContentRestore] Failed to restore tab:',
              tab.kind,
              tab.path,
              error
            );
            return { ...tab, needsContentRestore: false } as any;
          }
        };

        const updatePaneRecursive = async (
          paneList: readonly EditorPane[]
        ): Promise<EditorPane[]> => {
          const results: EditorPane[] = [];

          for (const pane of paneList) {
            if (pane.children && pane.children.length > 0) {
              results.push({
                ...pane,
                children: await updatePaneRecursive(pane.children),
              });
            } else {
              const restoredTabs = await Promise.all(
                pane.tabs.map(tab =>
                  restoreTabAsync(tab as Tab & { needsContentRestore?: boolean })
                )
              );
              results.push({
                ...pane,
                tabs: restoredTabs,
              });
            }
          }

          return results;
        };

        const restoredPanes = await updatePaneRecursive(currentPanes);
        tabActions.setPanes(restoredPanes);

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
        // エラー時も完了イベントを発火してUIローディングを解除
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('pyxis-content-restored'));
        }, 100);
      }
    });
  }, [isRestored, panes, projectFiles]);

  // IndexedDB復元完了後、コンテンツを復元（1回だけ）
  useEffect(() => {
    performContentRestoration();
  }, [performContentRestoration]);

  // ファイル変更・リアルタイム同期は tabState の initTabSaveSync が担当
}
