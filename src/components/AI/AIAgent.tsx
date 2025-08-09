'use client';

import React, { useState, useEffect } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { useAIAgent } from '@/hooks/useAIAgent';
import { useAIReview } from '@/hooks/useAIReview';
import { buildAIFileContextList } from '@/utils/ai/contextBuilder';
import ChatMessage from './ChatMessage';
import FileSelector from './FileSelector';
import ContextFileList from './ContextFileList';
import EditRequestForm from './EditRequestForm';
import ChangedFilesList from './ChangedFilesList';
import type { FileItem, ProjectFile, Tab, Project, AIEditResponse } from '@/types';

interface AIAgentProps {
  projectFiles: FileItem[];
  currentProject: Project | null;
  tabs: Tab[];
  setTabs: (update: any) => void;
  setActiveTabId: (id: string) => void;
  saveFile: (projectId: string, filePath: string, content: string) => Promise<void>;
  clearAIReview: (filePath: string) => Promise<void>;
}

export default function AIAgent({
  projectFiles,
  currentProject,
  tabs,
  setTabs,
  setActiveTabId,
  saveFile,
  clearAIReview
}: AIAgentProps) {
  const { colors } = useTheme();
  const [isFileSelectorOpen, setIsFileSelectorOpen] = useState(false);
  const [currentMode, setCurrentMode] = useState<'chat' | 'edit'>('chat');
  const [lastEditResponse, setLastEditResponse] = useState<AIEditResponse | null>(null);

  const {
    messages,
    isProcessing,
    fileContexts,
    sendChatMessage,
    executeCodeEdit,
    updateFileContexts,
    toggleFileSelection,
    clearMessages
  } = useAIAgent();

  const {
    openAIReviewTab,
    applyChanges,
    discardChanges
  } = useAIReview();

  // プロジェクトファイルが変更されたときにコンテキストを更新
  useEffect(() => {
    if (projectFiles.length > 0) {
      const contexts = buildAIFileContextList(projectFiles);
      updateFileContexts(contexts);
    }
  }, [projectFiles, updateFileContexts]);

  // API キーのチェック
  const isApiKeySet = () => {
    return !!localStorage.getItem('gemini-api-key');
  };

  // チャットメッセージ送信
  const handleSendMessage = async (message: string) => {
    if (!isApiKeySet()) {
      alert('Gemini APIキーが設定されていません。設定画面で設定してください。');
      return;
    }

    try {
      await sendChatMessage(message);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  // コード編集実行
  const handleExecuteEdit = async (instruction: string) => {
    if (!isApiKeySet()) {
      alert('Gemini APIキーが設定されていません。設定画面で設定してください。');
      return;
    }

    if (!currentProject) {
      alert('プロジェクトが選択されていません。');
      return;
    }

    try {
      const response = await executeCodeEdit(instruction);
      setLastEditResponse(response);
      setCurrentMode('edit');
    } catch (error) {
      console.error('Failed to execute edit:', error);
      alert(`編集に失敗しました: ${(error as Error).message}`);
    }
  };

  // ファイル選択
  const handleFileSelect = (file: FileItem) => {
    toggleFileSelection(file.path);
    setIsFileSelectorOpen(false);
  };

  // レビューを開く
  const handleOpenReview = (filePath: string, originalContent: string, suggestedContent: string) => {
    openAIReviewTab(filePath, originalContent, suggestedContent, setTabs, setActiveTabId, tabs);
  };

  // 変更を適用
  const handleApplyChanges = async (filePath: string, newContent: string) => {
    if (!currentProject) return;

    try {
      await applyChanges(filePath, newContent, currentProject, saveFile, clearAIReview);
      
      // 成功したら変更リストから削除
      if (lastEditResponse) {
        const updatedResponse = {
          ...lastEditResponse,
          changedFiles: lastEditResponse.changedFiles.filter(f => f.path !== filePath)
        };
        setLastEditResponse(updatedResponse);
      }
    } catch (error) {
      alert(`変更の適用に失敗しました: ${(error as Error).message}`);
    }
  };

  // 変更を破棄
  const handleDiscardChanges = async (filePath: string) => {
    try {
      await discardChanges(filePath, clearAIReview);
      
      // 変更リストから削除
      if (lastEditResponse) {
        const updatedResponse = {
          ...lastEditResponse,
          changedFiles: lastEditResponse.changedFiles.filter(f => f.path !== filePath)
        };
        setLastEditResponse(updatedResponse);
      }
    } catch (error) {
      alert(`変更の破棄に失敗しました: ${(error as Error).message}`);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <div 
        className="flex items-center justify-between p-3 border-b"
        style={{ borderColor: colors.border }}
      >
        <h2 className="text-lg font-semibold" style={{ color: colors.foreground }}>
          AI Agent
        </h2>
        <div className="flex gap-2">
          <button
            className={`px-3 py-1 text-xs rounded ${currentMode === 'chat' ? 'font-semibold' : ''}`}
            style={{ 
              background: currentMode === 'chat' ? colors.accent : colors.mutedBg,
              color: currentMode === 'chat' ? colors.background : colors.mutedFg
            }}
            onClick={() => setCurrentMode('chat')}
          >
            チャット
          </button>
          <button
            className={`px-3 py-1 text-xs rounded ${currentMode === 'edit' ? 'font-semibold' : ''}`}
            style={{ 
              background: currentMode === 'edit' ? colors.accent : colors.mutedBg,
              color: currentMode === 'edit' ? colors.background : colors.mutedFg
            }}
            onClick={() => setCurrentMode('edit')}
          >
            編集
          </button>
        </div>
      </div>

      {/* ファイルコンテキスト */}
      <div 
        className="p-3 border-b"
        style={{ borderColor: colors.border }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium" style={{ color: colors.foreground }}>
            ファイルコンテキスト
          </span>
          <button
            className="text-xs px-2 py-1 rounded"
            style={{ background: colors.accent, color: colors.background }}
            onClick={() => setIsFileSelectorOpen(true)}
          >
            ファイル選択
          </button>
        </div>
        <ContextFileList
          contexts={fileContexts}
          onToggleSelection={toggleFileSelection}
        />
      </div>

      {/* メインコンテンツ */}
      <div className="flex-1 flex flex-col min-h-0">
        {currentMode === 'chat' ? (
          <>
            {/* チャットメッセージ */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {messages.length === 0 ? (
                <div 
                  className="text-center text-sm"
                  style={{ color: colors.mutedFg }}
                >
                  AIとチャットを開始しましょう
                </div>
              ) : (
                messages.map(message => (
                  <ChatMessage key={message.id} message={message} />
                ))
              )}
            </div>

            {/* チャット入力 */}
            <EditRequestForm
              mode="chat"
              onSubmit={handleSendMessage}
              isProcessing={isProcessing}
              placeholder="AIに質問やコード相談をしてください..."
            />
          </>
        ) : (
          <>
            {/* 編集結果 */}
            <div className="flex-1 overflow-y-auto p-3">
              {lastEditResponse ? (
                <ChangedFilesList
                  changedFiles={lastEditResponse.changedFiles}
                  onOpenReview={handleOpenReview}
                  onApplyChanges={handleApplyChanges}
                  onDiscardChanges={handleDiscardChanges}
                />
              ) : (
                <div 
                  className="text-center text-sm"
                  style={{ color: colors.mutedFg }}
                >
                  ファイルを選択して編集指示を入力してください
                </div>
              )}
            </div>

            {/* 編集入力 */}
            <EditRequestForm
              mode="edit"
              onSubmit={handleExecuteEdit}
              isProcessing={isProcessing}
              placeholder="コードの編集指示を入力してください..."
            />
          </>
        )}
      </div>

      {/* ファイル選択モーダル */}
      {isFileSelectorOpen && (
        <FileSelector
          isOpen={isFileSelectorOpen}
          onClose={() => setIsFileSelectorOpen(false)}
          files={projectFiles}
          onFileSelect={handleFileSelect}
        />
      )}
    </div>
  );
}
