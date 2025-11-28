'use client';

import { useState, useEffect } from 'react';

import { projectDB } from '@/engine/core/database';
import type { ChatSpace, ChatSpaceMessage, AIEditResponse } from '@/types';
import * as chatStore from '@/engine/storage/chatStorageAdapter';

export const useChatSpace = (projectId: string | null) => {
  const [chatSpaces, setChatSpaces] = useState<ChatSpace[]>([]);
  const [currentSpace, setCurrentSpace] = useState<ChatSpace | null>(null);
  const [loading, setLoading] = useState(false);

  // プロジェクトが変更されたときにチャットスペースを読み込み
  useEffect(() => {
    const loadChatSpaces = async () => {
      if (!projectId) {
        setChatSpaces([]);
        setCurrentSpace(null);
        return;
      }

      setLoading(true);
      try {
        const spaces = await chatStore.getChatSpaces(projectId);
        setChatSpaces(spaces);

        // 最新のスペースを自動選択（存在する場合）
        if (spaces.length > 0) {
          setCurrentSpace(spaces[0]);
        } else {
          setCurrentSpace(null);
        }
      } catch (error) {
        console.error('Failed to load chat spaces:', error);
      } finally {
        setLoading(false);
      }
    };

    loadChatSpaces();
  }, [projectId]);

  // 新規チャットスペースがあればそれを開き、なければ新規作成
  const createNewSpace = async (name?: string): Promise<ChatSpace | null> => {
    if (!projectId) return null;
    try {
      const spaces = await chatStore.getChatSpaces(projectId);
      const spaceName = name || `新規チャット`;
      const existingNewChat = spaces.find(s => s.name === spaceName);
      if (existingNewChat) {
        setCurrentSpace(existingNewChat);
        setChatSpaces([existingNewChat, ...spaces.filter(s => s.id !== existingNewChat.id)]);
        return existingNewChat;
      }

      let toDelete: ChatSpace[] = [];
      if (spaces.length >= 10) {
        const sorted = [...spaces].sort(
          (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
        );
        toDelete = sorted.slice(0, spaces.length - 9);
        for (const space of toDelete) {
          try {
            await chatStore.deleteChatSpace(space.id);
          } catch (error) {
            console.error('Failed to delete old chat space:', error);
          }
        }
      }
      const newSpace = await chatStore.createChatSpace(projectId, spaceName);
      const updatedSpaces = [
        newSpace,
        ...spaces.filter(s => !toDelete.some((d: ChatSpace) => d.id === s.id)),
      ];
      setChatSpaces(updatedSpaces);
      setCurrentSpace(newSpace);
      return newSpace;
    } catch (error) {
      console.error('Failed to create chat space:', error);
      return null;
    }
  };

  // チャットスペースを選択
  const selectSpace = (space: ChatSpace) => {
    setCurrentSpace(space);
  };

  // チャットスペースを削除
  const deleteSpace = async (spaceId: string) => {
    if (chatSpaces.length <= 1) {
      console.log('最後のスペースは削除できません。');
      return;
    }

    try {
      await chatStore.deleteChatSpace(spaceId);

      setChatSpaces(prev => {
        const filtered = prev.filter(s => s.id !== spaceId);

        if (currentSpace?.id === spaceId) {
          if (filtered.length > 0) {
            setCurrentSpace(filtered[0]);
          } else {
            setCurrentSpace(null);
          }
        }

        return filtered;
      });
    } catch (error) {
      console.error('Failed to delete chat space:', error);
    }
  };

  // メッセージを追加
  const addMessage = async (
    content: string,
    type: 'user' | 'assistant',
    mode: 'ask' | 'edit',
    fileContext?: string[],
    editResponse?: AIEditResponse,
    options?: { parentMessageId?: string; action?: 'apply' | 'revert' | 'note' }
  ): Promise<ChatSpaceMessage | null> => {
    // Ensure we have an active space. If none exists, create one automatically.
    let activeSpace = currentSpace;
    if (!activeSpace) {
      console.warn('[useChatSpace] No current space available - creating a new one');
      try {
        const created = await createNewSpace();
        if (!created) {
          console.error('[useChatSpace] Failed to create chat space for adding message');
          return null;
        }
        activeSpace = created;
        // ensure state reflects the new space
        setCurrentSpace(created);
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
        const newName = content.length > 30 ? content.slice(0, 30) + '…' : content;
        await chatStore.renameChatSpace(activeSpace.id, newName);
        setCurrentSpace(prev => (prev ? { ...prev, name: newName } : prev));
        setChatSpaces(prev => prev.map(s => (s.id === activeSpace!.id ? { ...s, name: newName } : s)));
      }

      // NOTE: Previously we attempted to merge assistant edit responses into an
      // existing assistant edit message. That caused multiple edits to overwrite
      // a single message and made only one message have an editResponse (thus
      // only that message showed a Revert button). To ensure each AI edit is
      // independently revertable, always append a new message here.

      // default: append a new message
      // Deduplicate branch messages: if a message with same parentMessageId
      // and action already exists in the current space, return it instead
      // of appending a duplicate. This prevents duplicate 'Applied'/'Reverted'
      // notifications when multiple UI flows record the same event.
      if (options?.parentMessageId && options?.action) {
        const dup = (activeSpace.messages || []).find(
          m => m.parentMessageId === options.parentMessageId && m.action === options.action && m.type === type && m.mode === mode
        );
        if (dup) return dup;
      }

      const newMessage = await chatStore.addMessageToChatSpace(activeSpace.id, {
        type,
        content,
        timestamp: new Date(),
        mode,
        fileContext,
        editResponse,
        parentMessageId: options?.parentMessageId,
        action: options?.action,
      } as ChatSpaceMessage);

      setCurrentSpace(prev => {
        if (!prev) return null;
        return {
          ...prev,
          messages: [...prev.messages, newMessage],
        };
      });

      // Debug: log the newly appended message and current message counts
      try {
        console.log('[useChatSpace] Appended message:', { spaceId: activeSpace.id, messageId: newMessage.id, hasEditResponse: !!newMessage.editResponse });
        const after = (activeSpace.messages || []).length + 1;
        console.log('[useChatSpace] messages count after append approx:', after);
      } catch (e) {
        console.warn('[useChatSpace] debug log failed', e);
      }

      setChatSpaces(prev => {
        const updated = prev.map(s =>
          s.id === activeSpace!.id ? { ...s, messages: [...s.messages, newMessage], updatedAt: new Date() } : s
        );
        return updated.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      });

      return newMessage;
    } catch (error) {
      console.error('[useChatSpace] Failed to add message:', error);
      return null;
    }
  };

  // メッセージを更新（外部から編集された editResponse 等を保存して state を更新）
  const updateChatMessage = async (spaceId: string, messageId: string, patch: Partial<ChatSpaceMessage>) => {
    try {
      const updated = await chatStore.updateChatSpaceMessage(spaceId, messageId, patch);
      if (!updated) return null;

      setCurrentSpace(prev => {
        if (!prev) return null;
        return {
          ...prev,
          messages: prev.messages.map(m => (m.id === updated.id ? updated : m)),
        };
      });

      setChatSpaces(prev =>
        prev
          .map(space =>
            space.id === spaceId
              ? { ...space, messages: space.messages.map(m => (m.id === updated.id ? updated : m)), updatedAt: new Date() }
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

  // 選択ファイルを更新
  const updateSelectedFiles = async (selectedFiles: string[]) => {
    if (!currentSpace) return;

    try {
      await chatStore.updateChatSpaceSelectedFiles(currentSpace.id, selectedFiles);

      setCurrentSpace(prev => {
        if (!prev) return null;
        return { ...prev, selectedFiles };
      });

      setChatSpaces(prev =>
        prev.map(space => (space.id === currentSpace.id ? { ...space, selectedFiles } : space))
      );
    } catch (error) {
      console.error('Failed to update selected files:', error);
    }
  };

  // チャットスペース名を更新
  const updateSpaceName = async (spaceId: string, newName: string) => {
    try {
      const space = chatSpaces.find(s => s.id === spaceId);
      if (!space) return;

      const updatedSpace = { ...space, name: newName };
      await chatStore.saveChatSpace(updatedSpace);

      setChatSpaces(prev => prev.map(s => (s.id === spaceId ? updatedSpace : s)));

      if (currentSpace?.id === spaceId) {
        setCurrentSpace(updatedSpace);
      }
    } catch (error) {
      console.error('Failed to update space name:', error);
    }
  };

  return {
    chatSpaces,
    currentSpace,
    loading,
    createNewSpace,
    selectSpace,
    deleteSpace,
    addMessage,
    updateSelectedFiles,
    updateSpaceName,
    updateChatMessage,
  };
};
