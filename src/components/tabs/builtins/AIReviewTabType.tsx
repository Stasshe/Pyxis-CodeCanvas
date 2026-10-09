import type React from 'react';
import { lazy, Suspense, useEffect } from 'react';
import { fsClient } from '@/engine/core/fs/index';
import {
  clearAIReviewEntry,
  getAIReviewEntry,
  updateAIReviewEntry,
} from '@/engine/core/metadata/aiStorageAdapter';
import { getChatSpaces } from '@/engine/core/metadata/chatStorageAdapter';
import {
  markEditResponseFileApplied,
  markEditResponseFileReverted,
} from '@/engine/ide/ai/markEditResponseApplied';
import { readAIText } from '@/engine/ide/ai/textEdits';
import { useChatSpace } from '@/hooks/ai/useChatSpace';
import { pushLogMessage } from '@/stores/loggerStore';
/**
 * AIレビュータブのコンポーネント
 *
 * tabState (Valtio) でコンテンツ・外部変更検知を管理。
 * ワーキングディレクトリのファイル変更を originalContent に反映。
 */
import { isTabDirty, useTabContent } from '@/stores/tabContentStore';
import { initTabSaveSync, tabActions, updateFromExternal } from '@/stores/tabState';
import {
  clearAIReviewDraftDiscarded,
  isAIReviewDraftDiscarded,
  markAIReviewDraftDiscarded,
} from '../../../engine/ide/ai/aiReviewDraftState';
import type {
  AIReviewTab,
  TabComponentProps,
  TabTypeDefinition,
} from '../../../engine/ide/tabs/types';

const AIReviewTabComponent = lazy(() => import('@/components/ai/review/AIReviewTab'));

interface AIDraftState {
  tabId: string;
  rootPath: string | null;
  filePath: string;
  parentMessageId: string | null;
  latestContent: string;
  persistedContent: string;
  pending: boolean;
  inFlight: Promise<void> | null;
  inFlightContent: string | null;
}

const aiDraftStates = new Map<string, AIDraftState>();

function draftKey(tab: AIReviewTab): string {
  return JSON.stringify([
    tab.id,
    tab.aiEntry?.rootPath ?? null,
    tab.filePath || tab.path,
    tab.aiEntry?.parentMessageId ?? null,
  ]);
}

function draftStateFor(tab: AIReviewTab): AIDraftState {
  const key = draftKey(tab);
  const existing = aiDraftStates.get(key);
  if (existing) return existing;
  const state: AIDraftState = {
    tabId: tab.id,
    rootPath: tab.aiEntry?.rootPath ?? null,
    filePath: tab.filePath || tab.path,
    parentMessageId: tab.aiEntry?.parentMessageId ?? null,
    latestContent: tab.suggestedContent,
    persistedContent: tab.aiEntry?.suggestedContent ?? tab.suggestedContent,
    pending: Boolean(tab.aiEntry && tab.aiEntry.suggestedContent !== tab.suggestedContent),
    inFlight: null,
    inFlightContent: null,
  };
  aiDraftStates.set(key, state);
  return state;
}

function saveDraft(tab: AIReviewTab, content: string): Promise<void> {
  if (isAIReviewDraftDiscarded(tab.id)) return Promise.resolve();
  const state = draftStateFor(tab);
  state.latestContent = content;
  state.pending = true;
  if (!state.rootPath) {
    return Promise.reject(
      new Error('This AI review has no workspace metadata and cannot save drafts.')
    );
  }
  if (state.inFlight && state.inFlightContent === content) return state.inFlight;
  if (!state.inFlight && state.persistedContent === content) {
    state.pending = false;
    return Promise.resolve();
  }
  const rootPath = state.rootPath;
  const operation = updateAIReviewEntry(rootPath, state.filePath, existing => {
    if ((existing.parentMessageId ?? null) !== state.parentMessageId) {
      throw new Error('This AI review belongs to a different source message and cannot be saved.');
    }
    return { suggestedContent: content };
  }).then(updatedEntry => {
    if (
      !updatedEntry ||
      (updatedEntry.parentMessageId ?? null) !== state.parentMessageId ||
      updatedEntry.suggestedContent !== content
    ) {
      throw new Error('The AI review suggestion could not be saved.');
    }
    state.persistedContent = content;
    state.pending = state.latestContent !== content;
  });
  state.inFlight = operation;
  state.inFlightContent = content;
  void operation.then(
    () => {
      if (state.inFlight === operation) {
        state.inFlight = null;
        state.inFlightContent = null;
      }
    },
    () => {
      if (state.inFlight === operation) {
        state.inFlight = null;
        state.inFlightContent = null;
      }
    }
  );
  return operation;
}

