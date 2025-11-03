// src/engine/tabs/builtins/AIReviewTabType.tsx
import React from 'react';
import { TabTypeDefinition, AIReviewTab, TabComponentProps } from '../types';
import AIReviewTabComponent from '@/components/AI/AIReview/AIReviewTab';
import { useTabStore } from '@/stores/tabStore';
import { useProject } from '@/engine/core/project';

/**
 * AIレビュータブのコンポーネント
 */
const AIReviewTabRenderer: React.FC<TabComponentProps> = ({ tab }) => {
  const aiTab = tab as AIReviewTab;
  const closeTab = useTabStore(state => state.closeTab);
  const updateTab = useTabStore(state => state.updateTab);
  const { saveFile, clearAIReview } = useProject();

  const handleApplyChanges = async (filePath: string, content: string) => {
    if (saveFile) {
      await saveFile(filePath, content);
    }
    if (clearAIReview) {
      await clearAIReview(filePath);
    }
    closeTab(aiTab.paneId, aiTab.id);
  };

  const handleDiscardChanges = async (filePath: string) => {
    if (clearAIReview) {
      await clearAIReview(filePath);
    }
    closeTab(aiTab.paneId, aiTab.id);
  };

  const handleCloseTab = (filePath: string) => {
    closeTab(aiTab.paneId, aiTab.id);
  };

  const handleUpdateSuggestedContent = (tabId: string, newContent: string) => {
    updateTab(aiTab.paneId, tabId, { suggestedContent: newContent } as Partial<AIReviewTab>);
  };

  return (
    <AIReviewTabComponent
      tab={{
        ...aiTab,
        aiReviewProps: {
          originalContent: aiTab.originalContent,
          suggestedContent: aiTab.suggestedContent,
          filePath: aiTab.filePath,
        },
      } as any}
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
    const aiProps = options?.aiReviewProps;
    
    return {
      id: tabId,
      name: `AI Review: ${file.name}`,
      kind: 'ai',
      path: file.path || '',
      paneId: options?.paneId || '',
      originalContent: aiProps?.originalContent || '',
      suggestedContent: aiProps?.suggestedContent || '',
      filePath: aiProps?.filePath || file.path || '',
    };
  },
  
  shouldReuseTab: (existingTab, newFile, options) => {
    return existingTab.path === newFile.path && existingTab.kind === 'ai';
  },
};
