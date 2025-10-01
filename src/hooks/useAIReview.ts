// AI Review処理フック

import { useCallback } from 'react';

import { openOrActivateTab } from '@/engine/openTab';
import type { Tab, FileItem } from '@/types';

export function useAIReview() {
  // AIレビュータブを開く
  const openAIReviewTab = useCallback(
    (
      filePath: string,
      originalContent: string,
      suggestedContent: string,
      setTabs: (update: any) => void,
      setActiveTabId: (id: string) => void,
      tabs: Tab[]
    ) => {
      // openOrActivateTabで一元化
      const fileName = filePath.split('/').pop() || 'unknown';
      const fileItem: FileItem = {
        name: `AI Review: ${fileName}`,
        path: filePath,
        content: '',
        id: `ai-review-${filePath}`,
        type: 'file',
      };
      openOrActivateTab(fileItem, tabs, setTabs, setActiveTabId, {
        aiReviewProps: {
          originalContent,
          suggestedContent,
          filePath,
        },
      });
    },
    []
  );

  // 変更を適用する
  const applyChanges = useCallback(
    async (
      filePath: string,
      newContent: string,
      currentProject: any,
      saveFile: (projectId: string, filePath: string, content: string) => Promise<void>,
      clearAIReview: (filePath: string) => Promise<void>
    ) => {
      if (!currentProject) {
        throw new Error('プロジェクトが選択されていません');
      }

      try {
        // ファイルを保存
        await saveFile(currentProject.id, filePath, newContent);

        // AIレビュー状態をクリア
        await clearAIReview(filePath);

        return true;
      } catch (error) {
        console.error('Failed to apply changes:', error);
        throw error;
      }
    },
    []
  );

  // 変更を破棄する
  const discardChanges = useCallback(
    async (filePath: string, clearAIReview: (filePath: string) => Promise<void>) => {
      try {
        // AIレビュー状態をクリア
        await clearAIReview(filePath);
        return true;
      } catch (error) {
        console.error('Failed to discard changes:', error);
        throw error;
      }
    },
    []
  );

  // レビュータブを閉じる
  const closeAIReviewTab = useCallback(
    (filePath: string, setTabs: (update: any) => void, tabs: Tab[]) => {
      const updatedTabs = tabs.filter(tab => !(tab.aiReviewProps?.filePath === filePath));
      setTabs(updatedTabs);
    },
    []
  );

  // 部分的な変更を適用（行単位での適用/破棄）
  const applyPartialChanges = useCallback(
    (originalContent: string, suggestedContent: string, linesToApply: number[]): string => {
      const originalLines = originalContent.split('\n');
      const suggestedLines = suggestedContent.split('\n');

      // 簡単な実装：指定行を置換
      const resultLines = [...originalLines];

      linesToApply.forEach(lineNumber => {
        if (lineNumber >= 0 && lineNumber < suggestedLines.length) {
          if (lineNumber < resultLines.length) {
            resultLines[lineNumber] = suggestedLines[lineNumber];
          } else {
            resultLines.push(suggestedLines[lineNumber]);
          }
        }
      });

      return resultLines.join('\n');
    },
    []
  );

  return {
    openAIReviewTab,
    applyChanges,
    discardChanges,
    applyPartialChanges,
    closeAIReviewTab,
  };
}
