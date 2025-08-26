'use client';

import { useState, useEffect } from 'react';
import { projectDB } from '@/utils/core/database';
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
  }, [projectId]); // currentSpaceをチェックしないように修正

  // 新規チャットスペースがあればそれを開き、なければ新規作成
  const createNewSpace = async (name?: string): Promise<ChatSpace | null> => {
    if (!projectId) return null;
    try {
      await projectDB.init();
      const spaces = await projectDB.getChatSpaces(projectId);
      // 既存の「新規チャット」スペースを探す
      const spaceName = name || `新規チャット`;
      const existingNewChat = spaces.find(s => s.name === spaceName);
      if (existingNewChat) {
        setCurrentSpace(existingNewChat);
        // 最新順に並び替え
        setChatSpaces([existingNewChat, ...spaces.filter(s => s.id !== existingNewChat.id)]);
        return existingNewChat;
      }
      // スペースが10個を超える場合、古いものから削除
      let toDelete: ChatSpace[] = [];
      if (spaces.length >= 10) {
        const sorted = [...spaces].sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
        toDelete = sorted.slice(0, spaces.length - 9);
        for (const space of toDelete) {
          try { await projectDB.deleteChatSpace(space.id); } catch (error) { console.error('Failed to delete old chat space:', error); }
        }
      }
      const newSpace = await projectDB.createChatSpace(projectId, spaceName);
      // 最新のスペースリストを取得して先頭に追加
      const updatedSpaces = [newSpace, ...spaces.filter(s => !toDelete.some((d: ChatSpace) => d.id === s.id))];
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
    // Prevent deleting the last remaining space
    if (chatSpaces.length <= 1) {
      console.log('最後のスペースは削除できません。');
      return;
    }

    try {
      await projectDB.deleteChatSpace(spaceId);

      setChatSpaces(prev => {
        const filtered = prev.filter(s => s.id !== spaceId);

        // 削除されたスペースが現在選択中の場合、他のスペースを選択
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
  const addMessage = async (content: string, type: 'user' | 'assistant', mode: 'ask' | 'edit', fileContext?: string[], editResponse?: AIEditResponse): Promise<ChatSpaceMessage | null> => {
    if (!currentSpace) {
      console.error('[useChatSpace] No current space available for adding message');
      return null;
    }

    console.log('[useChatSpace] Adding message:', {
      spaceId: currentSpace.id,
      type,
      mode,
      hasFileContext: !!fileContext,
      fileContextLength: fileContext?.length || 0,
      hasEditResponse: !!editResponse,
      editResponseFiles: editResponse?.changedFiles?.length || 0
    });

    try {
      // 最初のメッセージかつ type === 'user' の場合のみスペース名をメッセージ内容に変更
      if (currentSpace.messages.length === 0 && type === 'user' && content && content.trim().length > 0) {
        const newName = content.length > 30 ? content.slice(0, 30) + '…' : content;
        await projectDB.renameChatSpace(currentSpace.id, newName);
        setCurrentSpace(prev => prev ? { ...prev, name: newName } : prev);
        setChatSpaces(prev => prev.map(space => space.id === currentSpace.id ? { ...space, name: newName } : space));
      }

      const newMessage = await projectDB.addMessageToChatSpace(currentSpace.id, {
        type,
        content,
        timestamp: new Date(),
        mode,
        fileContext,
        editResponse
      });

      console.log('[useChatSpace] Message added successfully:', newMessage.id);

      // 現在のスペースのメッセージを更新
      setCurrentSpace(prev => {
        if (!prev) return null;
        return {
          ...prev,
          messages: [...prev.messages, newMessage]
        };
      });

      // チャットスペースリストも更新（最新順に並び替え）
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
        prev.map(space => 
          space.id === currentSpace.id 
            ? { ...space, selectedFiles }
            : space
        )
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
      
      setChatSpaces(prev => 
        prev.map(s => s.id === spaceId ? updatedSpace : s)
      );

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
