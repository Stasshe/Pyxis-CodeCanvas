'use client';

import { useState, useEffect } from 'react';

import { projectDB } from '@/engine/core/database';
import type { ChatSpace, ChatSpaceMessage, AIEditResponse } from '@/types';

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
        await projectDB.init();
        const spaces = await projectDB.getChatSpaces(projectId);
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
      await projectDB.init();
      const spaces = await projectDB.getChatSpaces(projectId);
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
            await projectDB.deleteChatSpace(space.id);
          } catch (error) {
            console.error('Failed to delete old chat space:', error);
          }
        }
      }
      const newSpace = await projectDB.createChatSpace(projectId, spaceName);
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
      await projectDB.deleteChatSpace(spaceId);

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
    editResponse?: AIEditResponse
  ): Promise<ChatSpaceMessage | null> => {
    if (!currentSpace) {
      console.error('[useChatSpace] No current space available for adding message');
      return null;
    }

    try {
      if (
        currentSpace.messages.length === 0 &&
        type === 'user' &&
        content &&
        content.trim().length > 0
      ) {
        const newName = content.length > 30 ? content.slice(0, 30) + '…' : content;
        await projectDB.renameChatSpace(currentSpace.id, newName);
        setCurrentSpace(prev => (prev ? { ...prev, name: newName } : prev));
        setChatSpaces(prev =>
          prev.map(space => (space.id === currentSpace.id ? { ...space, name: newName } : space))
        );
      }

      // If this is an assistant edit response and an existing assistant edit
      // message is present, update that message instead of appending a new one.
      if (
        type === 'assistant' &&
        mode === 'edit' &&
        editResponse &&
        currentSpace.messages &&
        currentSpace.messages.length > 0
      ) {
        const existing = currentSpace.messages
          .slice()
          .reverse()
          .find(m => m.type === 'assistant' && m.mode === 'edit' && m.editResponse);

        if (existing) {
          // merge content and editResponse into existing message
          const updated = await projectDB.updateChatSpaceMessage(currentSpace.id, existing.id, {
            content,
            editResponse,
            timestamp: new Date(),
          });

          if (updated) {
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
                  space.id === currentSpace.id
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
          }
          // fallback to append if update failed
        }
      }

      // default: append a new message
      const newMessage = await projectDB.addMessageToChatSpace(currentSpace.id, {
        type,
        content,
        timestamp: new Date(),
        mode,
        fileContext,
        editResponse,
      });

      setCurrentSpace(prev => {
        if (!prev) return null;
        return {
          ...prev,
          messages: [...prev.messages, newMessage],
        };
      });

      setChatSpaces(prev => {
        const updated = prev.map(space =>
          space.id === currentSpace.id
            ? { ...space, messages: [...space.messages, newMessage], updatedAt: new Date() }
            : space
        );
        return updated.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      });

      return newMessage;
    } catch (error) {
      console.error('[useChatSpace] Failed to add message:', error);
      return null;
    }
  };

  // 選択ファイルを更新
  const updateSelectedFiles = async (selectedFiles: string[]) => {
    if (!currentSpace) return;

    try {
      await projectDB.updateChatSpaceSelectedFiles(currentSpace.id, selectedFiles);

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
      await projectDB.saveChatSpace(updatedSpace);

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
  };
};
