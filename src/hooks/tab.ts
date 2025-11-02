// プロジェクトファイルが更新された時に開いているタブの内容も同期
import { useEffect } from 'react';

import { fileRepository } from '@/engine/core/fileRepository';
import { flattenPanes } from '@/hooks/pane';
import type { Tab, Project, FileItem } from '@/types';

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

export function useProjectFilesSyncEffect({
  currentProject,
  projectFiles,
  tabs,
  setTabs,
  nodeRuntimeOperationInProgress,
  isRestoredFromLocalStorage,
}: {
  currentProject: Project | null;
  projectFiles: FileItem[];
  tabs: Tab[];
  setTabs: (update: any) => void;
  nodeRuntimeOperationInProgress: boolean;
  isRestoredFromLocalStorage: boolean;
}) {
  useEffect(() => {
    // normalize paths for robust comparisons (strip pane/id prefixes and ensure leading slash)
    const normalizePath = (p?: string) => {
      if (!p) return '';
      const withoutKindPrefix = p.includes(':') ? p.replace(/^[^:]+:/, '') : p;
      // remove known suffixes used historically
      const cleaned = withoutKindPrefix.replace(/(-preview|-diff|-ai)$/, '');
      return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
    };
    // localStorage復元が完了していない場合は処理をスキップ
    if (!isRestoredFromLocalStorage) {
      console.log(
        '[DEBUG] Skipping useProjectFilesSyncEffect: localStorage restoration not complete'
      );
      return;
    }

    // currentProjectがnullの場合は処理をスキップ
    if (!currentProject) {
      console.log('[DEBUG] Skipping useProjectFilesSyncEffect: currentProject is null');
      return;
    }

    // プロジェクトファイルを平坦化
    const flattenedFiles = flattenFileItems(projectFiles);
    // デバッグ: 全ファイルパス一覧
    // console.log('[DEBUG] ProjectFiles paths:', flattenedFiles.map(f => f.path));
    //  デバッグ: 全タブパス一覧
    // console.log('[DEBUG] Tabs paths:', tabs.map(t => t.path));
    //console.log('[DEBUG] Flattened project files:', flattenedFiles.map(f => ({ path: f.path, contentLength: f.content?.length || 0 })));

    // タブにneedsContentRestoreフラグがあるかチェック
    const tabsNeedingRestore = tabs.filter(tab => tab.needsContentRestore);
    // if (tabsNeedingRestore.length > 0) {
    //   console.log('[DEBUG] Tabs needing content restore:', tabsNeedingRestore.map(t => ({ path: t.path, id: t.id })));
    // }

    // tabsが空でもprojectFilesが存在する場合は同期を試みる
    if (flattenedFiles.length > 0) {
      let hasRealChanges = false;
      const updatedTabs = tabs
        .filter(tab => tab.content !== null) // contentがnullのタブを閉じる
        .map(tab => {
          const correspondingFile = flattenedFiles.find(
            f => normalizePath(f.path) === normalizePath(tab.path)
          );
          if (!correspondingFile) {
            // if (tab.needsContentRestore) {
            //   console.log('[DEBUG] No corresponding file found for tab needing restore:', tab.path);
            //   // 追加: どのファイルパスと一致しないか詳細表示
            //   flattenedFiles.forEach(f => {
            //     console.log(`[DEBUG] Compare: tab.path="${tab.path}" vs file.path="${f.path}" =>`, tab.path === f.path);
            //   });
            // }
            return tab;
          }

          // localStorage復元後のコンテンツ復元が必要な場合
          if (tab.needsContentRestore) {
            hasRealChanges = true;
            // console.log('[DEBUG] Restoring content from DB for tab:', tab.path, 'fileContent:', correspondingFile.content?.slice(0, 50) + '...');

            if (tab.isBufferArray && correspondingFile.isBufferArray) {
              return {
                ...tab,
                content: correspondingFile.content || '',
                bufferContent: correspondingFile.bufferContent,
                isDirty: false,
                needsContentRestore: false, // 復元完了
              };
            } else {
              return {
                ...tab,
                content: correspondingFile.content || '',
                bufferContent: undefined,
                isDirty: false,
                needsContentRestore: false, // 復元完了
              };
            }
          }

          // バイナリファイルの場合はbufferContentを同期
          if (tab.isBufferArray && correspondingFile.isBufferArray) {
            const newBuf = correspondingFile.bufferContent;
            const oldBuf = tab.bufferContent;
            // バッファ長が異なる、または未設定の場合にのみ更新
            if (!oldBuf || (newBuf && oldBuf.byteLength !== newBuf.byteLength)) {
              hasRealChanges = true;
              return {
                ...tab,
                bufferContent: correspondingFile.bufferContent,
                content: correspondingFile.content,
                isDirty: false,
              };
            }
            return tab;
          }
          // テキストファイルはcontentで比較
          if (correspondingFile.content === tab.content) {
            return tab;
          }
          // NodeRuntime操作中は強制的に更新、そうでなければisDirtyをチェック
          const shouldUpdate = nodeRuntimeOperationInProgress || !tab.isDirty;
          if (!shouldUpdate) {
            return tab;
          }
          hasRealChanges = true;
          return {
            ...tab,
            content: correspondingFile.content,
            isDirty: false, // DBから同期したので汚れていない状態にリセット
          };
        });
      // 実際に内容が変更された場合のみ更新
      if (hasRealChanges) {
        // console.log('[DEBUG] Updating tabs in useProjectFilesSyncEffect', updatedTabs.map(t => ({ id: t.id, path: t.path, needsContentRestore: t.needsContentRestore, contentLength: t.content?.length || 0 })));
        setTabs(updatedTabs);
      }
    }
  }, [
    projectFiles,
    currentProject?.id,
    nodeRuntimeOperationInProgress,
    isRestoredFromLocalStorage,
  ]);

  // 追加：プロジェクトファイルが初回読み込まれた時に、コンテンツ復元を強制実行
  useEffect(() => {
    if (!isRestoredFromLocalStorage || !currentProject || projectFiles.length === 0) {
      return;
    }

    const tabsNeedingRestore = tabs.filter(tab => tab.needsContentRestore);
    if (tabsNeedingRestore.length > 0) {
      // console.log('[DEBUG] Force restoring content for tabs after project load');

      // プロジェクトファイルを平坦化
      const flattenedFiles = flattenFileItems(projectFiles);

      const updatedTabs = tabs
        .filter(tab => tab.content !== null) // contentがnullのタブを閉じる
        .map(tab => {
          if (!tab.needsContentRestore) return tab;

          const correspondingFile = flattenedFiles.find(f => f.path === tab.path);
          if (!correspondingFile) {
            // console.log('[DEBUG] No file found for force restore:', tab.path);
            return tab;
          }

          // console.log('[DEBUG] Force restoring:', tab.path, 'content length:', correspondingFile.content?.length || 0);
          return {
            ...tab,
            content: correspondingFile.content || '',
            bufferContent: tab.isBufferArray ? correspondingFile.bufferContent : undefined,
            isDirty: false,
            needsContentRestore: false,
          };
        });

      setTabs(updatedTabs);
    }
  }, [currentProject?.id, projectFiles.length, isRestoredFromLocalStorage]);
}
// src/hooks/pageEffects.ts
// page.tsx の長めのuseEffect（プロジェクト変更時のタブリセット）を分離

