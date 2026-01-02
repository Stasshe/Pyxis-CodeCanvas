// src/engine/tabs/builtins/AIReviewTabType.tsx
import type React from 'react';
import { useEffect } from 'react';

import type { AIReviewTab, TabComponentProps, TabTypeDefinition } from '../types';

import AIReviewTabComponent from '@/components/AI/AIReview/AIReviewTab';
import { useGitContext } from '@/components/PaneContainer';
import { fileRepository, toAppPath } from '@/engine/core/fileRepository';
import { editorMemoryManager } from '@/engine/editor';
import { useChatSpace } from '@/hooks/ai/useChatSpace';
import { useTabStore } from '@/stores/tabStore';

/**
 * AIレビュータブのコンポーネント
 *
 * EditorMemoryManagerを使用した統一的なメモリ管理システムに対応。
 * - AI適用時にEditorMemoryManager経由でコンテンツを更新
 * - 他のエディタータブとの同期は自動的に行われる
 * - ワーキングディレクトリのファイル変更を検知してoriginalContentを更新
 */
const AIReviewTabRenderer: React.FC<TabComponentProps> = ({ tab }) => {
  const aiTab = tab as AIReviewTab;
  const closeTab = useTabStore(state => state.closeTab);
  const updateTab = useTabStore(state => state.updateTab);
  const { setGitRefreshTrigger } = useGitContext();
  const { addMessage } = useChatSpace(aiTab.aiEntry?.projectId || null);

  // EditorMemoryManagerを初期化し、外部変更を監視
  useEffect(() => {
    const initMemory = async () => {
      await editorMemoryManager.init();
    };
    initMemory();

    // 外部変更リスナーを追加（WDファイルの変更をoriginalContentに反映）
    const normalizedFilePath = toAppPath(aiTab.filePath);
    const unsubscribe = editorMemoryManager.addChangeListener((changedPath, newContent, source) => {
      // 外部更新（他のエディタでの保存など）を検知してoriginalContentを更新
      if (source === 'external' && toAppPath(changedPath) === normalizedFilePath) {
        console.log('[AIReviewTabRenderer] Detected external change for:', changedPath);
        updateTab(aiTab.paneId, aiTab.id, { originalContent: newContent } as Partial<AIReviewTab>);
      }
    });

    return unsubscribe;
  }, [aiTab.filePath, aiTab.paneId, aiTab.id, updateTab]);

  const handleApplyChanges = async (filePath: string, content: string) => {
    const projectId = aiTab.aiEntry?.projectId;

    if (!projectId) {
      console.error('[AIReviewTabRenderer] No projectId available, cannot save file');
      return;
    }

    try {
      // fileRepositoryを直接使用してファイルを保存
      await fileRepository.saveFileByPath(projectId, filePath, content);

      // EditorMemoryManagerを通じて他のタブに変更を通知
      // 外部更新として扱い、同一ファイルを開いている全タブに即時反映
      editorMemoryManager.updateFromExternal(filePath, content);

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
};
