import { useCallback, useEffect, useRef, useState } from 'react';

import {
  addChatSpaceChangeListener,
  addMessageToChatSpace,
  createChatSpace,
  deleteChatSpace,
  getChatSpaces,
  renameChatSpace,
  truncateMessagesFromMessage,
  updateChatSpaceMessage,
  updateChatSpaceSelectedFiles,
} from '@/engine/storage/chatStorageAdapter';
import { pushLogMessage } from '@/stores/loggerStore';
import type { AIEditResponse, ChatSpace, ChatSpaceMessage } from '@/types';
import { applyChatSpaceChange } from './chatSpaceChanges';

export const useChatSpace = (rootPath: string | null) => {
  const [chatSpaces, setChatSpaces] = useState<ChatSpace[]>([]);
  const [currentSpace, setCurrentSpace] = useState<ChatSpace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentSpaceRef = useRef<ChatSpace | null>(null);
  const rootPathRef = useRef<string | null>(rootPath);
  const currentSpaceRootRef = useRef<string | null>(rootPath);
  const workspaceGenerationRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const spaceChangeRevisionRef = useRef(0);
  const isCurrentWorkspace = useCallback(
    (workspacePath: string, generation: number): boolean =>
      rootPathRef.current === workspacePath &&
      currentSpaceRootRef.current === workspacePath &&
      workspaceGenerationRef.current === generation,
    []
  );
  const reportFailure = useCallback(
    (workspacePath: string, generation: number, action: string, cause: string) => {
      if (!isCurrentWorkspace(workspacePath, generation)) return;
      const message = `${action}: ${cause}`;
      console.error(`[useChatSpace] ${message}`);
      setError(message);
      pushLogMessage(message, 'error', 'AI');
    },
    [isCurrentWorkspace]
  );
  if (rootPathRef.current !== rootPath) {
    rootPathRef.current = rootPath;
    currentSpaceRootRef.current = rootPath;
    currentSpaceRef.current = null;
    workspaceGenerationRef.current += 1;
  }

  const updateCurrentSpaceIfActive = (
    spaceId: string,
    update: (space: ChatSpace) => ChatSpace
  ): void => {
    const current = currentSpaceRef.current;
    if (!current || currentSpaceRootRef.current !== rootPathRef.current || current.id !== spaceId)
      return;
    const updated = update(current);
    currentSpaceRef.current = updated;
    setCurrentSpace(updated);
  };

  useEffect(() => {
    const generation = ++loadGenerationRef.current;
    currentSpaceRef.current = null;
    currentSpaceRootRef.current = rootPath;
    const loadChatSpaces = async () => {
      setError(null);
      if (!rootPath) {
        setChatSpaces([]);
        setCurrentSpace(null);
        currentSpaceRef.current = null;
        return;
      }

      setLoading(true);
      try {
        let spaces: ChatSpace[];
        let revision: number;
        do {
          revision = spaceChangeRevisionRef.current;
          spaces = await getChatSpaces(rootPath);
          if (generation !== loadGenerationRef.current || rootPathRef.current !== rootPath) return;
        } while (revision !== spaceChangeRevisionRef.current);
        if (generation !== loadGenerationRef.current || rootPathRef.current !== rootPath) return;
        setChatSpaces(spaces);

        if (spaces.length > 0) {
          setCurrentSpace(spaces[0]);
          currentSpaceRef.current = spaces[0];
        } else {
          setCurrentSpace(null);
          currentSpaceRef.current = null;
        }
      } catch (error) {
        if (generation !== loadGenerationRef.current || rootPathRef.current !== rootPath) return;
        let cause: string;
        if (error instanceof Error) cause = error.message;
        else cause = String(error);
        reportFailure(
          rootPath,
          workspaceGenerationRef.current,
          'Failed to load chat spaces',
          cause
        );
      } finally {
        if (generation === loadGenerationRef.current && rootPathRef.current === rootPath) {
          setLoading(false);
        }
      }
    };

    setChatSpaces([]);
    setCurrentSpace(null);
    setLoading(Boolean(rootPath));
    loadChatSpaces();
    return () => {
      if (generation === loadGenerationRef.current) loadGenerationRef.current += 1;
    };
  }, [reportFailure, rootPath]);

  useEffect(() => {
    if (!rootPath) return;
    const generation = workspaceGenerationRef.current;
    return addChatSpaceChangeListener(event => {
      if (!isCurrentWorkspace(rootPath, generation)) return;
      spaceChangeRevisionRef.current += 1;

      currentSpaceRef.current = applyChatSpaceChange(rootPath, event, {
        chatSpaces: [],
        currentSpace: currentSpaceRef.current,
      }).currentSpace;
      setCurrentSpace(previous => {
        if (!isCurrentWorkspace(rootPath, generation)) return previous;
        return applyChatSpaceChange(rootPath, event, {
          chatSpaces: [],
          currentSpace: previous,
        }).currentSpace;
      });
      setChatSpaces(previous => {
        if (!isCurrentWorkspace(rootPath, generation)) return previous;
        return applyChatSpaceChange(rootPath, event, {
          chatSpaces: previous,
          currentSpace: null,
        }).chatSpaces;
      });
    });
  }, [isCurrentWorkspace, rootPath]);

  const createNewSpace = async (name?: string): Promise<ChatSpace | null> => {
    const workspacePath = rootPathRef.current;
    if (!workspacePath) return null;
    const workspaceGeneration = workspaceGenerationRef.current;
    try {
      const spaces = await getChatSpaces(workspacePath);
      if (!isCurrentWorkspace(workspacePath, workspaceGeneration)) return null;
      const spaceName = name || '新規チャット';
      const existingNewChat = spaces.find(s => s.name === spaceName);
      if (existingNewChat) {
        setCurrentSpace(existingNewChat);
        currentSpaceRef.current = existingNewChat;
        setChatSpaces([existingNewChat, ...spaces.filter(s => s.id !== existingNewChat.id)]);
        return existingNewChat;
      }

      const newSpace = await createChatSpace(workspacePath, spaceName);
      if (!isCurrentWorkspace(workspacePath, workspaceGeneration)) return newSpace;
      setChatSpaces(previous =>
        [newSpace, ...previous.filter(space => space.id !== newSpace.id)].sort(
          (first, second) => second.updatedAt.getTime() - first.updatedAt.getTime()
        )
      );
      setCurrentSpace(newSpace);
      currentSpaceRef.current = newSpace;
      return newSpace;
    } catch (error) {
      if (!isCurrentWorkspace(workspacePath, workspaceGeneration)) return null;
      console.error('Failed to create chat space:', error);
      throw error;
    }
  };

  const selectSpace = (space: ChatSpace) => {
    const workspacePath = rootPathRef.current;
    if (
      !workspacePath ||
      !isCurrentWorkspace(workspacePath, workspaceGenerationRef.current) ||
      space.rootPath !== workspacePath
    )
      return;
    setCurrentSpace(space);
    currentSpaceRef.current = space;
  };

  const deleteSpace = async (spaceId: string): Promise<boolean> => {
    const workspacePath = rootPathRef.current;
    if (!workspacePath) return false;
    const workspaceGeneration = workspaceGenerationRef.current;

    try {
      const latestSpaces = await getChatSpaces(workspacePath);
      if (!isCurrentWorkspace(workspacePath, workspaceGeneration)) return false;
      if (latestSpaces.length <= 1) {
        return false;
      }

      const deletedCurrentSpace = currentSpaceRef.current?.id === spaceId;
      await deleteChatSpace(workspacePath, spaceId);
      if (!isCurrentWorkspace(workspacePath, workspaceGeneration)) return false;
      const remainingSpaces = latestSpaces.filter(space => space.id !== spaceId);
      setChatSpaces(remainingSpaces);

      if (deletedCurrentSpace) {
        const nextSpace = remainingSpaces[0] ?? null;
        currentSpaceRef.current = nextSpace;
        setCurrentSpace(nextSpace);
      }
      setError(null);
      return true;
    } catch (error) {
      let cause: string;
      if (error instanceof Error) cause = error.message;
      else cause = String(error);
      reportFailure(workspacePath, workspaceGeneration, 'Failed to delete chat space', cause);
      return false;
    }
  };

  const addMessage = async (
    content: string,
    type: 'user' | 'assistant',
    mode: 'ask' | 'edit',
    fileContext?: string[],
    editResponse?: AIEditResponse,
    options?: {
      parentMessageId?: string;
      action?: 'apply' | 'revert' | 'note';
      spaceId?: string;
      rootPath?: string;
    }
  ): Promise<ChatSpaceMessage | null> => {
    const workspacePath = rootPathRef.current;
    if (!workspacePath || (options?.rootPath && options.rootPath !== workspacePath)) {
      console.warn('[useChatSpace] Workspace changed before the message could be added');
      return null;
    }
    const workspaceGeneration = workspaceGenerationRef.current;

    let activeSpace = currentSpaceRef.current;
    if (options?.spaceId && activeSpace?.id !== options.spaceId) {
      const spaces = await getChatSpaces(workspacePath);
      if (!isCurrentWorkspace(workspacePath, workspaceGeneration)) return null;
      activeSpace = spaces.find(space => space.id === options.spaceId) ?? null;
      if (!activeSpace) return null;
    }
    if (!isCurrentWorkspace(workspacePath, workspaceGeneration)) activeSpace = null;
    if (!activeSpace) {
      console.warn('[useChatSpace] No current space available - creating a new one');
      try {
        const created = await createNewSpace();
        if (!created) {
          console.error('[useChatSpace] Failed to create chat space for adding message');
          return null;
        }
        activeSpace = created;
        if (!isCurrentWorkspace(workspacePath, workspaceGeneration)) return null;
      } catch (e) {
        console.error('[useChatSpace] Error creating chat space:', e);
        return null;
      }
    }

    try {
      if (
        (activeSpace.messages || []).length === 0 &&
        type === 'user' &&
        content &&
        content.trim().length > 0
      ) {
        const newName = content.length > 30 ? `${content.slice(0, 30)}…` : content;
        const updatedAt = new Date();
        await renameChatSpace(workspacePath, activeSpace.id, newName);
        if (!isCurrentWorkspace(workspacePath, workspaceGeneration)) return null;
        updateCurrentSpaceIfActive(activeSpace.id, space => ({
          ...space,
          name: newName,
          updatedAt,
        }));
        setChatSpaces(prev =>
          prev.map(s => (s.id === activeSpace?.id ? { ...s, name: newName, updatedAt } : s))
        );
      }

      if (options?.parentMessageId && options?.action) {
        const dup = (activeSpace.messages || []).find(
          m =>
            m.parentMessageId === options.parentMessageId &&
            m.action === options.action &&
            m.type === type &&
            m.mode === mode
        );
        if (dup) return dup;
      }

      const newMessage = await addMessageToChatSpace(workspacePath, activeSpace.id, {
        type,
        content,
        timestamp: new Date(),
        mode,
        fileContext,
        editResponse,
        parentMessageId: options?.parentMessageId,
        action: options?.action,
      } as ChatSpaceMessage);
      if (!isCurrentWorkspace(workspacePath, workspaceGeneration)) return newMessage;

      updateCurrentSpaceIfActive(activeSpace.id, space => ({
        ...space,
        messages: space.messages.some(message => message.id === newMessage.id)
          ? space.messages
          : [...space.messages, newMessage],
        updatedAt: new Date(),
      }));

      setChatSpaces(prev => {
        const updated = prev.map(s =>
          s.id === activeSpace?.id
            ? {
                ...s,
                messages: s.messages.some(message => message.id === newMessage.id)
                  ? s.messages
                  : [...s.messages, newMessage],
                updatedAt: new Date(),
              }
            : s
        );
        return updated.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      });

      return newMessage;
    } catch (error) {
      console.error('[useChatSpace] Failed to add message:', error);
      return null;
    }
  };

  const updateChatMessage = async (
    spaceId: string,
    messageId: string,
    patch: Partial<ChatSpaceMessage> | ((message: ChatSpaceMessage) => Partial<ChatSpaceMessage>),
    expectedRootPath?: string
  ) => {
    const workspacePath = rootPathRef.current;
    if (!workspacePath || (expectedRootPath && workspacePath !== expectedRootPath)) return null;
    const workspaceGeneration = workspaceGenerationRef.current;

    try {
      const updated = await updateChatSpaceMessage(workspacePath, spaceId, messageId, patch);
      if (!isCurrentWorkspace(workspacePath, workspaceGeneration)) return updated;
      if (!updated) return null;

      updateCurrentSpaceIfActive(spaceId, space => ({
        ...space,
        messages: space.messages.map(message => (message.id === updated.id ? updated : message)),
        updatedAt: new Date(),
      }));

      setChatSpaces(prev =>
        prev
          .map(space =>
            space.id === spaceId
              ? {
                  ...space,
                  messages: space.messages.map(m => (m.id === updated.id ? updated : m)),
                  updatedAt: new Date(),
                }
              : space
          )
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      );

      return updated;
    } catch (error) {
      console.error('[useChatSpace] Failed to update message:', error);
      return null;
    }
  };

  const updateSelectedFiles = async (selectedFiles: string[]) => {
    const workspacePath = rootPathRef.current;
    const activeSpace = currentSpaceRef.current;
    if (!workspacePath || !activeSpace) return;
    const workspaceGeneration = workspaceGenerationRef.current;

    try {
      await updateChatSpaceSelectedFiles(workspacePath, activeSpace.id, selectedFiles);
      if (!isCurrentWorkspace(workspacePath, workspaceGeneration)) return;

      const updatedAt = new Date();
      updateCurrentSpaceIfActive(activeSpace.id, space => ({
        ...space,
        selectedFiles,
        updatedAt,
      }));

      setChatSpaces(prev =>
        prev.map(space =>
          space.id === activeSpace.id ? { ...space, selectedFiles, updatedAt } : space
        )
      );
    } catch (error) {
      console.error('Failed to update selected files:', error);
      throw error;
    }
  };

  const updateSpaceName = async (spaceId: string, newName: string): Promise<boolean> => {
    const workspacePath = rootPathRef.current;
    if (!workspacePath) return false;
    const workspaceGeneration = workspaceGenerationRef.current;

    try {
      await renameChatSpace(workspacePath, spaceId, newName);
      if (!isCurrentWorkspace(workspacePath, workspaceGeneration)) return false;
      const updatedAt = new Date();
      setChatSpaces(prev =>
        prev
          .map(space => (space.id === spaceId ? { ...space, name: newName, updatedAt } : space))
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      );
      updateCurrentSpaceIfActive(spaceId, space => ({ ...space, name: newName, updatedAt }));
      setError(null);
      return true;
    } catch (error) {
      let cause: string;
      if (error instanceof Error) cause = error.message;
      else cause = String(error);
      reportFailure(workspacePath, workspaceGeneration, 'Failed to update chat space name', cause);
      return false;
    }
  };

  /**
   * Revert to a specific message: delete all messages from the specified message onwards
   * and return the list of deleted messages for potential rollback of AI state changes.
   *
   * If the target message is an AI assistant response, also delete the corresponding
   * user message that prompted it (user message and AI response are a pair).
   */
  const revertToMessage = async (
    messageId: string,
    expectedLastMessageId?: string,
    expectedSpaceId?: string
  ): Promise<ChatSpaceMessage[]> => {
    const workspacePath = rootPathRef.current;
    const activeSpace = currentSpaceRef.current;

    if (!workspacePath || !activeSpace || (expectedSpaceId && activeSpace.id !== expectedSpaceId)) {
      console.warn('[useChatSpace] No project or space available for revert');
      return [];
    }
    const workspaceGeneration = workspaceGenerationRef.current;
    if (expectedLastMessageId && activeSpace.messages.at(-1)?.id !== expectedLastMessageId) {
      console.warn('[useChatSpace] Chat changed during revert; keeping its history');
      return [];
    }

    // Find the target message index
    const targetIdx = activeSpace.messages.findIndex(m => m.id === messageId);
    if (targetIdx === -1) {
      console.warn('[useChatSpace] Target message not found for revert');
      return [];
    }

    const targetMessage = activeSpace.messages[targetIdx];

    // Determine the actual start index for deletion
    // If the target is an assistant message, also include the preceding user message
    let deleteFromIdx = targetIdx;
    let deleteFromMessageId = messageId;

    if (targetMessage.type === 'assistant' && targetIdx > 0) {
      const prevMessage = activeSpace.messages[targetIdx - 1];
      // Include the user message if it's directly before the assistant message
      if (prevMessage.type === 'user') {
        deleteFromIdx = targetIdx - 1;
        deleteFromMessageId = prevMessage.id;
        console.log('[useChatSpace] Including user message in revert:', prevMessage.id);
      }
    }

    const deletedMessages = await truncateMessagesFromMessage(
      workspacePath,
      activeSpace.id,
      deleteFromMessageId,
      expectedLastMessageId
    );
    if (!isCurrentWorkspace(workspacePath, workspaceGeneration)) return deletedMessages;

    if (deletedMessages.length === 0) {
      console.warn('[useChatSpace] No messages were deleted during revert');
      return [];
    }

    console.log('[useChatSpace] Reverted messages:', deletedMessages.length);

    setChatSpaces(prev =>
      prev
        .map(space => {
          if (space.id !== activeSpace.id) return space;
          return {
            ...space,
            messages: space.messages.slice(0, deleteFromIdx),
            updatedAt: new Date(),
          };
        })
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    );

    updateCurrentSpaceIfActive(activeSpace.id, space => ({
      ...space,
      messages: space.messages.slice(0, deleteFromIdx),
      updatedAt: new Date(),
    }));

    return deletedMessages;
  };

  return {
    chatSpaces,
    currentSpace,
    loading,
    error,
    createNewSpace,
    selectSpace,
    deleteSpace,
    addMessage,
    updateSelectedFiles,
    updateSpaceName,
    updateChatMessage,
    revertToMessage,
  };
};