export function useProjectTabResetEffect({
  currentProject,
  setTabs,
  setActiveTabId,
  pane,
}: {
  currentProject: Project | null;
  setTabs: (update: any) => void;
  setActiveTabId: (id: string) => void;
  pane: number;
}) {
  useEffect(() => {
    if (currentProject) {
      setTimeout(() => {
        setTabs((prevTabs: Tab[] | undefined) => {
          // 既存のタブがある場合は何もしない
          if (prevTabs && prevTabs.length > 0) {
            return prevTabs;
          }
          // paneが0以外ならWelcomeタブを生成しない
          if (pane !== 0) {
            return [];
          }
          // Welcomeタブを追加
          const welcomeTab: Tab = {
            id: 'welcome',
            name: 'Welcome',
            content: `# ${currentProject.name}\n\n${currentProject.description || ''}\n\nプロジェクトファイルはIndexedDBに保存されています。\n./${currentProject.name}/~$`,
            isDirty: false,
            path: '/',
          };
          return [welcomeTab];
        });
        // paneが0以外ならactiveTabIdも空に
        setActiveTabId('welcome');
      }, 50);
    } else {
      setTabs([]);
      setActiveTabId('');
    }
  }, [currentProject?.id, pane]);
}

// タブアクティブ時のコンテンツ復元フック（全ペイン対応）
export function useActiveTabContentRestore({
  editors,
  projectFiles,
  setEditors,
  isRestoredFromLocalStorage,
}: {
  editors: any[]; // EditorPane[]
  projectFiles: FileItem[];
  setEditors: (update: any) => void;
  isRestoredFromLocalStorage: boolean;
}) {
  // needsContentRestoreフラグのあるタブを復元
  useEffect(() => {
    // localStorage復元が完了していない、またはエディタがない場合はスキップ
    if (!isRestoredFromLocalStorage || !editors.length) {
      return;
    }

    // ペインをフラット化して、needsContentRestoreなタブが1つでもあれば復元
    const flatPanes = flattenPanes(editors);
    const needsRestore = flatPanes.some(pane =>
      pane.tabs.some((tab: any) => tab.needsContentRestore)
    );

    if (needsRestore) {
      // プロジェクトファイルを平坦化
      const flattenedFiles = flattenFileItems(projectFiles);
      setEditors((prevEditors: any[]) => {
        const updatePaneRecursive = (panes: any[]): any[] => {
          return panes.map(editor => {
            if (editor.children && editor.children.length > 0) {
              return {
                ...editor,
                children: updatePaneRecursive(editor.children),
              };
            }
            // リーフペインの場合、全タブを復元
            return {
              ...editor,
              tabs: editor.tabs.map((tab: any) => {
                if (!tab.needsContentRestore) return tab;
                const correspondingFile = flattenedFiles.find(f => f.path === tab.path);
                if (!correspondingFile) return tab;
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
        return updatePaneRecursive(prevEditors);
      });
    }
  }, [
    // 全ペインのタブIDとneedsContentRestoreフラグを監視
    flattenPanes(editors)
      .map(pane =>
        pane.tabs.map((tab: any) => tab.id + ':' + (tab.needsContentRestore ? '1' : '0')).join(',')
      )
      .join(','),
    projectFiles.length,
    isRestoredFromLocalStorage,
  ]);

  // ファイル変更イベントをリッスンして、開いているタブのコンテンツを自動更新
  useEffect(() => {
    if (!isRestoredFromLocalStorage) {
      return;
    }

    // FileRepositoryからのファイル変更イベントをリッスン
    const unsubscribe = fileRepository.addChangeListener(event => {
      console.log('[useActiveTabContentRestore] File change event:', event);

      // 削除イベントの場合はタブを閉じる処理は TabBar.tsx で処理されるのでここではスキップ
      if (event.type === 'delete') {
        return;
      }

      // 作成・更新イベントの場合、該当するタブのコンテンツを更新
      if (event.type === 'create' || event.type === 'update') {
        const changedFile = event.file;

        // Use functional update to always get latest editors state
        setEditors((currentEditors: any[]) => {
          if (!currentEditors.length) return currentEditors;

          const flatPanes = flattenPanes(currentEditors);

          // normalize path helper (same logic as above)
          const normalizePath = (p?: string) => {
            if (!p) return '';
            const withoutKindPrefix = p.includes(':') ? p.replace(/^[^:]+:/, '') : p;
            const cleaned = withoutKindPrefix.replace(/(-preview|-diff|-ai)$/, '');
            return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
          };

          // 変更されたファイルのパスに対応するタブがあるかチェック
          const hasMatchingTab = flatPanes.some(pane =>
            pane.tabs.some(
              (tab: any) => normalizePath(tab.path) === normalizePath(changedFile.path)
            )
          );

          if (!hasMatchingTab) {
            return currentEditors; // No matching tabs, return unchanged
          }

          console.log('[useActiveTabContentRestore] Updating tab content for:', changedFile.path);

          // 再帰的にペインを更新
          const updatePaneRecursive = (panes: any[]): any[] => {
            return panes.map(editor => {
              if (editor.children && editor.children.length > 0) {
                return {
                  ...editor,
                  children: updatePaneRecursive(editor.children),
                };
              }
              // リーフペインの場合、該当するタブのコンテンツを更新
              return {
                ...editor,
                tabs: editor.tabs.map((tab: any) => {
                  // パスが一致するタブのみ更新
                  if (normalizePath(tab.path) === normalizePath(changedFile.path)) {
                    console.log('[useActiveTabContentRestore] Updating tab:', tab.id);
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
          return updatePaneRecursive(currentEditors);
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [editors, isRestoredFromLocalStorage, setEditors]);
}
