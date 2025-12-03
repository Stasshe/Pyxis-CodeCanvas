// src/engine/tabs/builtins/AIReviewTabType.tsx
import React from 'react';

import { TabTypeDefinition, AIReviewTab, TabComponentProps } from '../types';

import AIReviewTabComponent from '@/components/AI/AIReview/AIReviewTab';
import { useGitContext } from '@/components/PaneContainer';
import { fileRepository } from '@/engine/core/fileRepository';
import { useChatSpace } from '@/hooks/ai/useChatSpace';
import { useTabStore } from '@/stores/tabStore';

/**
 * AIレビュータブのコンポーネント
 * 
 * NOTE: NEW-ARCHITECTURE.mdに従い、ファイル操作はfileRepositoryを直接使用。
 * useProjectフックは各コンポーネントで独立した状態を持つため、
 * currentProjectがnullになりファイルが保存されない問題があった。
 */
const AIReviewTabRenderer: React.FC<TabComponentProps> = ({ tab }) => {
  const aiTab = tab as AIReviewTab;
  const closeTab = useTabStore(state => state.closeTab);
  const updateTab = useTabStore(state => state.updateTab);
  const { setGitRefreshTrigger } = useGitContext();
  const { addMessage } = useChatSpace(aiTab.aiEntry?.projectId || null);

  const handleApplyChanges = async (filePath: string, content: string) => {
    const projectId = aiTab.aiEntry?.projectId;
    
    if (!projectId) {
      console.error('[AIReviewTabRenderer] No projectId available, cannot save file');
      return;
    }

    try {
      // fileRepositoryを直接使用してファイルを保存（NEW-ARCHITECTURE.mdに従う）
      await fileRepository.saveFileByPath(projectId, filePath, content);
      
      // Git状態を更新
      setGitRefreshTrigger(prev => prev + 1);
      
      // AIレビュー状態をクリア
      try {
        await fileRepository.clearAIReview(projectId, filePath);
      } catch (e) {
        console.warn('[AIReviewTabRenderer] clearAIReview failed (non-critical):', e);
      }
    } catch (error) {
      console.error('[AIReviewTabRenderer] Failed to save file:', error);
      return;
    }

    // Add a chat message indicating the apply action, branching from parent if available
    if (addMessage) {
      try {
        await addMessage(`Applied changes to ${filePath}`, 'assistant', 'edit', [filePath], undefined, {
          parentMessageId: aiTab.aiEntry?.parentMessageId,
          action: 'apply',
        });
      } catch (e) {
        console.warn('[AIReviewTabRenderer] Failed to append apply message to chat:', e);
      }
    }

    closeTab(aiTab.paneId, aiTab.id);
  };

  const handleDiscardChanges = async (filePath: string) => {
    const projectId = aiTab.aiEntry?.projectId;
    
    // AIレビュー状態をクリア（projectIdがある場合のみ）
    if (projectId) {
      try {
        await fileRepository.init();
        await fileRepository.clearAIReview(projectId, filePath);
      } catch (e) {
        console.warn('[AIReviewTabRenderer] clearAIReview failed (non-critical):', e);
      }
    }
    
    // record revert/discard in chat
    if (addMessage) {
      try {
        await addMessage(`Discarded AI suggested changes for ${filePath}`, 'assistant', 'edit', [filePath], undefined, {
          parentMessageId: aiTab.aiEntry?.parentMessageId,
          action: 'revert',
        });
      } catch (e) {
        console.warn('[AIReviewTabRenderer] Failed to append discard message to chat:', e);
      }
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
      // optional history passed by caller
      history: aiReviewProps?.history,
      // raw aiEntry (contains projectId, originalSnapshot, etc.) if provided
      aiEntry: aiReviewProps?.aiEntry,
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
