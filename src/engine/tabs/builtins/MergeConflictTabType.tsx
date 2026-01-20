// src/engine/tabs/builtins/MergeConflictTabType.tsx
import type React from 'react';
import { useCallback } from 'react';

import type {
  MergeConflictFileEntry,
  MergeConflictTab,
  TabComponentProps,
  TabTypeDefinition,
} from '../types';

import MergeConflictResolutionTab from '@/components/Tab/MergeConflictResolutionTab';
import { fileRepository } from '@/engine/core/fileRepository';
import { syncManager } from '@/engine/core/syncManager';
import { useTabStore } from '@/stores/tabStore';

/**
 * マージコンフリクト解決タブのレンダラー
 */
const MergeConflictTabRenderer: React.FC<TabComponentProps> = ({ tab }) => {
  const mergeTab = tab as MergeConflictTab;
  const closeTab = useTabStore(state => state.closeTab);
  const updateTab = useTabStore(state => state.updateTab);

  /**
   * 解決完了ハンドラー
   * 全ての解決済みファイルを保存し、マージを完了する
   */
  const handleResolve = useCallback(
    async (resolvedFiles: MergeConflictFileEntry[]) => {
      try {
        console.log('[MergeConflictTabType] Resolving merge conflicts:', resolvedFiles.length);

        // 各ファイルを保存
        for (const file of resolvedFiles) {
          await fileRepository.saveFileByPath(
            mergeTab.projectId,
            file.filePath,
            file.resolvedContent
          );
          console.log('[MergeConflictTabType] Saved resolved file:', file.filePath);
        }

        // IndexedDB → GitFileSystemへ同期
        await syncManager.syncFromIndexedDBToFS(mergeTab.projectId, mergeTab.projectName);
        console.log('[MergeConflictTabType] Synced to filesystem');

        // タブを閉じる
        closeTab(mergeTab.paneId, mergeTab.id);
      } catch (error) {
        console.error('[MergeConflictTabType] Failed to resolve conflicts:', error);
        // TODO: エラー通知
      }
    },
    [mergeTab, closeTab]
  );

  /**
   * キャンセルハンドラー
   */
  const handleCancel = useCallback(() => {
    closeTab(mergeTab.paneId, mergeTab.id);
  }, [mergeTab, closeTab]);

  /**
   * 解決内容の更新
   */
  const handleUpdateResolvedContent = useCallback(
    (filePath: string, content: string) => {
      const updatedConflicts = mergeTab.conflicts.map(c =>
        c.filePath === filePath ? { ...c, resolvedContent: content } : c
      );
      updateTab(mergeTab.paneId, mergeTab.id, { conflicts: updatedConflicts } as Partial<MergeConflictTab>);
    },
    [mergeTab, updateTab]
  );

  /**
   * 解決状態のトグル
   */
  const handleToggleResolved = useCallback(
    (filePath: string, isResolved: boolean) => {
      const updatedConflicts = mergeTab.conflicts.map(c =>
        c.filePath === filePath ? { ...c, isResolved } : c
      );
      updateTab(mergeTab.paneId, mergeTab.id, { conflicts: updatedConflicts } as Partial<MergeConflictTab>);
    },
    [mergeTab, updateTab]
  );

  return (
    <MergeConflictResolutionTab
      conflicts={mergeTab.conflicts}
      oursBranch={mergeTab.oursBranch}
      theirsBranch={mergeTab.theirsBranch}
      projectId={mergeTab.projectId}
      projectName={mergeTab.projectName}
      onResolve={handleResolve}
      onCancel={handleCancel}
      onUpdateResolvedContent={handleUpdateResolvedContent}
      onToggleResolved={handleToggleResolved}
    />
  );
};

/**
 * マージコンフリクト解決タブタイプの定義
 */
export const MergeConflictTabType: TabTypeDefinition = {
  kind: 'merge-conflict',
  displayName: 'Merge Conflict',
  icon: 'GitMerge',
  canEdit: true,
  canPreview: false,
  component: MergeConflictTabRenderer,

  createTab: (data, options): MergeConflictTab => {
    const conflicts = (data.conflicts as MergeConflictFileEntry[]) || [];
    const oursBranch = (data.oursBranch as string) || 'HEAD';
    const theirsBranch = (data.theirsBranch as string) || 'MERGE_HEAD';
    const projectId = (data.projectId as string) || '';
    const projectName = (data.projectName as string) || '';

    const tabId = `merge-conflict:${oursBranch}-${theirsBranch}-${Date.now()}`;
    const tabName = `Merge: ${theirsBranch} → ${oursBranch}`;

    return {
      id: tabId,
      name: tabName,
      kind: 'merge-conflict',
      path: '',
      paneId: options?.paneId || '',
      conflicts,
      oursBranch,
      theirsBranch,
      projectId,
      projectName,
    };
  },

  shouldReuseTab: (existingTab, newFile, options) => {
    // 同じブランチ間のマージコンフリクトタブは再利用
    const mergeTab = existingTab as MergeConflictTab;
    const oursBranch = (newFile.oursBranch as string) || '';
    const theirsBranch = (newFile.theirsBranch as string) || '';
    return (
      mergeTab.kind === 'merge-conflict' &&
      mergeTab.oursBranch === oursBranch &&
      mergeTab.theirsBranch === theirsBranch
    );
  },
};
