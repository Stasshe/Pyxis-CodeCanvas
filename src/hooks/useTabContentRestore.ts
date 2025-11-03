// src/hooks/useTabContentRestore.ts
import { useEffect } from 'react';
import { useTabStore } from '@/stores/tabStore';
import { fileRepository } from '@/engine/core/fileRepository';
import { FileItem, EditorPane } from '@/types';

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
 * 以下の2つの役割を持つ:
 * 1. IndexedDB復元後、needsContentRestoreフラグがあるタブのコンテンツを復元
 * 2. FileRepositoryからのファイル変更イベントを監視し、開いているタブを自動更新
 */
export function useTabContentRestore(projectFiles: FileItem[], isRestored: boolean) {
  const store = useTabStore();

  // パスを正規化する関数
  const normalizePath = (p?: string) => {
    if (!p) return '';
    const withoutKindPrefix = p.includes(':') ? p.replace(/^[^:]+:/, '') : p;
    const cleaned = withoutKindPrefix.replace(/(-preview|-diff|-ai)$/, '');
    return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
  };

  // 1. IndexedDB復元完了後、needsContentRestoreフラグのあるタブを復元
  useEffect(() => {
    // IndexedDB復元が完了していない、またはペインがない場合はスキップ
    if (!isRestored || !store.panes.length) {
      console.log('[useTabContentRestore] Waiting for session restoration...', {
        isRestored,
        panesLength: store.panes.length,
      });
      return;
    }

    // ペインをフラット化して、needsContentRestoreなタブが1つでもあれば復元
    const flatPanes = flattenPanes(store.panes);
    const needsRestore = flatPanes.some(pane =>
      pane.tabs.some((tab: any) => tab.needsContentRestore)
    );

    if (!needsRestore) {
      return;
    }

    console.log('[useTabContentRestore] Starting content restoration...');

    // プロジェクトファイルを平坦化
    const flattenedFiles = flattenFileItems(projectFiles);

    // setPanesを使って再帰的に全ペインを更新
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
          tabs: pane.tabs.map((tab: any) => {
            if (!tab.needsContentRestore) return tab;
            const correspondingFile = flattenedFiles.find(
              f => normalizePath(f.path) === normalizePath(tab.path)
            );
            if (!correspondingFile) {
              console.warn('[useTabContentRestore] File not found for tab:', tab.path);
              return tab;
            }
            console.log('[useTabContentRestore] Restoring tab:', tab.path);
            return {
              ...tab,
              content: correspondingFile.content || '',
              bufferContent: tab.isBufferArray ? correspondingFile.bufferContent : undefined,
              isDirty: false,
              needsContentRestore: false,
            };
          }),
        };
      });
    };

    store.setPanes(updatePaneRecursive(store.panes));
  }, [
    // 全ペインのタブIDとneedsContentRestoreフラグを監視（devブランチと同じ）
    flattenPanes(store.panes)
      .map(pane =>
        pane.tabs.map((tab: any) => tab.id + ':' + (tab.needsContentRestore ? '1' : '0')).join(',')
      )
      .join(','),
    projectFiles.length,
    isRestored,
  ]);

  // 2. ファイル変更イベントのリスニング（devブランチと同じロジック）
  useEffect(() => {
    if (!isRestored) {
      return;
    }

    const unsubscribe = fileRepository.addChangeListener(event => {
      console.log('[useTabContentRestore] File change event:', event);

      // 削除イベントはスキップ（TabBarで処理）
      if (event.type === 'delete') {
        return;
      }

      // 作成・更新イベントの場合、該当するタブのコンテンツを更新
      if (event.type === 'create' || event.type === 'update') {
        const changedFile = event.file;

        // 変更されたファイルのパスに対応するタブがあるかチェック
        const flatPanes = flattenPanes(store.panes);
        const hasMatchingTab = flatPanes.some(pane =>
          pane.tabs.some((tab: any) => normalizePath(tab.path) === normalizePath(changedFile.path))
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
              tabs: pane.tabs.map((tab: any) => {
                // パスが一致するタブのみ更新
                if (normalizePath(tab.path) === normalizePath(changedFile.path)) {
                  console.log('[useTabContentRestore] Updating tab:', tab.id);
                  return {
                    ...tab,
                    content: (changedFile as any).content || '',
                    bufferContent: tab.isBufferArray
                      ? (changedFile as any).bufferContent
                      : undefined,
                    isDirty: false, // ファイルが保存されたので、タブを非ダーティ状態にする
                  };
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
  }, [isRestored, store.panes]);
}
