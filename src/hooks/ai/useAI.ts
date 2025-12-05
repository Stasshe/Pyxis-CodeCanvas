// 統合AIフック

'use client';

import { useState, useCallback, useEffect } from 'react';

import { pushMsgOutPanel } from '@/components/Bottom/BottomPanel';
import { LOCALSTORAGE_KEY } from '@/context/config';
import { getSelectedFileContexts, getCustomInstructions } from '@/engine/ai/contextBuilder';
import { generateCodeEdit, generateChatResponse } from '@/engine/ai/fetchAI';
import { EDIT_PROMPT_TEMPLATE, ASK_PROMPT_TEMPLATE } from '@/engine/ai/prompts';
import {
  parseEditResponse,
  extractFilePathsFromResponse,
  validateResponse,
} from '@/engine/ai/responseParser';
import { fileRepository } from '@/engine/core/fileRepository';
import type { AIFileContext, AIEditResponse, ChatSpaceMessage } from '@/types';

interface UseAIProps {
  onAddMessage?: (
    content: string,
    type: 'user' | 'assistant',
    mode: 'ask' | 'edit',
    fileContext?: string[],
    editResponse?: AIEditResponse
  ) => Promise<ChatSpaceMessage | null>;
  selectedFiles?: string[];
  onUpdateSelectedFiles?: (files: string[]) => void;
  messages?: ChatSpaceMessage[];
  projectId?: string;
}

