import { fsClient } from '@/engine/core/fs/index';
import { clearAIReviewEntry } from '@/engine/core/metadata/aiStorageAdapter';
import { readAIText } from '@/engine/ide/ai/textEdits';
import { pushLogMessage } from '@/stores/loggerStore';
import { isTabDirty } from '@/stores/tabContentStore';
import { tabActions, updateFromExternal } from '@/stores/tabState';
import type { ChatSpace, ChatSpaceMessage } from '@/types/index';
import {
  markEditResponseFileApplied,
  markEditResponseFileReverted,
} from './markEditResponseApplied';

type MessagePatch =
  | Partial<ChatSpaceMessage>
  | ((message: ChatSpaceMessage) => Partial<ChatSpaceMessage>);

type UpdateChatMessage = (
  spaceId: string,
  messageId: string,
  patch: MessagePatch,
  expectedRootPath?: string
) => Promise<ChatSpaceMessage | null>;

export async function applyChatEdit(
  rootPath: string,
  space: ChatSpace | null,
  filePath: string,
  newContent: string,
  updateChatMessage: UpdateChatMessage
): Promise<boolean> {
  let originalContent: string | null = null;
  let preparedContent: string | null = null;
  let fileExisted = false;
  let fileWriteAttempted = false;
  let fileWasWritten = false;
  let chatUpdateAttempted = false;
  let editMessageId: string | null = null;

  try {
    const editMessage =
      space?.rootPath === rootPath
        ? [...space.messages]
            .reverse()
            .find(
              message =>
                message.type === 'assistant' &&
                message.mode === 'edit' &&
                message.editResponse?.changedFiles.some(file => file.path === filePath)
            )
        : undefined;
    if (!space || !editMessage?.editResponse) {
      throw new Error(
        'The source edit message is unavailable; the change cannot be tracked for rollback.'
      );
    }
    editMessageId = editMessage.id;
    const proposal = editMessage.editResponse.changedFiles.find(file => file.path === filePath);
    if (!proposal) throw new Error('The selected file is missing from the source edit message.');
    if (hasUnsavedFileTab(filePath)) {
      throw new Error('Save or discard unsaved file edits before applying this suggestion.');
    }

    fileExisted = await fsClient.exists(filePath);
    if (fileExisted === Boolean(proposal.isNewFile)) {
      throw new Error('The file was created or removed after this suggestion was generated.');
    }
    originalContent = fileExisted ? await readAIText(filePath) : '';
    if (originalContent !== proposal.originalContent) {
      throw new Error(
        'The file changed after this suggestion was generated. Review a new suggestion before applying it.'
      );
    }
    const appliedFromContent = originalContent;
    if (appliedFromContent === null) {
      throw new Error('The original file content could not be read before applying the change.');
    }
    if (hasUnsavedFileTab(filePath)) {
      throw new Error('The file has unsaved edits; save or discard them before continuing.');
    }

    let contentToApply = newContent;
    if (originalContent.startsWith('\uFEFF') && !newContent.startsWith('\uFEFF')) {
      contentToApply = `\uFEFF${newContent}`;
    }
    preparedContent = contentToApply;
    const committedContent: string = contentToApply;
    fileWriteAttempted = true;
    await fsClient.writeFile(filePath, committedContent);
    fileWasWritten = true;
    if (hasUnsavedFileTab(filePath)) {
      throw new Error(`Unsaved edits appeared while applying ${filePath}.`);
    }
    updateFromExternal(filePath, committedContent);

    chatUpdateAttempted = true;
    const updated = await updateChatMessage(
      space.id,
      editMessage.id,
      message => {
        if (!message.editResponse) return {};
        return {
          editResponse: markEditResponseFileApplied(
            message.editResponse,
            filePath,
            appliedFromContent,
            committedContent
          ),
        };
      },
      rootPath
    );
    const trackedFile = updated?.editResponse?.changedFiles.find(file => file.path === filePath);
    if (
      !trackedFile?.applied ||
      trackedFile.originalContent !== appliedFromContent ||
      trackedFile.appliedContent !== committedContent
    ) {
      throw new Error('The applied change could not be saved to chat history for rollback.');
    }

    try {
      await clearAIReviewEntry(rootPath, filePath, editMessage.id);
    } catch (error) {
      console.error('[AIPanel] Failed to clear AI review metadata:', error);
      const warning = `Applied ${filePath}, but its AI review metadata could not be cleared: ${String(error)}`;
      pushLogMessage(warning, 'warn', 'AI Edit');
      alert(warning);
    }
    return true;
  } catch (error) {
    console.error('[AIPanel] Failed to apply changes:', error);
    const recoveryFailures: string[] = [];
    const fileRecovery = await restoreFile(
      filePath,
      fileExisted,
      originalContent,
      preparedContent,
      fileWriteAttempted,
      fileWasWritten
    );
    if (fileRecovery.warning) recoveryFailures.push(fileRecovery.warning);
    if (!fileRecovery.restored && !chatUpdateAttempted) {
      recoveryFailures.push(
        `The file may contain the applied content, but chat history does not record it as applied.`
      );
    }
    if (!fileRecovery.restored && chatUpdateAttempted) {
      recoveryFailures.push(`Chat rollback status could not be safely reconciled for ${filePath}.`);
    }
    if (chatUpdateAttempted && fileRecovery.restored && space && editMessageId) {
      try {
        const reverted = await updateChatMessage(
          space.id,
          editMessageId,
          message => {
            if (!message.editResponse) return {};
            return {
              editResponse: markEditResponseFileReverted(message.editResponse, filePath),
            };
          },
          rootPath
        );
        const trackedFile = reverted?.editResponse?.changedFiles.find(
          file => file.path === filePath
        );
        if (trackedFile?.applied !== false) {
          recoveryFailures.push(`Could not restore rollback tracking for ${filePath}.`);
        }
      } catch (metadataError) {
        console.error('[AIPanel] Failed to restore chat rollback metadata:', metadataError);
        recoveryFailures.push(
          `Could not restore rollback tracking for ${filePath}: ${String(metadataError)}`
        );
      }
    }
    const message = [
      `Failed to apply the change: ${String(error)}`,
      ...recoveryFailures.map(failure => `Check the recovery state: ${failure}`),
    ].join('\n');
    pushLogMessage(message, 'error', 'AI Edit');
    alert(message);
    return false;
  }
}

