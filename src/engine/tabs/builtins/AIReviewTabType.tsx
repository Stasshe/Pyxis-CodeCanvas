// src/engine/tabs/builtins/AIReviewTabType.tsx
import React from 'react';

import { TabTypeDefinition, AIReviewTab, TabComponentProps } from '../types';

import AIReviewTabComponent from '@/components/AI/AIReview/AIReviewTab';
import { useGitContext } from '@/components/PaneContainer';
import { useProject } from '@/engine/core/project';
import { useTabStore } from '@/stores/tabStore';

/**
 * AIレビュータブのコンポーネント
 */
const AIReviewTabRenderer: React.FC<TabComponentProps> = ({ tab }) => {
  const aiTab = tab as AIReviewTab;
  const closeTab = useTabStore(state => state.closeTab);
  const updateTab = useTabStore(state => state.updateTab);
  const { saveFile, clearAIReview, refreshProjectFiles } = useProject();
  const { setGitRefreshTrigger } = useGitContext();

  const handleApplyChanges = async (filePath: string, content: string) => {
    if (saveFile) {
      await saveFile(filePath, content);
      // Git状態を更新
      setGitRefreshTrigger(prev => prev + 1);
    }
    if (clearAIReview) {
      await clearAIReview(filePath);
    }
    if (refreshProjectFiles) {
      await refreshProjectFiles();
    }
    closeTab(aiTab.paneId, aiTab.id);
  };

  const handleDiscardChanges = async (filePath: string) => {
    if (clearAIReview) {
      await clearAIReview(filePath);
    }
    if (refreshProjectFiles) {
      await refreshProjectFiles();
    }
    closeTab(aiTab.paneId, aiTab.id);
  };

  const handleCloseTab = (filePath: string) => {
    closeTab(aiTab.paneId, aiTab.id);
  };

  const handleUpdateSuggestedContent = (tabId: string, newContent: string) => {
    updateTab(aiTab.paneId, tabId, { suggestedContent: newContent } as Partial<AIReviewTab>);
  };

  console.log('[AIReviewTabRenderer] Rendering AIReviewTab with:', {
    originalContent: aiTab.originalContent?.length,
    suggestedContent: aiTab.suggestedContent?.length,
    filePath: aiTab.filePath,
  });

  return (
    <AIReviewTabComponent
      tab={aiTab}
      onApplyChanges={handleApplyChanges}
      onDiscardChanges={handleDiscardChanges}
      onCloseTab={handleCloseTab}
      onUpdateSuggestedContent={handleUpdateSuggestedContent}
    />
  );
};

/**
 * AIレビュータブタイプの定義
 */
export const AIReviewTabType: TabTypeDefinition = {
  kind: 'ai',
  displayName: 'AI Review',
  icon: 'Sparkles',
  canEdit: true,
  canPreview: false,
  component: AIReviewTabRenderer,

  createTab: (file, options): AIReviewTab => {
    const tabId = `ai:${file.path || file.name || Date.now()}`;
    const aiReviewProps = options?.aiReviewProps;

    console.log('[AIReviewTabType] createTab called with:', {
      file,
      options,
      aiReviewProps,
    });

    if (!aiReviewProps) {
      console.warn('[AIReviewTabType] aiReviewProps is missing in options!');
    }

    const tab: AIReviewTab = {
      id: tabId,
      name: `AI Review: ${file.path?.split('/').pop() || 'unknown'}`,
      kind: 'ai',
      path: file.path || '',
      paneId: options?.paneId || '',
      originalContent: aiReviewProps?.originalContent || '',
      suggestedContent: aiReviewProps?.suggestedContent || '',
      filePath: aiReviewProps?.filePath || file.path || '',
    };

    console.log('[AIReviewTabType] Created tab:', {
      id: tab.id,
      name: tab.name,
      originalContentLength: tab.originalContent.length,
      suggestedContentLength: tab.suggestedContent.length,
      filePath: tab.filePath,
    });

    return tab;
  },

  shouldReuseTab: (existingTab, newFile, options) => {
    return existingTab.path === newFile.path && existingTab.kind === 'ai';
  },
};