export function useAI(props?: UseAIProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileContexts, setFileContexts] = useState<AIFileContext[]>([]);

  // storage adapter for AI review metadata
  // import dynamically to avoid circular deps in some build setups
  let aiStorage: typeof import('@/engine/storage/aiStorageAdapter') | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    aiStorage = require('@/engine/storage/aiStorageAdapter');
  } catch (e) {
    aiStorage = null;
  }

  // チャットスペースから選択ファイルが変更された時にファイルコンテキストに反映
  useEffect(() => {
    if (props?.selectedFiles && fileContexts.length > 0) {
      setFileContexts(prev =>
        prev.map(ctx => ({
          ...ctx,
          selected: props.selectedFiles?.includes(ctx.path) || false,
        }))
      );
    }
  }, [props?.selectedFiles]);

  // メッセージを追加
  const addMessage = useCallback(
    async (
      content: string,
      type: 'user' | 'assistant',
      mode: 'ask' | 'edit' = 'ask',
      fileContext?: string[],
      editResponse?: AIEditResponse
    ): Promise<ChatSpaceMessage | null> => {
      if (props?.onAddMessage) {
        try {
          const result = await props.onAddMessage(content, type, mode, fileContext, editResponse);
          // allow parent to return the created/updated message
          if (result && typeof result === 'object') return result as ChatSpaceMessage;
        } catch (e) {
          console.warn('[useAI] onAddMessage threw', e);
        }
      }
      // Always push assistant responses to the BottomPanel so user sees AI replies
      try {
        if (type === 'assistant') {
          const ctx = mode === 'edit' ? 'AI (edit)' : 'AI';
          const msg = typeof content === 'string' ? content : JSON.stringify(content);
          pushMsgOutPanel(msg, 'info', ctx);
        }
      } catch (e) {
        console.warn('[useAI] pushMsgOutPanel failed', e);
      }
      return null;
    },
    [props?.onAddMessage]
  );

  // メッセージを送信（Ask/Edit統合）
  const sendMessage = useCallback(
    async (content: string, mode: 'ask' | 'edit'): Promise<AIEditResponse | null> => {
      const apiKey = localStorage.getItem(LOCALSTORAGE_KEY.GEMINI_API_KEY);
      if (!apiKey) {
        throw new Error('Gemini APIキーが設定されていません。設定画面で設定してください。');
      }

      const selectedFiles = getSelectedFileContexts(fileContexts);

      // ユーザーメッセージを追加
      await addMessage(
        content,
        'user',
        mode,
        selectedFiles.map(f => f.path)
      );

      // 過去メッセージから必要な情報のみ抽出（editResponseも含めてプロンプト最適化に使用）
      const previousMessages = props?.messages
        ?.filter(msg => typeof msg.content === 'string' && msg.content.trim().length > 0)
        ?.map(msg => ({
          type: msg.type,
          content: msg.content,
          mode: msg.mode,
          editResponse: msg.editResponse, // プロンプト最適化用
        }));

      setIsProcessing(true);
      try {
        // Get custom instructions if available
        const customInstructions = getCustomInstructions(fileContexts);

        if (mode === 'ask') {
          // Ask モード
          const prompt = ASK_PROMPT_TEMPLATE(selectedFiles, content, previousMessages, customInstructions);
          const response = await generateChatResponse(prompt, [], apiKey);

          await addMessage(response, 'assistant', 'ask');
          return null;
        } else {
          // Edit モード
          const prompt = EDIT_PROMPT_TEMPLATE(selectedFiles, content, previousMessages, customInstructions);
          const response = await generateCodeEdit(prompt, apiKey);

          // レスポンスのバリデーション
          const validation = validateResponse(response);
          if (!validation.isValid) {
            console.warn('[useAI] Response validation errors:', validation.errors);
          }
          if (validation.warnings.length > 0) {
            console.warn('[useAI] Response validation warnings:', validation.warnings);
          }

          // レスポンスをパース
          const responsePaths = extractFilePathsFromResponse(response);
          console.log(
            '[useAI] Selected files:',
            selectedFiles.map(f => ({ path: f.path, contentLength: f.content.length }))
          );
          console.log('[useAI] Response paths:', responsePaths);

          // 重複を避けるため、既に selectedFiles に含まれているパスを除外
          const selectedPathsSet = new Set(selectedFiles.map(f => f.path));
          const newPaths = responsePaths.filter((path: string) => !selectedPathsSet.has(path));

          console.log('[useAI] New paths (not in selected):', newPaths);

          // Fetch actual content for files not in selectedFiles from the repository
          const newFilesWithContent = await Promise.all(
            newPaths.map(async (path: string) => {
              try {
                if (props?.projectId) {
                  await fileRepository.init();
                  const file = await fileRepository.getFileByPath(props.projectId, path);
                  if (file && file.content) {
                    console.log('[useAI] Fetched existing file content for:', path);
                    return { path, content: file.content, isNewFile: false };
                  }
                }
              } catch (e) {
                console.warn('[useAI] Could not fetch file content for:', path, e);
              }
              // This is a new file that will be created
              return { path, content: '', isNewFile: true };
            })
          );

          // Define proper type for file objects with isNewFile
          interface OriginalFileWithMeta {
            path: string;
            content: string;
            isNewFile: boolean;
          }

          const allOriginalFiles: OriginalFileWithMeta[] = [
            ...selectedFiles.map(f => ({ path: f.path, content: f.content, isNewFile: false })),
            ...newFilesWithContent,
          ];

          // Create a map of paths to isNewFile status
          const newFileMap = new Map(allOriginalFiles.map(f => [f.path, f.isNewFile]));

          console.log(
            '[useAI] All original files for parsing:',
            allOriginalFiles.map(f => ({ path: f.path, contentLength: f.content.length, isNewFile: f.isNewFile }))
          );

          const parseResult = parseEditResponse(response, allOriginalFiles);

          console.log(
            '[useAI] Parse result:',
            parseResult.changedFiles.map(f => ({
              path: f.path,
              originalLength: f.originalContent.length,
              suggestedLength: f.suggestedContent.length,
            }))
          );

          // AIEditResponse形式に変換 (add isNewFile flag for each file)
          const editResponse: AIEditResponse = {
            changedFiles: parseResult.changedFiles.map(f => ({
              ...f,
              isNewFile: newFileMap.get(f.path) || false,
            })),
            message: parseResult.message,
          };

          // 詳細メッセージを生成
          let detailedMessage = editResponse.message;
          if (editResponse.changedFiles.length > 0) {
            const usedPatch = parseResult.usedPatchFormat;
            const formatNote = usedPatch ? ' (using patch format)' : '';
            detailedMessage = `Edit complete!${formatNote}\n\n**Changed files:** ${editResponse.changedFiles.length}\n\n`;
            editResponse.changedFiles.forEach((file, index) => {
              const newLabel = file.isNewFile ? ' (new)' : '';
              detailedMessage += `${index + 1}. **${file.path}**${newLabel}\n`;
              if (file.explanation) {
                detailedMessage += `   - ${file.explanation}\n`;
              }
              detailedMessage += '\n';
            });
            detailedMessage += editResponse.message;
          }

          // Append assistant edit message and capture returned message (so we know its id)
          const assistantMsg = await addMessage(detailedMessage, 'assistant', 'edit', [], editResponse);

          // Persist AI review metadata / snapshots using storage adapter when projectId provided
          try {
            if (props?.projectId && aiStorage && typeof aiStorage.saveAIReviewEntry === 'function') {
              for (const f of editResponse.changedFiles) {
                aiStorage
                  .saveAIReviewEntry(props.projectId, f.path, f.originalContent, f.suggestedContent, {
                    message: parseResult.message,
                    parentMessageId: assistantMsg?.id,
                  })
                  .catch(err => console.warn('[useAI] saveAIReviewEntry failed', err));
              }
            }
          } catch (e) {
            console.warn('[useAI] AI review storage skipped:', e);
          }

          return editResponse;
        }
      } catch (error) {
        const errorMessage = `Error: ${(error as Error).message}`;
        await addMessage(errorMessage, 'assistant', mode);
        throw error;
      } finally {
        setIsProcessing(false);
      }
    },
    [fileContexts, addMessage, props?.messages]
  );

  // ファイルコンテキストを更新
  const updateFileContexts = useCallback(
    (contexts: AIFileContext[]) => {
      setFileContexts(contexts);

      if (props?.onUpdateSelectedFiles) {
        const selectedPaths = contexts.filter(ctx => ctx.selected).map(ctx => ctx.path);
        props.onUpdateSelectedFiles(selectedPaths);
      }
    },
    [props?.onUpdateSelectedFiles]
  );

  // ファイルの選択状態を切り替え
  const toggleFileSelection = useCallback(
    (path: string) => {
      setFileContexts(prev => {
        const updated = prev.map(ctx =>
          ctx.path === path ? { ...ctx, selected: !ctx.selected } : ctx
        );

        if (props?.onUpdateSelectedFiles) {
          const selectedPaths = updated.filter(ctx => ctx.selected).map(ctx => ctx.path);
          props.onUpdateSelectedFiles(selectedPaths);
        }

        return updated;
      });
    },
    [props?.onUpdateSelectedFiles]
  );

  /**
   * Generate the AI prompt text for debugging purposes without actually sending to the API.
   * Useful for inspecting what prompt would be sent to the AI model.
   * @param content - The user's input message
   * @param mode - The current mode ('ask' for questions, 'edit' for code editing)
   * @returns The full prompt text that would be sent to the AI
   */
  const generatePromptText = useCallback(
    (content: string, mode: 'ask' | 'edit'): string => {
      const selectedFiles = getSelectedFileContexts(fileContexts);
      const customInstructions = getCustomInstructions(fileContexts);

      const previousMessages = props?.messages
        ?.filter(msg => typeof msg.content === 'string' && msg.content.trim().length > 0)
        ?.map(msg => ({
          type: msg.type,
          content: msg.content,
          mode: msg.mode,
          editResponse: msg.editResponse,
        }));

      if (mode === 'ask') {
        return ASK_PROMPT_TEMPLATE(selectedFiles, content, previousMessages, customInstructions);
      } else {
        return EDIT_PROMPT_TEMPLATE(selectedFiles, content, previousMessages, customInstructions);
      }
    },
    [fileContexts, props?.messages]
  );

  return {
    messages: props?.messages || [],
    isProcessing,
    fileContexts,
    sendMessage,
    updateFileContexts,
    toggleFileSelection,
    generatePromptText,
  };
}
