// AI Review処理フック

import { useCallback } from 'react';

import { markAIReviewDraftDiscarded } from '@/engine/ide/ai/aiReviewDraftState';
import { tabActions } from '@/stores/tabState';
import type { AIReviewEntry, AIReviewTab, FileItem } from '@/types/index';

export function useAIReview() {
  const { openTab, closeTab } = tabActions;

  // AIレビュータブを開く
  const openAIReviewTab = useCallback(
    async (
      filePath: string,
      originalContent: string,
      suggestedContent: string,
      aiEntry?: AIReviewEntry
    ) => {
      const fileName = filePath.split('/').pop() || 'unknown';
      const fileItem: FileItem = {
        name: `AI Review: ${fileName}`,
        path: filePath,
        content: '',
        id: `ai-review-${filePath}`,
        type: 'file',
      };

      await openTab(fileItem, {
        kind: 'ai',
        searchAllPanesForReuse: true,
        aiReviewProps: {
          originalContent,
          suggestedContent,
          filePath,
          history: aiEntry?.history,
          aiEntry,
        },
      });
    },
    []
  );

  // レビュータブを閉じる
  const closeAIReviewTab = useCallback(
    (rootPath: string, filePath: string, parentMessageId: string) => {
      const identity = { rootPath, filePath, parentMessageId };
      const matchingTabs = tabActions
        .getAllTabs()
        .filter(
          (tab): tab is AIReviewTab =>
            tab.kind === 'ai' &&
            tab.filePath === filePath &&
            tab.aiEntry?.rootPath === rootPath &&
            tab.aiEntry.parentMessageId === parentMessageId
        );
      for (const tab of matchingTabs) {
        if (markAIReviewDraftDiscarded(tab, identity)) closeTab(tab.paneId, tab.id);
      }
    },
    []
  );

  return {
    openAIReviewTab,
    closeAIReviewTab,
  };
}