function hasPendingAIReviewDraft(tab: AIReviewTab): boolean {
  if (isAIReviewDraftDiscarded(tab.id)) return false;
  const state = draftStateFor(tab);
  const currentTab = tabActions.getTab(tab.paneId, tab.id) as AIReviewTab | null;
  const content = currentTab?.suggestedContent ?? tab.suggestedContent;
  return Boolean(
    state.pending ||
      state.inFlight ||
      state.latestContent !== content ||
      state.persistedContent !== content
  );
}

async function flushAIReviewDraft(tab: AIReviewTab): Promise<void> {
  const key = draftKey(tab);
  if (isAIReviewDraftDiscarded(tab.id)) {
    aiDraftStates.delete(key);
    return;
  }
  const state = draftStateFor(tab);
  if (!state.rootPath) {
    state.pending = true;
    throw new Error('This AI review has no workspace metadata and cannot save drafts.');
  }
  const rootPath = state.rootPath;

  while (true) {
    await state.inFlight?.catch(() => undefined);
    const currentTab = tabActions.getTab(tab.paneId, tab.id) as AIReviewTab | null;
    const content = currentTab?.suggestedContent ?? state.latestContent;
    state.latestContent = content;
    state.pending = true;
    await saveDraft(tab, content);

    const persistedEntry = await getAIReviewEntry(rootPath, state.filePath);
    if (
      !persistedEntry ||
      (persistedEntry.parentMessageId ?? null) !== state.parentMessageId ||
      persistedEntry.suggestedContent !== content
    ) {
      const latestTab = tabActions.getTab(tab.paneId, tab.id) as AIReviewTab | null;
      const latestContent = latestTab?.suggestedContent ?? state.latestContent;
      if (latestContent !== content) {
        state.latestContent = latestContent;
        state.pending = true;
        continue;
      }
      state.pending = true;
      throw new Error('The latest AI review suggestion could not be confirmed in storage.');
    }
    const latestTab = tabActions.getTab(tab.paneId, tab.id) as AIReviewTab | null;
    const latestContent = latestTab?.suggestedContent ?? state.latestContent;
    if (latestContent !== content) {
      state.latestContent = latestContent;
      state.pending = true;
      continue;
    }
    state.persistedContent = content;
    state.pending = false;
    state.inFlight = null;
    state.inFlightContent = null;
    return;
  }
}

