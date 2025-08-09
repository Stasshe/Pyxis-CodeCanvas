// AI Agent メインロジック

import { useState, useCallback } from 'react';
import type { AIMessage, AIEditRequest, AIEditResponse, AIFileContext, ProjectFile } from '@/types';
import { generateCodeEdit, generateChatResponse } from '@/utils/ai/geminiClient';
import { EDIT_PROMPT_TEMPLATE } from '@/utils/ai/prompts';
import { getSelectedFileContexts } from '@/utils/ai/contextBuilder';

export function useAIAgent() {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileContexts, setFileContexts] = useState<AIFileContext[]>([]);

  // メッセージを追加
  const addMessage = useCallback((message: Omit<AIMessage, 'id' | 'timestamp'>) => {
    const newMessage: AIMessage = {
      ...message,
      id: Date.now().toString(),
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, newMessage]);
    return newMessage;
  }, []);

  // チャットメッセージを送信
  const sendChatMessage = useCallback(async (content: string): Promise<void> => {
    const apiKey = localStorage.getItem('gemini-api-key');
    if (!apiKey) {
      throw new Error('Gemini APIキーが設定されていません。設定画面で設定してください。');
    }

    // ユーザーメッセージを追加
    const selectedFiles = getSelectedFileContexts(fileContexts);
    addMessage({
      type: 'user',
      content,
      fileContext: selectedFiles.map(f => f.path)
    });

    setIsProcessing(true);
    try {
      // コンテキストを構築
      const context = selectedFiles.map(f => `ファイル: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``);
      
      // AI応答を生成
      const response = await generateChatResponse(content, context, apiKey);
      
      // AI応答を追加
      addMessage({
        type: 'assistant',
        content: response
      });
    } catch (error) {
      addMessage({
        type: 'assistant',
        content: `エラーが発生しました: ${(error as Error).message}`
      });
    } finally {
      setIsProcessing(false);
    }
  }, [fileContexts, addMessage]);

  // コード編集を実行
  const executeCodeEdit = useCallback(async (instruction: string): Promise<AIEditResponse> => {
    const apiKey = localStorage.getItem('gemini-api-key');
    if (!apiKey) {
      throw new Error('Gemini APIキーが設定されていません。設定画面で設定してください。');
    }

    const selectedFiles = getSelectedFileContexts(fileContexts);
    if (selectedFiles.length === 0) {
      throw new Error('編集するファイルを選択してください。');
    }

    setIsProcessing(true);
    try {
      // プロンプトを生成
      const prompt = EDIT_PROMPT_TEMPLATE(selectedFiles, instruction);
      
      // AI編集を実行
      const response = await generateCodeEdit(prompt, apiKey);
      
      // レスポンスをパース
      const editResponse = parseEditResponse(response, selectedFiles);
      
      // ユーザーメッセージを追加
      addMessage({
        type: 'user',
        content: `編集指示: ${instruction}`,
        fileContext: selectedFiles.map(f => f.path)
      });

      // AI応答を追加
      addMessage({
        type: 'assistant',
        content: `${editResponse.changedFiles.length}個のファイルを編集しました。\n\n${editResponse.message}`
      });

      return editResponse;
    } finally {
      setIsProcessing(false);
    }
  }, [fileContexts, addMessage]);

  // ファイルコンテキストを更新
  const updateFileContexts = useCallback((contexts: AIFileContext[]) => {
    setFileContexts(contexts);
  }, []);

  // ファイルの選択状態を切り替え
  const toggleFileSelection = useCallback((path: string) => {
    setFileContexts(prev => 
      prev.map(ctx => 
        ctx.path === path ? { ...ctx, selected: !ctx.selected } : ctx
      )
    );
  }, []);

  // メッセージをクリア
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    isProcessing,
    fileContexts,
    sendChatMessage,
    executeCodeEdit,
    updateFileContexts,
    toggleFileSelection,
    clearMessages,
    addMessage
  };
}

// AI編集レスポンスをパースする関数
function parseEditResponse(response: string, originalFiles: Array<{path: string, content: string}>): AIEditResponse {
  const changedFiles: AIEditResponse['changedFiles'] = [];
  let message = '';

  // レスポンスを解析してファイルごとの変更を抽出
  const fileMatches = response.match(/## 変更ファイル: (.+?)\n\n\*\*変更理由\*\*: (.+?)\n\n```[\s\S]*?\n([\s\S]*?)\n```/g);
  
  if (fileMatches) {
    for (const match of fileMatches) {
      const filePathMatch = match.match(/## 変更ファイル: (.+?)\n/);
      const reasonMatch = match.match(/\*\*変更理由\*\*: (.+?)\n/);
      const codeMatch = match.match(/```[\s\S]*?\n([\s\S]*?)\n```/);
      
      if (filePathMatch && reasonMatch && codeMatch) {
        const filePath = filePathMatch[1].trim();
        const explanation = reasonMatch[1].trim();
        const suggestedContent = codeMatch[1];
        
        const originalFile = originalFiles.find(f => f.path === filePath);
        if (originalFile) {
          changedFiles.push({
            path: filePath,
            originalContent: originalFile.content,
            suggestedContent,
            explanation
          });
        }
      }
    }
  }

  // メッセージを抽出（ファイル変更情報以外の部分）
  message = response.replace(/## 変更ファイル:[\s\S]*?---/g, '').trim();
  if (!message) {
    message = changedFiles.length > 0 
      ? `${changedFiles.length}個のファイルの編集を提案しました。` 
      : 'ファイルの変更は必要ありませんでした。';
  }

  return {
    changedFiles,
    message
  };
}
