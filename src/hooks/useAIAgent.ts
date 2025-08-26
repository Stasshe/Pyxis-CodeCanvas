// AI Agent メインロジック

import { useState, useCallback, useEffect } from 'react';
import type { AIMessage, AIEditRequest, AIEditResponse, AIFileContext, ProjectFile, ChatSpaceMessage } from '@/types';
import { generateCodeEdit, generateChatResponse } from '@/utils/ai/fetchAI';
import { EDIT_PROMPT_TEMPLATE } from '@/utils/ai/prompts';
import { getSelectedFileContexts } from '@/utils/ai/contextBuilder';
import { LOCALSTORAGE_KEY } from '@/context/config';

interface UseAIAgentProps {
  onAddMessage?: (content: string, type: 'user' | 'assistant', mode: 'ask' | 'edit', fileContext?: string[], editResponse?: AIEditResponse) => Promise<void>;
  selectedFiles?: string[];
  onUpdateSelectedFiles?: (files: string[]) => void;
  messages?: ChatSpaceMessage[];
}

export function useAIAgent(props?: UseAIAgentProps) {
  const [localMessages, setLocalMessages] = useState<AIMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileContexts, setFileContexts] = useState<AIFileContext[]>([]);

  // メッセージは外部から渡されたものを優先、なければローカルを使用
  const messages = props?.messages?.map(msg => ({
    id: msg.id,
    type: msg.type,
    content: msg.content,
    timestamp: msg.timestamp,
    fileContext: msg.fileContext
  } as AIMessage)) || localMessages;

  // チャットスペースから選択ファイルが変更された時にファイルコンテキストに反映
  useEffect(() => {
    if (props?.selectedFiles && fileContexts.length > 0) {
      setFileContexts(prev => 
        prev.map(ctx => ({
          ...ctx,
          selected: props.selectedFiles?.includes(ctx.path) || false
        }))
      );
    }
  }, [props?.selectedFiles]); // fileContexts.lengthを依存配列から削除

  // メッセージを追加（チャットスペース対応）
  const addMessage = useCallback(async (message: Omit<AIMessage, 'id' | 'timestamp'>, mode: 'ask' | 'edit' = 'ask', editResponse?: AIEditResponse) => {
    if (props?.onAddMessage) {
      // チャットスペースに保存
      await props.onAddMessage(message.content, message.type, mode, message.fileContext, editResponse);
    } else {
      // ローカルメッセージに追加（フォールバック）
      const newMessage: AIMessage = {
        ...message,
        id: Date.now().toString(),
        timestamp: new Date(),
      };
      setLocalMessages(prev => [...prev, newMessage]);
    }
  }, [props?.onAddMessage]);

  // Askメッセージを送信
  const sendAskMessage = useCallback(async (content: string): Promise<void> => {
    const apiKey = localStorage.getItem(LOCALSTORAGE_KEY.GEMINI_API_KEY);
    if (!apiKey) {
      throw new Error('Gemini APIキーが設定されていません。設定画面で設定してください。');
    }

    // ユーザーメッセージを追加
    const selectedFiles = getSelectedFileContexts(fileContexts);
    await addMessage({
      type: 'user',
      content,
      fileContext: selectedFiles.map(f => f.path)
    }, 'ask');

    // 過去メッセージから type, content, mode のみ抽出し、空contentやファイル内容だけのメッセージは除外
    const previousMessages = props?.messages
      ?.filter(msg => typeof msg.content === 'string' && msg.content.trim().length > 0)
      ?.map(msg => ({
        type: msg.type,
        content: msg.content,
        mode: msg.mode
      }));

    setIsProcessing(true);
    try {
      // ASK_PROMPT_TEMPLATEを使ってプロンプトを生成
      // importを追加して使う
       
      const { ASK_PROMPT_TEMPLATE } = require('@/utils/ai/prompts');
      const prompt = ASK_PROMPT_TEMPLATE(selectedFiles, content, previousMessages);

      // AI応答を生成
      const response = await generateChatResponse(prompt, [], apiKey);

      // AI応答を追加
      await addMessage({
        type: 'assistant',
        content: response
      }, 'ask');
    } catch (error) {
      await addMessage({
        type: 'assistant',
        content: `エラーが発生しました: ${(error as Error).message}`
      }, 'ask');
    } finally {
      setIsProcessing(false);
    }
  }, [fileContexts, addMessage, props?.messages]);

  // コード編集を実行
  const executeCodeEdit = useCallback(async (instruction: string): Promise<AIEditResponse> => {
    const apiKey = localStorage.getItem(LOCALSTORAGE_KEY.GEMINI_API_KEY);
    if (!apiKey) {
      throw new Error('Gemini APIキーが設定されていません。設定画面で設定してください。');
    }

    // 選択ファイルがなくてもAIが新規ファイル作成できるようにする
    const selectedFiles = getSelectedFileContexts(fileContexts);

    setIsProcessing(true);
    try {
      // ユーザーの編集指示を保存
      await addMessage({
        type: 'user',
        content: instruction,
        fileContext: selectedFiles.map(f => f.path)
      }, 'edit');

      // 過去メッセージから type, content, mode のみ抽出し、空contentやファイル内容だけのメッセージは除外
      const previousMessages = props?.messages
        ?.filter(msg => typeof msg.content === 'string' && msg.content.trim().length > 0)
        ?.map(msg => ({
          type: msg.type,
          content: msg.content,
          mode: msg.mode
        }));

      // プロンプトを生成
      const prompt = EDIT_PROMPT_TEMPLATE(selectedFiles, instruction, previousMessages);
      
      // AI編集を実行
      const response = await generateCodeEdit(prompt, apiKey);
      
      // レスポンスをパース
      // 新規ファイル作成対応: selectedFilesにないファイルもパースする
      const allOriginalFiles = [
        ...selectedFiles,
        // 新規ファイル用: 空ファイルとしてパース対象に追加
        ...extractNewFilePathsFromResponse(response).map(path => ({ path, content: '' }))
      ];
      const editResponse = parseEditResponse(response, allOriginalFiles);

      // より詳細なメッセージを生成
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

      // AI応答メッセージを追加（editResponseも含める）
      await addMessage({
        type: 'assistant',
        content: detailedMessage
      }, 'edit', editResponse);

      return editResponse;
    } finally {
      setIsProcessing(false);
    }
  }, [fileContexts, addMessage]);

  // AIレスポンスから新規ファイルパスを抽出する関数
  function extractNewFilePathsFromResponse(response: string): string[] {
    // 新規ファイルのみ抽出: 「**変更理由**: 新規ファイルの作成」が明記されたファイルのみ
    const fileBlockPattern = /<AI_EDIT_CONTENT_START:(.+?)>/g;
    const reasonPattern = /##\s*変更ファイル:\s*(.+?)\n+\*\*変更理由\*\*:\s*新規ファイルの作成(?=\n\s*<AI_EDIT_CONTENT_START:)/g;
    const foundPaths: string[] = [];

    // 新規ファイル理由が明記されたファイルパスを抽出
    const reasonMatches = [...response.matchAll(reasonPattern)].map(r => r[1].trim());

    let match;
    while ((match = fileBlockPattern.exec(response)) !== null) {
      const filePath = match[1].trim();
      // 新規ファイル理由が明記されていて、fileContextsに含まれていないものだけ
      if (reasonMatches.includes(filePath) && !fileContexts.some(f => f.path === filePath)) {
        foundPaths.push(filePath);
      }
    }
    return foundPaths;
  }

  // ファイルコンテキストを更新
  const updateFileContexts = useCallback((contexts: AIFileContext[]) => {
    setFileContexts(contexts);
    
    // チャットスペース連携時は選択ファイルも更新
    if (props?.onUpdateSelectedFiles) {
      const selectedPaths = contexts.filter(ctx => ctx.selected).map(ctx => ctx.path);
      props.onUpdateSelectedFiles(selectedPaths);
    }
  }, [props?.onUpdateSelectedFiles]);

  // ファイルの選択状態を切り替え
  const toggleFileSelection = useCallback((path: string) => {
    setFileContexts(prev => {
      const updated = prev.map(ctx => 
        ctx.path === path ? { ...ctx, selected: !ctx.selected } : ctx
      );
      
      // チャットスペース連携時は選択ファイルも更新
      if (props?.onUpdateSelectedFiles) {
        const selectedPaths = updated.filter(ctx => ctx.selected).map(ctx => ctx.path);
        props.onUpdateSelectedFiles(selectedPaths);
      }
      
      return updated;
    });
  }, [props?.onUpdateSelectedFiles]);

  // メッセージをクリア（ローカルのみ）
  const clearMessages = useCallback(() => {
    setLocalMessages([]);
  }, []);

  // メッセージのeditResponseを更新する関数
  const updateMessageEditResponse = useCallback(async (messageId: string, updatedEditResponse: AIEditResponse) => {
    if (props?.onAddMessage && props?.messages) {
      // チャットスペースのメッセージを更新する必要がある場合の処理
      // この実装は、ChatSpaceの更新機能が必要
      console.log('Message edit response updated:', messageId, updatedEditResponse);
    }
  }, [props?.onAddMessage, props?.messages]);

  return {
    messages,
    isProcessing,
    fileContexts,
    sendAskMessage,
    executeCodeEdit,
    updateFileContexts,
    toggleFileSelection,
    clearMessages,
    addMessage,
    updateMessageEditResponse
  };
}

