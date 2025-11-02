// 統合AIフック

'use client';

import { useState, useCallback, useEffect } from 'react';
import { pushMsgOutPanel } from '@/components/Bottom/BottomPanel';

import { LOCALSTORAGE_KEY } from '@/context/config';
import { getSelectedFileContexts } from '@/engine/ai/contextBuilder';
import { generateCodeEdit, generateChatResponse } from '@/engine/ai/fetchAI';
import { EDIT_PROMPT_TEMPLATE, ASK_PROMPT_TEMPLATE } from '@/engine/ai/prompts';
import {
  parseEditResponse,
  extractFilePathsFromResponse,
  validateResponse,
} from '@/engine/ai/responseParser';
import type { AIFileContext, AIEditResponse, ChatSpaceMessage } from '@/types';

interface UseAIProps {
  onAddMessage?: (
    content: string,
    type: 'user' | 'assistant',
    mode: 'ask' | 'edit',
    fileContext?: string[],
    editResponse?: AIEditResponse
  ) => Promise<void>;
  selectedFiles?: string[];
  onUpdateSelectedFiles?: (files: string[]) => void;
  messages?: ChatSpaceMessage[];
}

export function useAI(props?: UseAIProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileContexts, setFileContexts] = useState<AIFileContext[]>([]);

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
    ) => {
      if (props?.onAddMessage) {
        await props.onAddMessage(content, type, mode, fileContext, editResponse);
      }
      // Always push assistant responses to the BottomPanel so user sees AI replies
      try {
        if (type === 'assistant') {
          // map mode to a small context label
          const ctx = mode === 'edit' ? 'AI (edit)' : 'AI';
          // Ensure content is a string
          const msg = typeof content === 'string' ? content : JSON.stringify(content);
          pushMsgOutPanel(msg, 'info', ctx);
        }
      } catch (e) {
        // non-fatal: ensure UI doesn't break if push fails
        // eslint-disable-next-line no-console
        console.warn('[useAI] pushMsgOutPanel failed', e);
      }
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

      // 過去メッセージから type, content, mode のみ抽出
      const previousMessages = props?.messages
        ?.filter(msg => typeof msg.content === 'string' && msg.content.trim().length > 0)
        ?.map(msg => ({
          type: msg.type,
          content: msg.content,
          mode: msg.mode,
        }));

      setIsProcessing(true);
      try {
        if (mode === 'ask') {
          // Ask モード
          const prompt = ASK_PROMPT_TEMPLATE(selectedFiles, content, previousMessages);
          const response = await generateChatResponse(prompt, [], apiKey);

          await addMessage(response, 'assistant', 'ask');
          return null;
        } else {
          // Edit モード
          const prompt = EDIT_PROMPT_TEMPLATE(selectedFiles, content, previousMessages);
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
          const allOriginalFiles = [
            ...selectedFiles,
            ...extractFilePathsFromResponse(response).map((path: string) => ({
              path,
              content: '',
            })),
          ];
          const parseResult = parseEditResponse(response, allOriginalFiles);

          // AIEditResponse形式に変換
          const editResponse: AIEditResponse = {
            changedFiles: parseResult.changedFiles,
            message: parseResult.message,
          };

          // 詳細メッセージを生成
          let detailedMessage = editResponse.message;
          if (editResponse.changedFiles.length > 0) {
            detailedMessage = `編集が完了しました！\n\n**変更されたファイル:** ${editResponse.changedFiles.length}個\n\n`;
            editResponse.changedFiles.forEach((file, index) => {
              detailedMessage += `${index + 1}. **${file.path}**\n`;
              if (file.explanation) {
                detailedMessage += `   - ${file.explanation}\n`;
              }
              detailedMessage += '\n';
            });
            detailedMessage += editResponse.message;
          }

          await addMessage(detailedMessage, 'assistant', 'edit', [], editResponse);
          return editResponse;
        }
      } catch (error) {
        const errorMessage = `エラーが発生しました: ${(error as Error).message}`;
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

  return {
    messages: props?.messages || [],
    isProcessing,
    fileContexts,
    sendMessage,
    updateFileContexts,
    toggleFileSelection,
  };
}