const AIReviewTabRenderer: React.FC<TabComponentProps> = ({ tab }) => {
  const aiTab = tab as AIReviewTab;
  const { addMessage, updateChatMessage } = useChatSpace(aiTab.aiEntry?.rootPath || null);

  // tabContentStoreから最新のファイルコンテンツを取得（これがoriginalContentになる）
  // fallbackとして、タブ作成時のoriginalContentを使用
  const storeContent = useTabContent(aiTab.id);
  const currentOriginalContent = storeContent ?? aiTab.originalContent;

  // AIReviewTabComponent用にオブジェクトを再作成（originalContentのみ差し替え）
  const tabWithContent = {
    ...aiTab,
    originalContent: currentOriginalContent,
  };

  const handleSuggestedContentChange = (tabId: string, content: string): void => {
    const currentTab = tabActions.getTab(aiTab.paneId, tabId);
    if (!currentTab || currentTab.kind !== 'ai') return;
    tabActions.updateTab(aiTab.paneId, tabId, { suggestedContent: content });
  };

  const handleUpdateSuggestedContent = async (_tabId: string, content: string): Promise<void> => {
    const currentTab = (tabActions.getTab(aiTab.paneId, _tabId) as AIReviewTab | null) ?? aiTab;
    try {
      await saveDraft(currentTab, content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[AIReviewTabRenderer] Failed to save suggested content:', error);
      pushLogMessage(message, 'error', 'AI');
      throw error;
    }
  };

  useEffect(() => {
    initTabSaveSync();
    // addChangeListenerは不要になったため削除（tabState.tsのupdateTabContentがtabContentStoreを更新する）
  }, []);

  const handleApplyChanges = async (
    filePath: string,
    content: string,
    action: 'apply' | 'rollback' = 'apply'
  ): Promise<boolean> => {
    const entry = aiTab.aiEntry;
    const rootPath = entry?.rootPath;
    const parentMessageId = entry?.parentMessageId;
    let parentSpaceId: string | null = null;
    let proposalOriginal = '';
    let proposalAppliedContent: string | null = null;
    let contentBeforeOperation: string | null = null;
    let savedContent: string | null = null;
    let proposalIsNewFile = false;
    let fileExisted = false;
    let fileWasChanged = false;
    let chatUpdateAttempted = false;
    let reviewUpdateAttempted = false;
    const recoveryFailures: string[] = [];

    try {
      if (!rootPath || !entry || !parentMessageId) {
        throw new Error('The source edit message is unavailable; the change cannot be tracked.');
      }
      ensureReviewTabIsCurrent(aiTab, filePath, rootPath, parentMessageId);

      const parentSpace = (await getChatSpaces(rootPath)).find(space =>
        space.messages.some(message => message.id === parentMessageId)
      );
      ensureReviewTabIsCurrent(aiTab, filePath, rootPath, parentMessageId);
      const parentMessage = parentSpace?.messages.find(message => message.id === parentMessageId);
      const proposal = parentMessage?.editResponse?.changedFiles.find(
        file => file.path === filePath
      );
      if (!parentSpace || !parentMessage?.editResponse || !proposal) {
        throw new Error('The source edit message does not contain this file.');
      }
      if (entry.originalSnapshot !== proposal.originalContent) {
        throw new Error('The saved rollback snapshot does not match the source edit message.');
      }
      parentSpaceId = parentSpace.id;
      proposalOriginal = proposal.originalContent;
      if (action === 'rollback') {
        if (typeof proposal.appliedContent !== 'string') {
          throw new Error(
            'This applied change has no saved content snapshot and cannot be rolled back safely.'
          );
        }
        proposalAppliedContent = proposal.appliedContent;
      }
      proposalIsNewFile = proposal.isNewFile === true;

      const dirtyTab = tabActions
        .getAllTabs()
        .some(tab => tab.path === filePath && (tab.isDirty || isTabDirty(tab.id)));
      if (dirtyTab)
        throw new Error('Save or discard unsaved file edits before applying this suggestion.');

      fileExisted = await fsClient.exists(filePath);
      if (action === 'apply' && proposalIsNewFile && fileExisted) {
        throw new Error('The new file already exists; review the workspace before applying.');
      }
      if (action === 'apply' && !proposalIsNewFile && !fileExisted) {
        throw new Error('The source file was removed after this suggestion was generated.');
      }
      if (action === 'rollback' && !fileExisted) {
        throw new Error(
          'The applied file is missing; rollback cannot verify its current contents.'
        );
      }
      contentBeforeOperation = fileExisted ? await readAIText(filePath) : '';
      let expectedContent = proposal.originalContent;
      if (action === 'rollback') {
        expectedContent = proposalAppliedContent as string;
      }
      if (contentBeforeOperation !== expectedContent) {
        throw new Error(
          'The file changed after this suggestion was generated. Review it before continuing.'
        );
      }
      if (
        tabActions
          .getAllTabs()
          .some(tab => tab.path === filePath && (tab.isDirty || isTabDirty(tab.id)))
      ) {
        throw new Error('The file has unsaved edits; save or discard them before continuing.');
      }
      ensureReviewTabIsCurrent(aiTab, filePath, rootPath, parentMessageId);

      savedContent = content;
      if (contentBeforeOperation.startsWith('\uFEFF') && !content.startsWith('\uFEFF')) {
        savedContent = `\uFEFF${content}`;
      }
      if (action === 'rollback' && proposalIsNewFile) {
        await fsClient.rm(filePath, { force: true });
      } else {
        await fsClient.writeFile(filePath, savedContent);
      }
      fileWasChanged = true;
      const hasDirtyBufferAfterWrite = tabActions
        .getAllTabs()
        .some(tab => tab.path === filePath && (tab.isDirty || isTabDirty(tab.id)));
      const contentAfterWrite = (await fsClient.exists(filePath))
        ? await readAIText(filePath)
        : null;
      const expectedAfterWrite = action === 'rollback' && proposalIsNewFile ? null : savedContent;
      if (hasDirtyBufferAfterWrite || contentAfterWrite !== expectedAfterWrite) {
        throw new Error('The file changed while the AI review operation was being written.');
      }
      ensureReviewTabIsCurrent(aiTab, filePath, rootPath, parentMessageId);
      if (action === 'apply' || (fileExisted && !(action === 'rollback' && proposalIsNewFile))) {
        updateFromExternal(filePath, savedContent);
      }

      ensureReviewTabIsCurrent(aiTab, filePath, rootPath, parentMessageId);
      if (contentBeforeOperation === null) {
        throw new Error('The current file content could not be read before saving.');
      }
      if (savedContent === null) throw new Error('The file content was not prepared for saving.');
      const originalContent = contentBeforeOperation;
      const committedContent = savedContent;
      chatUpdateAttempted = true;
      const updatedMessage = await updateChatMessage(
        parentSpace.id,
        parentMessageId,
        message => {
          if (!message.editResponse) return {};
          const editResponse =
            action === 'rollback'
              ? markEditResponseFileReverted(message.editResponse, filePath)
              : markEditResponseFileApplied(
                  message.editResponse,
                  filePath,
                  originalContent,
                  committedContent
                );
          return {
            editResponse,
          };
        },
        rootPath
      );
      const updatedFile = updatedMessage?.editResponse?.changedFiles.find(
        file => file.path === filePath
      );
      if (!updatedFile || updatedFile.applied !== (action === 'apply')) {
        throw new Error('The rollback state could not be saved to chat history.');
      }
      if (action === 'apply' && updatedFile.originalContent !== contentBeforeOperation) {
        throw new Error('The current source snapshot could not be saved for rollback.');
      }
      if (action === 'apply' && updatedFile.appliedContent !== savedContent) {
        throw new Error('The applied suggestion could not be saved for rollback.');
      }

      ensureReviewTabIsCurrent(aiTab, filePath, rootPath, parentMessageId);
      const historyEntry = {
        id: `revert-${Date.now()}`,
        timestamp: new Date(),
        content: contentBeforeOperation ?? '',
        note: 'reverted',
      };
      reviewUpdateAttempted = true;
      const updatedEntry = await updateAIReviewEntry(rootPath, filePath, existing => {
        if (existing.parentMessageId !== parentMessageId) {
          throw new Error('AI review metadata belongs to a different source message.');
        }
        if (action === 'rollback') {
          return {
            status: 'reverted',
            originalSnapshot: entry.originalSnapshot,
            history: [historyEntry, ...existing.history],
          };
        }
        return {
          status: 'applied',
          originalSnapshot: contentBeforeOperation ?? '',
        };
      });
      if (!updatedEntry || updatedEntry.parentMessageId !== parentMessageId) {
        throw new Error('The AI review rollback metadata could not be saved.');
      }

      ensureReviewTabIsCurrent(aiTab, filePath, rootPath, parentMessageId);
      if (action === 'apply' && addMessage) {
        try {
          await addMessage(
            `Applied changes to ${filePath}`,
            'assistant',
            'edit',
            [filePath],
            undefined,
            { parentMessageId, action: 'apply', spaceId: parentSpace.id }
          );
        } catch (error) {
          console.error('[AIReviewTabRenderer] Failed to append apply message:', error);
        }
      }

      tabActions.closeTab(aiTab.paneId, aiTab.id);
      return true;
    } catch (error) {
      console.error('[AIReviewTabRenderer] Failed to apply AI review change:', error);
      let fileRecovered = !fileWasChanged;
      if (fileWasChanged && contentBeforeOperation !== null) {
        try {
          const hasDirtyBuffer = tabActions
            .getAllTabs()
            .some(tab => tab.path === filePath && (tab.isDirty || isTabDirty(tab.id)));
          const currentExists = await fsClient.exists(filePath);
          const currentContent = currentExists ? await readAIText(filePath) : null;
          const operationContent = action === 'rollback' && proposalIsNewFile ? null : savedContent;
          const hasDirtyBufferAfterRead = tabActions
            .getAllTabs()
            .some(tab => tab.path === filePath && (tab.isDirty || isTabDirty(tab.id)));
          if (hasDirtyBuffer || hasDirtyBufferAfterRead || currentContent !== operationContent) {
            throw new Error('Recovery was skipped because the file changed during the operation.');
          }
          if (fileExisted) await fsClient.writeFile(filePath, contentBeforeOperation);
          else await fsClient.rm(filePath, { force: true });
          const restoredExists = await fsClient.exists(filePath);
          const restoredContent = restoredExists ? await readAIText(filePath) : null;
          const expectedRestoredContent = fileExisted ? contentBeforeOperation : null;
          if (restoredContent !== expectedRestoredContent) {
            throw new Error('The file did not return to its pre-operation contents.');
          }
          fileRecovered = true;
          const hasDirtyBufferAfterRestore = tabActions
            .getAllTabs()
            .some(tab => tab.path === filePath && (tab.isDirty || isTabDirty(tab.id)));
          if (fileExisted && !hasDirtyBufferAfterRestore) {
            updateFromExternal(filePath, contentBeforeOperation);
          }
        } catch (rollbackError) {
          console.error('[AIReviewTabRenderer] Failed to restore pre-apply file:', rollbackError);
          recoveryFailures.push(
            `The file could not be safely restored: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
          );
        }
      }
      if (chatUpdateAttempted && fileRecovered && parentSpaceId && parentMessageId && rootPath) {
        try {
          const restoredMessage = await updateChatMessage(
            parentSpaceId,
            parentMessageId,
            message => {
              if (!message.editResponse) return {};
              let editResponse = markEditResponseFileReverted(message.editResponse, filePath);
              if (action === 'rollback') {
                if (proposalAppliedContent === null) {
                  throw new Error('The committed file snapshot is unavailable.');
                }
                editResponse = markEditResponseFileApplied(
                  message.editResponse,
                  filePath,
                  proposalOriginal,
                  proposalAppliedContent
                );
              }
              return { editResponse };
            },
            rootPath
          );
          const restoredFile = restoredMessage?.editResponse?.changedFiles.find(
            file => file.path === filePath
          );
          if (!restoredFile || restoredFile.applied !== (action === 'rollback')) {
            throw new Error('Chat history rollback state was not restored.');
          }
        } catch (rollbackError) {
          console.error(
            '[AIReviewTabRenderer] Failed to restore chat rollback state:',
            rollbackError
          );
          recoveryFailures.push(
            `The chat history rollback state could not be restored: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
          );
        }
      } else if (chatUpdateAttempted) {
        recoveryFailures.push('The file was not restored; chat apply state was left unchanged.');
      }
      if (reviewUpdateAttempted && fileRecovered && entry && rootPath) {
        try {
          const restoredEntry = await updateAIReviewEntry(rootPath, filePath, existing => {
            if (existing.parentMessageId !== parentMessageId) {
              throw new Error('AI review metadata belongs to a different source message.');
            }
            return {
              status: entry.status,
              originalSnapshot: entry.originalSnapshot,
              history: existing.history,
            };
          });
          if (!restoredEntry || restoredEntry.parentMessageId !== parentMessageId) {
            throw new Error('AI review metadata was not restored.');
          }
        } catch (rollbackError) {
          console.error(
            '[AIReviewTabRenderer] Failed to restore AI review metadata:',
            rollbackError
          );
          recoveryFailures.push(
            `The AI review metadata could not be restored: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
          );
        }
      } else if (reviewUpdateAttempted) {
        recoveryFailures.push(
          'The file was not restored; AI review apply state was left unchanged.'
        );
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      const message = [errorMessage, ...recoveryFailures].join('\n');
      pushLogMessage(message, 'error', 'AI');
      alert(message);
      return false;
    }
  };

  const handleDiscardChanges = async (filePath: string): Promise<boolean> => {
    const rootPath = aiTab.aiEntry?.rootPath;
    const parentMessageId = aiTab.aiEntry?.parentMessageId;

    if (!rootPath || !parentMessageId) {
      const message = 'This AI review has no source message and cannot be discarded safely.';
      console.error('[AIReviewTabRenderer] Failed to clear AI review metadata:', message);
      pushLogMessage(message, 'error', 'AI');
      alert(message);
      return false;
    }
    try {
      await clearAIReviewEntry(rootPath, filePath, parentMessageId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[AIReviewTabRenderer] Failed to clear AI review metadata:', e);
      pushLogMessage(message, 'error', 'AI');
      alert(message);
      return false;
    }
    markAIReviewDraftDiscarded(aiTab, { rootPath, filePath, parentMessageId });
    tabActions.closeTab(aiTab.paneId, aiTab.id);

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
            parentMessageId,
            action: 'revert',
          }
        );
      } catch (e) {
        const message = `The review was discarded, but the chat notification could not be saved: ${e instanceof Error ? e.message : String(e)}`;
        console.warn('[AIReviewTabRenderer] Failed to append discard message to chat:', e);
        pushLogMessage(message, 'warn', 'AI');
        alert(message);
      }
    }

    return true;
  };

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Loading review...
        </div>
      }
    >
      <AIReviewTabComponent
        tab={tabWithContent}
        onApplyChanges={handleApplyChanges}
        onDiscardChanges={handleDiscardChanges}
        onSuggestedContentChange={handleSuggestedContentChange}
        onUpdateSuggestedContent={handleUpdateSuggestedContent}
      />
    </Suspense>
  );
};

function ensureReviewTabIsCurrent(
  expectedTab: AIReviewTab,
  filePath: string,
  rootPath: string,
  parentMessageId: string
): void {
  const currentTab = tabActions.getTab(expectedTab.paneId, expectedTab.id) as AIReviewTab | null;
  if (
    !currentTab ||
    currentTab.kind !== 'ai' ||
    currentTab.filePath !== filePath ||
    currentTab.aiEntry?.rootPath !== rootPath ||
    currentTab.aiEntry?.parentMessageId !== parentMessageId
  ) {
    throw new Error('The AI review tab changed during this operation. Retry the change.');
  }
}

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
  hasPendingChanges: tab => hasPendingAIReviewDraft(tab as AIReviewTab),
  flushPendingChanges: tab => flushAIReviewDraft(tab as AIReviewTab),
  onClose: tab => {
    for (const [key, state] of aiDraftStates) {
      if (state.tabId !== tab.id) continue;
      aiDraftStates.delete(key);
    }
    clearAIReviewDraftDiscarded(tab.id);
  },

  createTab: (file, options): AIReviewTab => {
    const filePath = String(file.path || file.name || '');
    const aiReviewProps = options?.aiReviewProps;

    if (!aiReviewProps) {
      const message = 'AI review data is missing; the review tab cannot be opened.';
      pushLogMessage(message, 'error', 'AI');
      throw new Error(message);
    }

    const reviewFilePath = aiReviewProps.filePath || filePath;
    const tabId = `ai:${JSON.stringify([
      aiReviewProps.aiEntry?.rootPath ?? null,
      reviewFilePath,
      aiReviewProps.aiEntry?.parentMessageId ?? null,
    ])}`;

    const tab: AIReviewTab = {
      id: tabId,
      name: `AI Review: ${reviewFilePath.split('/').pop() || 'unknown'}`,
      kind: 'ai',
      path: reviewFilePath,
      paneId: options?.paneId || '',
      originalContent: aiReviewProps?.originalContent || '',
      suggestedContent:
        aiReviewProps?.aiEntry?.suggestedContent ?? aiReviewProps?.suggestedContent ?? '',
      filePath: reviewFilePath,
      // optional history passed by caller
      history: aiReviewProps?.history,
      // Preserve the review metadata when supplied.
      aiEntry: aiReviewProps?.aiEntry,
    };

    return tab;
  },

  shouldReuseTab: (existingTab, newFile, options) => {
    const incoming = options?.aiReviewProps;
    const incomingEntry = incoming?.aiEntry;
    if (!incoming || !incomingEntry || existingTab.kind !== 'ai') return false;
    const existing = existingTab as AIReviewTab;
    const incomingFilePath = incoming.filePath || String(newFile.path || newFile.name || '');
    return (
      existing.filePath === incomingFilePath &&
      existing.aiEntry?.rootPath === incomingEntry.rootPath &&
      existing.aiEntry.parentMessageId === incomingEntry.parentMessageId
    );
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

    if (file && typeof file.content === 'string') {
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