function hasUnsavedFileTab(filePath: string): boolean {
  return tabActions
    .getAllTabs()
    .some(tab => tab.path === filePath && (tab.isDirty || isTabDirty(tab.id)));
}

async function restoreFile(
  filePath: string,
  fileExisted: boolean,
  originalContent: string | null,
  expectedContent: string | null,
  fileWriteAttempted: boolean,
  fileWasWritten: boolean
): Promise<{ restored: boolean; warning: string | null }> {
  if (!fileWriteAttempted || originalContent === null) {
    return { restored: true, warning: null };
  }
  try {
    const exists = await fsClient.exists(filePath);
    const current = exists ? await readAIText(filePath) : null;
    const restoredContent = fileExisted ? originalContent : null;
    if (current === restoredContent) return { restored: true, warning: null };
    if (!fileWasWritten || expectedContent === null || current !== expectedContent) {
      return {
        restored: false,
        warning: `The file changed during recovery; the previous content was not restored for ${filePath}.`,
      };
    }
    if (hasUnsavedFileTab(filePath)) {
      return {
        restored: false,
        warning: `The file has unsaved editor changes; the previous content was not restored for ${filePath}.`,
      };
    }
    if (fileExisted) {
      await fsClient.writeFile(filePath, originalContent);
      if (hasUnsavedFileTab(filePath)) {
        return {
          restored: true,
          warning: `Unsaved editor changes appeared during recovery for ${filePath}; the file was restored and the editor buffer was preserved.`,
        };
      }
      updateFromExternal(filePath, originalContent);
      return { restored: true, warning: null };
    }
    await fsClient.rm(filePath, { force: true });
    if (hasUnsavedFileTab(filePath)) {
      return {
        restored: true,
        warning: `Unsaved editor changes appeared during recovery for ${filePath}; the file was restored and the editor buffer was preserved.`,
      };
    }
    return { restored: true, warning: null };
  } catch (error) {
    console.error('[AIPanel] Failed to restore the pre-apply file:', error);
    return {
      restored: false,
      warning: `The previous content could not be restored for ${filePath}: ${String(error)}`,
    };
  }
}
