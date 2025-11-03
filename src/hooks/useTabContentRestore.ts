// src/hooks/useTabContentRestore.ts
import { useEffect, useRef } from 'react';
import { useTabStore } from '@/stores/tabStore';
import { fileRepository } from '@/engine/core/fileRepository';
import { FileItem } from '@/types';

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

/**
 * タブのコンテンツを復元するカスタムフック
 *
 * 以下の2つの役割を持つ:
 * 1. localStorage復元後、needsContentRestoreフラグがあるタブのコンテンツを復元
 * 2. FileRepositoryからのファイル変更イベントを監視し、開いているタブを自動更新
 */
export function useTabContentRestore(projectFiles: FileItem[]) {
  const store = useTabStore();

  // パスを正規化する関数
  const normalizePath = (p?: string) => {
    if (!p) return '';
    const withoutKindPrefix = p.includes(':') ? p.replace(/^[^:]+:/, '') : p;
    const cleaned = withoutKindPrefix.replace(/(-preview|-diff|-ai)$/, '');
    return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
  };

  // 1. projectFilesが読み込まれるたびに、needsContentRestoreフラグのあるタブを復元
  // IndexedDBの読み込み完了を待つため、projectFiles.lengthを監視
  useEffect(() => {
    if (projectFiles.length === 0) {
      console.log('[useTabContentRestore] Waiting for projectFiles to load...');
      return;
    }

    // ペインの全タブからneedsContentRestoreのものを収集
    const collectTabsNeedingRestore = (panes: any[]): Array<{ paneId: string; tab: any }> => {
      const result: Array<{ paneId: string; tab: any }> = [];
      const traverse = (panes: any[]) => {
        panes.forEach(pane => {
          if (pane.children && pane.children.length > 0) {
            traverse(pane.children);
          } else {
            // リーフペインのタブを収集
            pane.tabs.forEach((tab: any) => {
              if (tab.needsContentRestore) {
                result.push({ paneId: pane.id, tab });
              }
            });
          }
        });
      };
      traverse(panes);
      return result;
    };

    const tabsNeedingRestore = collectTabsNeedingRestore(store.panes);

    if (tabsNeedingRestore.length === 0) {
      return;
    }

    console.log('[useTabContentRestore] Restoring content for', tabsNeedingRestore.length, 'tabs');
    const flattenedFiles = flattenFileItems(projectFiles);

    tabsNeedingRestore.forEach(({ paneId, tab }) => {
      const correspondingFile = flattenedFiles.find(
        f => normalizePath(f.path) === normalizePath(tab.path)
      );

      if (correspondingFile) {
        console.log('[useTabContentRestore] Restoring:', tab.path);
        store.updateTab(paneId, tab.id, {
          content: correspondingFile.content || '',
          bufferContent: tab.isBufferArray ? correspondingFile.bufferContent : undefined,
          isDirty: false,
          needsContentRestore: false,
        } as any);
      } else {
        console.warn('[useTabContentRestore] File not found for tab:', tab.path);
      }
    });
  }, [projectFiles.length, store.panes.length]);

  // 2. ファイル変更イベントのリスニング
  useEffect(() => {
    const unsubscribe = fileRepository.addChangeListener(event => {
      console.log('[useTabContentRestore] File change event:', event);

      // 削除イベントはスキップ（TabBarで処理）
      if (event.type === 'delete') {
        return;
      }

      // 作成・更新イベントの場合、該当するタブのコンテンツを更新
      if (event.type === 'create' || event.type === 'update') {
        const changedFile = event.file;
        const allTabs = store.getAllTabs();

        // 変更されたファイルに対応するタブを検索
        const matchingTab = allTabs.find(
          (tab: any) => normalizePath(tab.path) === normalizePath(changedFile.path)
        );

        if (!matchingTab) {
          return; // 対応するタブがない
        }

        // タブが属するペインを検索
        const result = store.findTabByPath(changedFile.path);
        if (!result) return;

        const { paneId, tab } = result;

        console.log('[useTabContentRestore] Updating tab content for:', changedFile.path);

        // タブのコンテンツを更新
        store.updateTab(paneId, tab.id, {
          content: (changedFile as any).content || '',
          bufferContent: (tab as any).isBufferArray
            ? (changedFile as any).bufferContent
            : undefined,
          isDirty: false, // ファイルが保存されたので非ダーティ状態に
        } as any);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []); // 空配列: マウント時に1回だけ登録
}
