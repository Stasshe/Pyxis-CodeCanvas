'use client'

import { useState, useEffect, useRef } from 'react'

import type { ChatSpace, ChatSpaceMessage, AIEditResponse } from '@/types'
import {
  getChatSpaces,
  createChatSpace,
  deleteChatSpace,
  renameChatSpace,
  addMessageToChatSpace,
  updateChatSpaceMessage,
  updateChatSpaceSelectedFiles,
  saveChatSpace,
  truncateMessagesFromMessage,
} from '@/engine/storage/chatStorageAdapter'

export const useChatSpace = (projectId: string | null) => {
  const [chatSpaces, setChatSpaces] = useState<ChatSpace[]>([])
  const [currentSpace, setCurrentSpace] = useState<ChatSpace | null>(null)
  const [loading, setLoading] = useState(false)

  const currentSpaceRef = useRef<ChatSpace | null>(null)
  const projectIdRef = useRef<string | null>(projectId)

  useEffect(() => {
    projectIdRef.current = projectId
  }, [projectId])

  useEffect(() => {
    currentSpaceRef.current = currentSpace
  }, [currentSpace])

  useEffect(() => {
    const loadChatSpaces = async () => {
      if (!projectId) {
        setChatSpaces([])
        setCurrentSpace(null)
        currentSpaceRef.current = null
        return
      }

      setLoading(true)
      try {
        const spaces = await getChatSpaces(projectId)
        setChatSpaces(spaces)

        if (spaces.length > 0) {
          setCurrentSpace(spaces[0])
          currentSpaceRef.current = spaces[0]
        } else {
          setCurrentSpace(null)
          currentSpaceRef.current = null
        }
      } catch (error) {
        console.error('Failed to load chat spaces:', error)
      } finally {
        setLoading(false)
      }
    }

    loadChatSpaces()
  }, [projectId])

  const createNewSpace = async (name?: string): Promise<ChatSpace | null> => {
    const pid = projectIdRef.current
    if (!pid) return null
    try {
      const spaces = await getChatSpaces(pid)
      const spaceName = name || `新規チャット`
      const existingNewChat = spaces.find(s => s.name === spaceName)
      if (existingNewChat) {
        setCurrentSpace(existingNewChat)
        currentSpaceRef.current = existingNewChat
        setChatSpaces([existingNewChat, ...spaces.filter(s => s.id !== existingNewChat.id)])
        return existingNewChat
      }

      let toDelete: ChatSpace[] = []
      if (spaces.length >= 10) {
        const sorted = [...spaces].sort(
          (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
        )
        toDelete = sorted.slice(0, spaces.length - 9)
        for (const space of toDelete) {
          try {
            await deleteChatSpace(pid, space.id)
          } catch (error) {
            console.error('Failed to delete old chat space:', error)
          }
        }
      }
      const newSpace = await createChatSpace(pid, spaceName)
      const updatedSpaces = [
        newSpace,
        ...spaces.filter(s => !toDelete.some((d: ChatSpace) => d.id === s.id)),
      ]
      setChatSpaces(updatedSpaces)
      setCurrentSpace(newSpace)
      currentSpaceRef.current = newSpace
      return newSpace
    } catch (error) {
      console.error('Failed to create chat space:', error)
      return null
    }
  }

  const selectSpace = (space: ChatSpace) => {
    setCurrentSpace(space)
    currentSpaceRef.current = space
  }

  const deleteSpace = async (spaceId: string) => {
    const pid = projectIdRef.current
    if (!pid) return

    if (chatSpaces.length <= 1) {
      console.log('最後のスペースは削除できません。')
      return
    }

    try {
      await deleteChatSpace(pid, spaceId)

      setChatSpaces(prev => {
        const filtered = prev.filter(s => s.id !== spaceId)

        if (currentSpace?.id === spaceId) {
          if (filtered.length > 0) {
            setCurrentSpace(filtered[0])
            currentSpaceRef.current = filtered[0]
          } else {
            setCurrentSpace(null)
            currentSpaceRef.current = null
          }
        }

        return filtered
      })
    } catch (error) {
      console.error('Failed to delete chat space:', error)
    }
  }

  const addMessage = async (
    content: string,
    type: 'user' | 'assistant',
    mode: 'ask' | 'edit',
    fileContext?: string[],
    editResponse?: AIEditResponse,
    options?: { parentMessageId?: string; action?: 'apply' | 'revert' | 'note' }
  ): Promise<ChatSpaceMessage | null> => {
    const pid = projectIdRef.current
    if (!pid) {
      console.error('[useChatSpace] No projectId available')
      return null
    }

    let activeSpace = currentSpaceRef.current
    if (!activeSpace) {
      console.warn('[useChatSpace] No current space available - creating a new one')
      try {
        const created = await createNewSpace()
        if (!created) {
          console.error('[useChatSpace] Failed to create chat space for adding message')
          return null
        }
        activeSpace = created
      } catch (e) {
        console.error('[useChatSpace] Error creating chat space:', e)
        return null
      }
    }

    try {
      if (
        (activeSpace.messages || []).length === 0 &&
        type === 'user' &&
        content &&
        content.trim().length > 0
      ) {
        const newName = content.length > 30 ? content.slice(0, 30) + '…' : content
        await renameChatSpace(pid, activeSpace.id, newName)
        setCurrentSpace(prev => (prev ? { ...prev, name: newName } : prev))
        setChatSpaces(prev =>
          prev.map(s => (s.id === activeSpace!.id ? { ...s, name: newName } : s))
        )
      }

      if (options?.parentMessageId && options?.action) {
        const dup = (activeSpace.messages || []).find(
          m =>
            m.parentMessageId === options.parentMessageId &&
            m.action === options.action &&
            m.type === type &&
            m.mode === mode
        )
        if (dup) return dup
      }

      const newMessage = await addMessageToChatSpace(pid, activeSpace.id, {
        type,
        content,
        timestamp: new Date(),
        mode,
        fileContext,
        editResponse,
        parentMessageId: options?.parentMessageId,
        action: options?.action,
      } as ChatSpaceMessage)

      setCurrentSpace(prev => {
        if (!prev) return null
        return {
          ...prev,
          messages: [...prev.messages, newMessage],
        }
      })

      setChatSpaces(prev => {
        const updated = prev.map(s =>
          s.id === activeSpace!.id
            ? { ...s, messages: [...s.messages, newMessage], updatedAt: new Date() }
            : s
        )
        return updated.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      })

      return newMessage
    } catch (error) {
      console.error('[useChatSpace] Failed to add message:', error)
      return null
    }
  }

  const updateChatMessage = async (
    spaceId: string,
    messageId: string,
    patch: Partial<ChatSpaceMessage>
  ) => {
    const pid = projectIdRef.current
    if (!pid) return null

    try {
      const updated = await updateChatSpaceMessage(pid, spaceId, messageId, patch)
      if (!updated) return null

      setCurrentSpace(prev => {
        if (!prev) return null
        return {
          ...prev,
          messages: prev.messages.map(m => (m.id === updated.id ? updated : m)),
        }
      })

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
      )

      return updated
    } catch (error) {
      console.error('[useChatSpace] Failed to update message:', error)
      return null
    }
  }

  const updateSelectedFiles = async (selectedFiles: string[]) => {
    const pid = projectIdRef.current
    if (!pid || !currentSpace) return

    try {
      await updateChatSpaceSelectedFiles(pid, currentSpace.id, selectedFiles)

      setCurrentSpace(prev => {
        if (!prev) return null
        return { ...prev, selectedFiles }
      })

      setChatSpaces(prev =>
        prev.map(space => (space.id === currentSpace.id ? { ...space, selectedFiles } : space))
      )
    } catch (error) {
      console.error('Failed to update selected files:', error)
    }
  }

  const updateSpaceName = async (spaceId: string, newName: string) => {
    try {
      const space = chatSpaces.find(s => s.id === spaceId)
      if (!space) return

      const updatedSpace = { ...space, name: newName }
      await saveChatSpace(updatedSpace)

      setChatSpaces(prev => prev.map(s => (s.id === spaceId ? updatedSpace : s)))

      if (currentSpace?.id === spaceId) {
        setCurrentSpace(updatedSpace)
      }
    } catch (error) {
      console.error('Failed to update space name:', error)
    }
  }

  /**
   * Revert to a specific message: delete all messages from the specified message onwards
   * and return the list of deleted messages for potential rollback of AI state changes.
   *
   * If the target message is an AI assistant response, also delete the corresponding
   * user message that prompted it (user message and AI response are a pair).
   */
  const revertToMessage = async (messageId: string): Promise<ChatSpaceMessage[]> => {
    const pid = projectIdRef.current
    const activeSpace = currentSpaceRef.current

    if (!pid || !activeSpace) {
      console.warn('[useChatSpace] No project or space available for revert')
      return []
    }

    try {
      // Find the target message index
      const targetIdx = activeSpace.messages.findIndex(m => m.id === messageId)
      if (targetIdx === -1) {
        console.warn('[useChatSpace] Target message not found for revert')
        return []
      }

      const targetMessage = activeSpace.messages[targetIdx]

      // Determine the actual start index for deletion
      // If the target is an assistant message, also include the preceding user message
      let deleteFromIdx = targetIdx
      let deleteFromMessageId = messageId

      if (targetMessage.type === 'assistant' && targetIdx > 0) {
        const prevMessage = activeSpace.messages[targetIdx - 1]
        // Include the user message if it's directly before the assistant message
        if (prevMessage.type === 'user') {
          deleteFromIdx = targetIdx - 1
          deleteFromMessageId = prevMessage.id
          console.log('[useChatSpace] Including user message in revert:', prevMessage.id)
        }
      }

      const deletedMessages = await truncateMessagesFromMessage(
        pid,
        activeSpace.id,
        deleteFromMessageId
      )

      if (deletedMessages.length === 0) {
        console.warn('[useChatSpace] No messages were deleted during revert')
        return []
      }

      console.log('[useChatSpace] Reverted messages:', deletedMessages.length)

      setCurrentSpace(prev => {
        if (!prev) return null
        return {
          ...prev,
          messages: prev.messages.slice(0, deleteFromIdx),
          updatedAt: new Date(),
        }
      })

      setChatSpaces(prev =>
        prev
          .map(space => {
            if (space.id !== activeSpace.id) return space
            return {
              ...space,
              messages: space.messages.slice(0, deleteFromIdx),
              updatedAt: new Date(),
            }
          })
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      )

      if (currentSpaceRef.current) {
        currentSpaceRef.current = {
          ...currentSpaceRef.current,
          messages: currentSpaceRef.current.messages.slice(0, deleteFromIdx),
          updatedAt: new Date(),
        }
      }

      return deletedMessages
    } catch (error) {
      console.error('[useChatSpace] Failed to revert to message:', error)
      return []
    }
  }

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
    revertToMessage,
  }
}