// AI編集レスポンスをパースする関数
function parseEditResponse(response: string, originalFiles: Array<{path: string, content: string}>): AIEditResponse {
  const changedFiles: AIEditResponse['changedFiles'] = [];
  let message = '';

  console.log('[AI Agent] Raw AI response:', response);
  console.log('[DEBUG] Available original files for matching:', originalFiles.map(f => f.path));

  // 正規化関数
  const normalizePath = (path: string) => path.replace(/^\/|\/$/g, '').toLowerCase();

  // ファイルパス付きタグシステムでより確実にパース
  const fileBlockPattern = /<AI_EDIT_CONTENT_START:(.+?)>\s*\n([\s\S]*?)\n\s*<AI_EDIT_CONTENT_END:\1>/g;
  const reasonPattern = /##\s*変更ファイル:\s*(.+?)\n+\*\*変更理由\*\*:\s*(.+?)(?=\n\s*<AI_EDIT_CONTENT_START:)/g;

  console.log('[DEBUG] Using file-path tagged patterns');

  // 変更理由とファイルパスの組み合わせを抽出
  const reasonMatches = [...response.matchAll(reasonPattern)];
  console.log('[DEBUG] Found reason matches:', reasonMatches.length);

  let match;
  while ((match = fileBlockPattern.exec(response)) !== null) {
    const filePathFromTag = match[1].trim();
    const suggestedContent = match[2];

    console.log('[DEBUG] Found content block for path:', filePathFromTag);

    // 対応する変更理由を探す
    const reasonMatch = reasonMatches.find(r => r[1].trim() === filePathFromTag);
    const explanation = reasonMatch ? reasonMatch[2].trim() : 'No explanation provided';

    console.log('[DEBUG] Parsed file block:', { filePath: filePathFromTag, explanation, contentLength: suggestedContent.length });

    // 正規化されたパスでマッチング
    const normalizedFilePath = normalizePath(filePathFromTag);
    const originalFile = originalFiles.find(f => normalizePath(f.path) === normalizedFilePath);

    if (originalFile) {
      console.log('[DEBUG] Found matching original file:', originalFile.path);
      changedFiles.push({
        path: originalFile.path,
        originalContent: originalFile.content,
        suggestedContent,
        explanation
      });
    } else {
      console.warn('[DEBUG] Original file not found for path:', filePathFromTag);
    }
  }


  // <AI_EDIT_CONTENT_START:...> から <AI_EDIT_CONTENT_END:...> までのブロックをすべて削除
  let cleaned = response.replace(/<AI_EDIT_CONTENT_START:[^>]+>[\s\S]*?<AI_EDIT_CONTENT_END:[^>]+>/g, '');
  // ファイル情報や変更理由、--- も除外
  cleaned = cleaned.replace(/^##\s*変更ファイル:.*$/gm, '')
                   .replace(/^\*\*変更理由\*\*:.*$/gm, '')
                   .replace(/^---$/gm, '');
  message = cleaned.trim();

  // メッセージが短すぎる場合はデフォルトメッセージを使用
  if (!message || message.replace(/\s/g, '').length < 10) {
    message = changedFiles.length > 0 
      ? `${changedFiles.length}個のファイルの編集を提案しました。` 
      : 'レスポンスの解析に失敗しました。プロンプトを調整してください。';
  }

  console.log('[DEBUG] Final parsed result:', { changedFilesCount: changedFiles.length, message });

  return {
    changedFiles,
    message
  };
}