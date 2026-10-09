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

type UpdateChatMessage = (
  spaceId: string,
  messageId: string,
  patch: Partial<ChatSpaceMessage> | ((message: ChatSpaceMessage) => Partial<ChatSpaceMessage>),
  expectedRootPath?: string
) => Promise<ChatSpaceMessage | null>;

interface RollbackOperation {
  messageId: string;
  filePath: string;
  expectedContent: string;
  originalContent: string;
  isNewFile: boolean;
}

interface RollbackProgress {
  operation: RollbackOperation;
  fileChanged: boolean;
  metadataReverted: boolean;
}

interface FileRecoveryResult {
  restored: boolean;
  warning: string | null;
}

interface RevertChatEditsOptions {
  rootPath: string;
  space: ChatSpace | null;
  messageId: string;
  updateChatMessage: UpdateChatMessage;
  revertToMessage: (
    messageId: string,
    expectedLastMessageId?: string,
    expectedSpaceId?: string
  ) => Promise<ChatSpaceMessage[]>;
}

export async function revertChatEdits({
  rootPath,
  space,
  messageId,
  updateChatMessage,
  revertToMessage,
}: RevertChatEditsOptions): Promise<boolean> {
  const progress: RollbackProgress[] = [];
  let activeSpaceId: string | null = null;
  try {
    if (!space || space.rootPath !== rootPath) {
      throw new Error('The chat space is no longer active.');
    }
    activeSpaceId = space.id;
    const targetIndex = space.messages.findIndex(message => message.id === messageId);
    if (targetIndex < 0) throw new Error('The selected message is no longer in this chat.');

    let deleteFromIndex = targetIndex;
    const target = space.messages[targetIndex];
    if (target.type === 'assistant' && targetIndex > 0) {
      const previous = space.messages[targetIndex - 1];
      if (previous.type === 'user') deleteFromIndex -= 1;
    }

    const tail = space.messages.slice(deleteFromIndex);
    const operations = await planRollback(tail);

    for (const operation of operations) {
      const operationProgress: RollbackProgress = {
        operation,
        fileChanged: false,
        metadataReverted: false,
      };
      progress.push(operationProgress);
      await applyRollback(operation, () => {
        operationProgress.fileChanged = true;
      });
      const updated = await updateChatMessage(
        space.id,
        operation.messageId,
        message => {
          if (!message.editResponse) return {};
          return {
            editResponse: markEditResponseFileReverted(message.editResponse, operation.filePath),
          };
        },
        rootPath
      );
      const trackedFile = updated?.editResponse?.changedFiles.find(
        file => file.path === operation.filePath
      );
      if (trackedFile?.applied !== false) {
        throw new Error(`Could not update rollback metadata for ${operation.filePath}.`);
      }
      operationProgress.metadataReverted = true;
      assertNoDirtyTab(operation.filePath);
    }

    const removedMessages = await revertToMessage(messageId, space.messages.at(-1)?.id, space.id);
    if (removedMessages.length === 0) {
      throw new Error('Files were restored, but chat history changed before it could be removed.');
    }

    const metadataWarnings: string[] = [];
    for (const operation of operations) {
      try {
        await clearAIReviewEntry(rootPath, operation.filePath, operation.messageId);
      } catch (error) {
        console.error('[AIPanel] Failed to clear AI review metadata:', error);
        metadataWarnings.push(
          `Reverted ${operation.filePath}, but its AI review metadata could not be cleared: ${String(error)}`
        );
      }
    }
    if (metadataWarnings.length > 0) {
      const warning = metadataWarnings.join('\n');
      pushLogMessage(warning, 'warn', 'AI Edit');
      alert(warning);
    }
    return true;
  } catch (error) {
    const recoveryFailures: string[] = [];
    for (const item of progress.reverse()) {
      const { operation } = item;
      if (!item.fileChanged) continue;
      const fileRecovery = await restoreAppliedFile(operation);
      if (fileRecovery.warning) recoveryFailures.push(fileRecovery.warning);
      if (!fileRecovery.restored) {
        recoveryFailures.push(
          item.metadataReverted
            ? `The file could not be restored while its chat rollback marker remains reverted for ${operation.filePath}.`
            : `The file could not be restored while chat history may still mark it applied for ${operation.filePath}.`
        );
        continue;
      }
      if (!activeSpaceId) {
        recoveryFailures.push(
          `Could not restore rollback tracking for ${operation.filePath}: the chat space is unavailable.`
        );
        continue;
      }
      const recoverySpaceId: string = activeSpaceId;
      const appliedContent: string = operation.expectedContent;
      try {
        const restored = await updateChatMessage(
          recoverySpaceId,
          operation.messageId,
          message => {
            if (!message.editResponse) return {};
            return {
              editResponse: markEditResponseFileApplied(
                message.editResponse,
                operation.filePath,
                operation.originalContent,
                appliedContent
              ),
            };
          },
          rootPath
        );
        const trackedFile = restored?.editResponse?.changedFiles.find(
          file => file.path === operation.filePath
        );
        if (trackedFile?.applied !== true) {
          recoveryFailures.push(`Could not restore rollback tracking for ${operation.filePath}.`);
        }
      } catch (restoreError) {
        console.error('[AIPanel] Failed to restore rollback metadata:', restoreError);
        recoveryFailures.push(
          `Could not restore rollback tracking for ${operation.filePath}: ${String(restoreError)}`
        );
      }
    }
    console.error('[AIPanel] Failed to revert chat edits:', error);
    const message = [
      String(error),
      ...recoveryFailures.map(failure => `Check the recovery state: ${failure}`),
    ].join('\n');
    pushLogMessage(message, 'error', 'AI Edit');
    alert(message);
    return false;
  }
}

