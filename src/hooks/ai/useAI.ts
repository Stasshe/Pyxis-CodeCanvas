// 統合AIフック

'use client';

import { useState, useCallback, useEffect } from 'react';

import { LOCALSTORAGE_KEY } from '@/context/config';
import { getSelectedFileContexts } from '@/engine/ai/contextBuilder';
import { generateCodeEdit, generateChatResponse } from '@/engine/ai/fetchAI';
import { EDIT_PROMPT_TEMPLATE, ASK_PROMPT_TEMPLATE } from '@/engine/ai/prompts';
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

          // レスポンスをパース
          const allOriginalFiles = [
            ...selectedFiles,
            ...extractNewFilePathsFromResponse(response).map(path => ({ path, content: '' })),
          ];
          const editResponse = parseEditResponse(response, allOriginalFiles);

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

// 新規ファイルパスを抽出
function extractNewFilePathsFromResponse(response: string): string[] {
  const fileBlockPattern = /<AI_EDIT_CONTENT_START:(.+?)>/g;
  const reasonPattern =
    /##\s*変更ファイル:\s*(.+?)\n+\*\*変更理由\*\*:\s*新規ファイルの作成(?=\n\s*<AI_EDIT_CONTENT_START:)/g;
  const foundPaths: string[] = [];

  const reasonMatches = [...response.matchAll(reasonPattern)].map(r => r[1].trim());

  let match;
  while ((match = fileBlockPattern.exec(response)) !== null) {
    const filePath = match[1].trim();
    if (reasonMatches.includes(filePath)) {
      foundPaths.push(filePath);
    }
  }
  return foundPaths;
}

// AI編集レスポンスをパース
function parseEditResponse(
  response: string,
  originalFiles: Array<{ path: string; content: string }>
): AIEditResponse {
  const changedFiles: AIEditResponse['changedFiles'] = [];
  let message = '';

  const normalizePath = (path: string) => path.replace(/^\/|\/$/g, '').toLowerCase();

  const fileBlockPattern =
    /<AI_EDIT_CONTENT_START:(.+?)>\s*\n([\s\S]*?)\n\s*<AI_EDIT_CONTENT_END:\1>/g;
  const reasonPattern =
    /##\s*変更ファイル:\s*(.+?)\n+\*\*変更理由\*\*:\s*(.+?)(?=\n\s*<AI_EDIT_CONTENT_START:)/g;

  const reasonMatches = [...response.matchAll(reasonPattern)];

  let match;
  while ((match = fileBlockPattern.exec(response)) !== null) {
    const filePathFromTag = match[1].trim();
    const suggestedContent = match[2];

    const reasonMatch = reasonMatches.find(r => r[1].trim() === filePathFromTag);
    const explanation = reasonMatch ? reasonMatch[2].trim() : 'No explanation provided';

    const normalizedFilePath = normalizePath(filePathFromTag);
    const originalFile = originalFiles.find(f => normalizePath(f.path) === normalizedFilePath);

    if (originalFile) {
      changedFiles.push({
        path: originalFile.path,
        originalContent: originalFile.content,
        suggestedContent,
        explanation,
      });
    }
  }

  let cleaned = response.replace(
    /<AI_EDIT_CONTENT_START:[^>]+>[\s\S]*?<AI_EDIT_CONTENT_END:[^>]+>/g,
    ''
  );
  cleaned = cleaned
    .replace(/^##\s*変更ファイル:.*$/gm, '')
    .replace(/^\*\*変更理由\*\*:.+$/gm, '')
    .replace(/^---$/gm, '');
  message = cleaned.trim();

  // messageが空、または10文字未満でも、changedFilesが1件以上あれば必ず編集提案メッセージを返す
  if (changedFiles.length > 0 && (!message || message.replace(/\s/g, '').length < 10)) {
    message = `${changedFiles.length}個のファイルの編集を提案しました。`;
  } else if (!message || message.replace(/\s/g, '').length < 10) {
    // 解析に失敗した場合はユーザがデバッグできるように raw のレスポンスを
    // メッセージの下にコードブロックとして追加する
    const failureNote = 'レスポンスの解析に失敗しました。プロンプトを調整してください。';

    // triple-backtick がレスポンス内にあるとコードブロックが壊れるため、
    // 0-width space を挿入して中断する（視認上は変わらない）
    const safeResponse = response.replace(/```/g, '```' + '\u200B');

    const rawBlock = `\n\n---\n\nRaw response:\n\n\`\`\`text\n${safeResponse}\n\`\`\``;

    message = failureNote + rawBlock;
  }

  return {
    changedFiles,
    message,
  };
}
