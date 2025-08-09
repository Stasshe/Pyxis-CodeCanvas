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

  // 新しいチャットスペースを作成
  const createNewSpace = async (name?: string): Promise<ChatSpace | null> => {
    if (!projectId) return null;

    try {
      const spaceName = name || `チャット ${new Date().toLocaleString()}`;
      const newSpace = await projectDB.createChatSpace(projectId, spaceName);
      
      setChatSpaces(prev => [newSpace, ...prev]);
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
            // 新しいスペースを非同期で作成（無限ループを避けるため）
            setTimeout(() => {
              createNewSpace();
            }, 0);
          }
        }
        
        return filtered;
      });
    } catch (error) {
      console.error('Failed to delete chat space:', error);
    }
  };

  // メッセージを追加
  const addMessage = async (content: string, type: 'user' | 'assistant', mode: 'chat' | 'edit', fileContext?: string[], editResponse?: AIEditResponse): Promise<ChatSpaceMessage | null> => {
    if (!currentSpace) return null;

    try {
      const newMessage = await projectDB.addMessageToChatSpace(currentSpace.id, {
        type,
        content,
        timestamp: new Date(),
        mode,
        fileContext,
        editResponse
      });

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
      console.error('Failed to add message:', error);
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