async function planRollback(messages: ChatSpaceMessage[]): Promise<RollbackOperation[]> {
  const operations: RollbackOperation[] = [];
  const contents = new Map<string, string | null>();

  for (const message of messages.slice().reverse()) {
    if (message.type !== 'assistant' || message.mode !== 'edit' || !message.editResponse) continue;
    for (const file of message.editResponse.changedFiles) {
      if (file.applied !== true) continue;
      if (typeof file.appliedContent !== 'string') {
        throw new Error(
          `Cannot safely revert ${file.path}: the exact applied content snapshot is missing.`
        );
      }

      if (!contents.has(file.path)) {
        const exists = await fsClient.exists(file.path);
        contents.set(file.path, exists ? await readAIText(file.path) : null);
      }
      const current = contents.get(file.path) ?? null;
      if (file.isNewFile) {
        if (current === null || current !== file.appliedContent) {
          throw new Error(`The file changed after AI applied it: ${file.path}`);
        }
        operations.push({
          messageId: message.id,
          filePath: file.path,
          expectedContent: current,
          originalContent: file.originalContent,
          isNewFile: true,
        });
        contents.set(file.path, null);
        continue;
      }
      if (current === null || current !== file.appliedContent) {
        throw new Error(`The file changed after AI applied it: ${file.path}`);
      }
      operations.push({
        messageId: message.id,
        filePath: file.path,
        expectedContent: current,
        originalContent: file.originalContent,
        isNewFile: false,
      });
      contents.set(file.path, file.originalContent);
    }
  }

  assertNoDirtyTabs(operations);
  return operations;
}

function assertNoDirtyTabs(operations: RollbackOperation[]): void {
  const paths = new Set(operations.map(operation => operation.filePath));
  for (const tab of tabActions.getAllTabs()) {
    if (paths.has(tab.path) && (tab.isDirty || isTabDirty(tab.id))) {
      throw new Error(`Save or discard unsaved file edits before reverting ${tab.path}.`);
    }
  }
}

function assertNoDirtyTab(filePath: string): void {
  for (const tab of tabActions.getAllTabs()) {
    if (tab.path === filePath && (tab.isDirty || isTabDirty(tab.id))) {
      throw new Error(`Save or discard unsaved file edits before reverting ${filePath}.`);
    }
  }
}

async function applyRollback(
  operation: RollbackOperation,
  onFileChanged: () => void
): Promise<void> {
  const exists = await fsClient.exists(operation.filePath);
  const current = exists ? await readAIText(operation.filePath) : null;
  if (current !== operation.expectedContent) {
    throw new Error(`The file changed during rollback: ${operation.filePath}`);
  }
  assertNoDirtyTab(operation.filePath);
  if (operation.isNewFile) {
    await fsClient.rm(operation.filePath, { force: true });
    onFileChanged();
    assertNoDirtyTab(operation.filePath);
    return;
  }
  await fsClient.writeFile(operation.filePath, operation.originalContent);
  onFileChanged();
  assertNoDirtyTab(operation.filePath);
  updateFromExternal(operation.filePath, operation.originalContent);
}

async function restoreAppliedFile(operation: RollbackOperation): Promise<FileRecoveryResult> {
  try {
    assertNoDirtyTab(operation.filePath);
    const exists = await fsClient.exists(operation.filePath);
    const current = exists ? await readAIText(operation.filePath) : null;
    const expectedRollbackContent = operation.isNewFile ? null : operation.originalContent;
    if (current !== expectedRollbackContent) {
      return {
        restored: false,
        warning: `The file changed during rollback recovery; the applied content was not restored for ${operation.filePath}.`,
      };
    }
    assertNoDirtyTab(operation.filePath);
    await fsClient.writeFile(operation.filePath, operation.expectedContent);
    try {
      assertNoDirtyTab(operation.filePath);
    } catch {
      return {
        restored: true,
        warning: `Unsaved editor changes appeared during recovery for ${operation.filePath}; the file was restored and the editor buffer was preserved.`,
      };
    }
    updateFromExternal(operation.filePath, operation.expectedContent);
    return { restored: true, warning: null };
  } catch (error) {
    console.error('[AIPanel] Failed to restore the applied file:', error);
    return {
      restored: false,
      warning: `The applied content could not be restored for ${operation.filePath}: ${String(error)}`,
    };
  }
}
