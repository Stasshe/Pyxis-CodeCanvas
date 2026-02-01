// src/engine/tabs/builtins/AIReviewTabType.tsx
import type React from 'react';
import { useEffect } from 'react';

import type { AIReviewTab, TabComponentProps, TabTypeDefinition } from '../types';

import AIReviewTabComponent from '@/components/AI/AIReview/AIReviewTab';
import { useGitContext } from '@/components/Pane/PaneContainer';
import { fileRepository } from '@/engine/core/fileRepository';
import { useChatSpace } from '@/hooks/ai/useChatSpace';
import {
  addChangeListener,
  initTabSaveSync,
  tabActions,
  updateFromExternal,
} from '@/stores/tabState';

/**
 * AIレビュータブのコンポーネント
 *
 * tabState (Valtio) でコンテンツ・外部変更検知を管理。
 * ワーキングディレクトリのファイル変更を originalContent に反映。
 */
import { useTabContent } from '@/stores/tabContentStore';

const AIReviewTabRenderer: React.FC<TabComponentProps> = ({ tab }) => {
  const aiTab = tab as AIReviewTab;
  const { setGitRefreshTrigger } = useGitContext();
  const { addMessage } = useChatSpace(aiTab.aiEntry?.projectId || null);

  // tabContentStoreから最新のファイルコンテンツを取得（これがoriginalContentになる）
  // fallbackとして、タブ作成時のoriginalContentを使用
  const storeContent = useTabContent(aiTab.id);
  const currentOriginalContent = storeContent ?? aiTab.originalContent;

  // AIReviewTabComponent用にオブジェクトを再作成（originalContentのみ差し替え）
  const tabWithContent = {
    ...aiTab,
    originalContent: currentOriginalContent,
  };

  useEffect(() => {
    initTabSaveSync();
    // addChangeListenerは不要になったため削除（tabState.tsのupdateTabContentがtabContentStoreを更新する）
  }, []);

  const handleApplyChanges = async (filePath: string, content: string) => {
    const projectId = aiTab.aiEntry?.projectId;

    if (!projectId) {
      console.error('[AIReviewTabRenderer] No projectId available, cannot save file');
      return;
    }

    try {
      await fileRepository.saveFileByPath(projectId, filePath, content);
      updateFromExternal(filePath, content);

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
        await addMessage(
          `Applied changes to ${filePath}`,
          'assistant',
          'edit',
          [filePath],
          undefined,
          {
            parentMessageId: aiTab.aiEntry?.parentMessageId,
            action: 'apply',
          }
        );
      } catch (e) {
        console.warn('[AIReviewTabRenderer] Failed to append apply message to chat:', e);
      }
    }

    tabActions.closeTab(aiTab.paneId, aiTab.id);
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
        await addMessage(
          `Discarded AI suggested changes for ${filePath}`,
          'assistant',
          'edit',
          [filePath],
          undefined,
          {
            parentMessageId: aiTab.aiEntry?.parentMessageId,
            action: 'revert',
          }
        );
      } catch (e) {
        console.warn('[AIReviewTabRenderer] Failed to append discard message to chat:', e);
      }
    }

    tabActions.closeTab(aiTab.paneId, aiTab.id);
  };

  return (
    <AIReviewTabComponent
      tab={tabWithContent}
      onApplyChanges={handleApplyChanges}
      onDiscardChanges={handleDiscardChanges}
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
    const filePath = String(file.path || file.name || '');
    const tabId = `ai:${filePath || Date.now()}`;
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
      name: `AI Review: ${filePath.split('/').pop() || 'unknown'}`,
      kind: 'ai',
      path: filePath,
      paneId: options?.paneId || '',
      originalContent: aiReviewProps?.originalContent || '',
      suggestedContent: aiReviewProps?.suggestedContent || '',
      filePath: aiReviewProps?.filePath || filePath,
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

  /**
   * AIレビュータブのコンテンツを更新（同期用）
   * originalContentがワーキングディレクトリの最新状態を反映する
   */
  updateContent: (tab, content, isDirty) => {
    const aiTab = tab as AIReviewTab;
    // originalContentの変更がない場合は元のタブを返す
    if (aiTab.originalContent === content) {
      return tab;
    }
    // originalContentを更新（WDファイルとの同期）
    return { ...aiTab, originalContent: content };
  },

  /**
   * 同期対象のファイルパスを取得
   * AIReviewTabはfilePathを使用してWDファイルと同期する
   */
  getContentPath: tab => {
    const aiTab = tab as AIReviewTab;
    return aiTab.filePath || aiTab.path || undefined;
  },

  /**
   * セッション保存時: originalContent のみ除外（ファイルから復元可能）
   * suggestedContent, aiEntry, history は保持
   */
  serializeForSession: (tab): AIReviewTab => {
    const aiTab = tab as AIReviewTab;
    return {
      ...aiTab,
      originalContent: '', // ファイルから復元
    };
  },

  /**
   * セッション復元時: originalContent をファイルから復元
   */
  restoreContent: async (tab, context): Promise<AIReviewTab> => {
    const aiTab = tab as AIReviewTab;
    const filePath = aiTab.filePath || aiTab.path;

    if (!filePath) {
      return aiTab;
    }

    const file = await context.getFileByPath(filePath);

    if (file?.content) {
      console.log('[AIReviewTabType] ✓ Restored originalContent for:', filePath);
      return {
        ...aiTab,
        originalContent: file.content,
      };
    }

    console.warn('[AIReviewTabType] File not found for originalContent:', filePath);
    return aiTab;
  },
};
