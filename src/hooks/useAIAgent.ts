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

  console.log('[DEBUG] Raw AI response:', response);

  // 変更が不要の場合の処理
  if (response.includes('変更は必要ありません') || response.includes('変更が不要') || response.includes('No changes needed')) {
    return {
      changedFiles: [],
      message: '変更は必要ありませんでした。'
    };
  }

  // より柔軟な正規表現パターンを使用
  const fileBlockPattern = /##\s*変更ファイル:\s*(.+?)\n\n[\s\S]*?\*\*変更理由\*\*:\s*(.+?)\n\n```[\w]*\n([\s\S]*?)\n```/g;
  
  let match;
  while ((match = fileBlockPattern.exec(response)) !== null) {
    const filePath = match[1].trim();
    const explanation = match[2].trim();
    const suggestedContent = match[3];
    
    console.log('[DEBUG] Parsed file block:', { filePath, explanation, contentLength: suggestedContent.length });
    
    const originalFile = originalFiles.find(f => f.path === filePath || f.path.endsWith(filePath));
    if (originalFile) {
      changedFiles.push({
        path: originalFile.path, // 元のパスを使用
        originalContent: originalFile.content,
        suggestedContent,
        explanation
      });
    } else {
      console.warn('[DEBUG] Original file not found for path:', filePath);
    }
  }

  // 別パターンも試す（より緩い条件）
  if (changedFiles.length === 0) {
    const alternativePattern = /##\s*(.+?)\n[\s\S]*?```[\w]*\n([\s\S]*?)\n```/g;
    let altMatch;
    while ((altMatch = alternativePattern.exec(response)) !== null) {
      const pathCandidate = altMatch[1].replace('変更ファイル:', '').trim();
      const suggestedContent = altMatch[2];
      
      const originalFile = originalFiles.find(f => 
        f.path === pathCandidate || 
        f.path.endsWith(pathCandidate) ||
        pathCandidate.includes(f.path.split('/').pop() || '')
      );
      
      if (originalFile) {
        changedFiles.push({
          path: originalFile.path,
          originalContent: originalFile.content,
          suggestedContent,
          explanation: 'AIによる編集提案'
        });
      }
    }
  }

  // 単一のコードブロックのみの場合（最後の手段）
  if (changedFiles.length === 0 && originalFiles.length === 1) {
    const codeBlockPattern = /```[\w]*\n([\s\S]*?)\n```/;
    const codeMatch = response.match(codeBlockPattern);
    if (codeMatch) {
      changedFiles.push({
        path: originalFiles[0].path,
        originalContent: originalFiles[0].content,
        suggestedContent: codeMatch[1],
        explanation: 'AIによる編集提案'
      });
    }
  }

  // メッセージを抽出
  message = response.replace(/##\s*変更ファイル:[\s\S]*?---/g, '').trim();
  if (!message || message.length < 10) {
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
