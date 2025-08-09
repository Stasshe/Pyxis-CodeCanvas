'use client';

import React, { useState, useEffect } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { useAIAgent } from '@/hooks/useAIAgent';
import { useAIReview } from '@/hooks/useAIReview';
import { useChatSpace } from '@/hooks/useChatSpace';
import { buildAIFileContextList } from '@/utils/ai/contextBuilder';
import ChatMessage from './ChatMessage';
import FileSelector from './FileSelector';
import ContextFileList from './ContextFileList';
import EditRequestForm from './EditRequestForm';
import ChangedFilesList from './ChangedFilesList';
import ChatSpaceList from './ChatSpaceList';
import type { FileItem, ProjectFile, Tab, Project, AIEditResponse } from '@/types';

interface AIAgentProps {
  projectFiles: FileItem[];
  currentProject: Project | null;
  tabs: Tab[];
  setTabs: (update: any) => void;
  setActiveTabId: (id: string) => void;
  saveFile: (filePath: string, content: string) => Promise<void>;
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
  const [showSpaceList, setShowSpaceList] = useState(false);

  // チャットスペース管理
  const {
    chatSpaces,
    currentSpace,
    loading: spacesLoading,
    createNewSpace,
    selectSpace,
    deleteSpace,
    addMessage: addSpaceMessage,
    updateSelectedFiles: updateSpaceSelectedFiles,
    updateSpaceName
  } = useChatSpace(currentProject?.id || null);

  const {
    messages,
    isProcessing,
    fileContexts,
    sendChatMessage,
    executeCodeEdit,
    updateFileContexts,
    toggleFileSelection,
    clearMessages
  } = useAIAgent({
    onAddMessage: async (content, type, mode, fileContext, editResponse) => {
      await addSpaceMessage(content, type, mode, fileContext, editResponse);
    },
    selectedFiles: currentSpace?.selectedFiles,
    onUpdateSelectedFiles: updateSpaceSelectedFiles,
    messages: currentSpace?.messages
  });

  const {
    openAIReviewTab,
    applyChanges,
    discardChanges,
    closeAIReviewTab
  } = useAIReview();

  // プロジェクトファイルが変更されたときにコンテキストを更新
  useEffect(() => {
    if (projectFiles.length > 0) {
      const contexts = buildAIFileContextList(projectFiles);
      updateFileContexts(contexts);
    }
  }, [projectFiles.length]); // updateFileContextsを依存配列から削除

  // プロジェクトが変更されたときに初期スペースを作成
  useEffect(() => {
    const initializeSpace = async () => {
      if (currentProject && chatSpaces.length === 0 && !spacesLoading && !currentSpace) {
        await createNewSpace(`${currentProject.name} - 初期チャット`);
      }
    };

    // プロジェクトIDが変わった時のみ実行
    if (currentProject) {
      initializeSpace();
    }
  }, [currentProject?.id]); // createNewSpaceを依存配列から削除

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

  // 最新の編集レスポンスを取得（チャットスペースから）
  useEffect(() => {
    if (currentSpace && currentSpace.messages.length > 0) {
      const latestEditMessage = [...currentSpace.messages]
        .reverse()
        .find(msg => msg.mode === 'edit' && msg.type === 'assistant' && msg.editResponse);
      
      if (latestEditMessage?.editResponse) {
        setLastEditResponse(latestEditMessage.editResponse);
      }
    }
  }, [currentSpace?.id, currentSpace?.messages?.length]); // メッセージの配列全体ではなく長さのみ監視

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
      // 直接saveFileを呼び出し、page.tsxのAIReviewTabと同じ方法を使用
      await saveFile(filePath, newContent);
      await clearAIReview(filePath);
      
      // レビュータブを閉じる
      closeAIReviewTab(filePath, setTabs, tabs);
      
      // 成功したら変更リストから削除
      if (lastEditResponse) {
        const updatedResponse = {
          ...lastEditResponse,
          changedFiles: lastEditResponse.changedFiles.filter(f => f.path !== filePath)
        };
        setLastEditResponse(updatedResponse);
      }
    } catch (error) {
      console.error('Failed to apply changes:', error);
      alert(`変更の適用に失敗しました: ${(error as Error).message}`);
    }
  };

  // 変更を破棄
  const handleDiscardChanges = async (filePath: string) => {
    try {
      // 直接clearAIReviewを呼び出し、page.tsxのAIReviewTabと同じ方法を使用
      await clearAIReview(filePath);
      
      // レビュータブを閉じる
      closeAIReviewTab(filePath, setTabs, tabs);
      
      // 変更リストから削除
      if (lastEditResponse) {
        const updatedResponse = {
          ...lastEditResponse,
          changedFiles: lastEditResponse.changedFiles.filter(f => f.path !== filePath)
        };
        setLastEditResponse(updatedResponse);
      }
    } catch (error) {
      console.error('Failed to discard changes:', error);
      alert(`変更の破棄に失敗しました: ${(error as Error).message}`);
    }
  };

  return (
    <div
      className="flex flex-col h-full w-full"
      style={{
        background: colors.background,
        borderRadius: 10,
        boxShadow: '0 2px 16px 0 rgba(0,0,0,0.10)',
        border: `1px solid ${colors.border}`,
        overflow: 'hidden',
      }}
    >
      {/* ヘッダー */}
      <div
        className="flex items-center justify-between px-5 py-3 border-b"
        style={{
          borderColor: colors.border,
          background: colors.cardBg,
          boxShadow: '0 1px 0 0 ' + colors.border,
        }}
      >
        <div className="flex items-center gap-3">
          <h2
            className="text-lg font-bold tracking-tight"
            style={{ color: colors.foreground, letterSpacing: '-0.5px' }}
          >
            AI Agent
          </h2>
          {currentSpace && (
            <span
              className="text-sm px-2 py-1 rounded border"
              style={{ 
                color: colors.mutedFg, 
                borderColor: colors.border,
                background: colors.background 
              }}
            >
              {currentSpace.name}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            className="text-xs px-3 py-1 rounded border font-medium hover:opacity-90 transition"
            style={{
              background: showSpaceList ? colors.accent : colors.background,
              color: showSpaceList ? colors.accentFg : colors.mutedFg,
              borderColor: showSpaceList ? colors.primary : colors.border,
            }}
            onClick={() => setShowSpaceList(!showSpaceList)}
          >
            スペース
          </button>
          <button
            className={`px-4 py-1 text-xs rounded-md transition font-semibold border focus:outline-none ${currentMode === 'chat' ? '' : ''}`}
            style={{
              background: currentMode === 'chat' ? colors.accent : colors.background,
              color: currentMode === 'chat' ? colors.accentFg : colors.mutedFg,
              borderColor: currentMode === 'chat' ? colors.primary : colors.border,
              boxShadow: currentMode === 'chat' ? `0 2px 8px 0 ${colors.accent}33` : 'none',
            }}
            onClick={() => setCurrentMode('chat')}
          >
            チャット
          </button>
          <button
            className={`px-4 py-1 text-xs rounded-md transition font-semibold border focus:outline-none ${currentMode === 'edit' ? '' : ''}`}
            style={{
              background: currentMode === 'edit' ? colors.accent : colors.background,
              color: currentMode === 'edit' ? colors.accentFg : colors.mutedFg,
              borderColor: currentMode === 'edit' ? colors.primary : colors.border,
              boxShadow: currentMode === 'edit' ? `0 2px 8px 0 ${colors.accent}33` : 'none',
            }}
            onClick={() => setCurrentMode('edit')}
          >
            編集
          </button>
        </div>
      </div>

      {/* チャットスペースリスト */}
      {showSpaceList && (
        <div className="px-5 py-3 border-b" style={{ borderColor: colors.border }}>
          <ChatSpaceList
            chatSpaces={chatSpaces}
            currentSpace={currentSpace}
            onSelectSpace={(space) => {
              selectSpace(space);
              setShowSpaceList(false);
            }}
            onCreateSpace={async (name) => {
              await createNewSpace(name);
              setShowSpaceList(false);
            }}
            onDeleteSpace={deleteSpace}
            onUpdateSpaceName={updateSpaceName}
          />
        </div>
      )}

      {/* ファイルコンテキスト */}
      <div
        className="px-5 py-3 border-b"
        style={{
          borderColor: colors.border,
          background: colors.background,
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold tracking-wide" style={{ color: colors.sidebarTitleFg }}>
            ファイルコンテキスト
          </span>
          <button
            className="text-xs px-3 py-1 rounded-md border font-medium hover:opacity-90 transition"
            style={{
              background: colors.accent,
              color: colors.accentFg,
              borderColor: colors.primary,
              boxShadow: `0 1px 4px 0 ${colors.accent}22`,
            }}
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
      <div className="flex-1 flex flex-col min-h-0" style={{ background: colors.background }}>
        {currentMode === 'chat' ? (
          <>
            {/* チャットメッセージ */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4" style={{ background: colors.background }}>
              {messages.length === 0 ? (
                <div
                  className="text-center text-sm opacity-70"
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
            <div className="px-5 pb-4 pt-2 border-t" style={{ borderColor: colors.border, background: colors.cardBg }}>
              <EditRequestForm
                mode="chat"
                onSubmit={handleSendMessage}
                isProcessing={isProcessing}
                placeholder="AIに質問やコード相談をしてください..."
              />
            </div>
          </>
        ) : (
          <>
            {/* 編集結果 */}
            <div className="flex-1 overflow-y-auto px-5 py-4" style={{ background: colors.background }}>
              {isProcessing && currentMode === 'edit' ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <div
                    className="w-8 h-8 border-4 border-current border-t-transparent rounded-full animate-spin mb-4"
                    style={{ borderColor: `${colors.primary} transparent ${colors.primary} ${colors.primary}` }}
                  ></div>
                  <div style={{ color: colors.foreground }} className="text-sm font-semibold mb-2">
                    AIが編集を実行中...
                  </div>
                  <div style={{ color: colors.mutedFg }} className="text-xs text-center">
                    選択されたファイルを解析し、<br />
                    編集提案を生成しています
                  </div>
                </div>
              ) : lastEditResponse ? (
                <ChangedFilesList
                  changedFiles={lastEditResponse.changedFiles}
                  onOpenReview={handleOpenReview}
                  onApplyChanges={handleApplyChanges}
                  onDiscardChanges={handleDiscardChanges}
                />
              ) : (
                <div
                  className="text-center text-sm opacity-70"
                  style={{ color: colors.mutedFg }}
                >
                  ファイルを選択して編集指示を入力してください
                </div>
              )}
            </div>

            {/* 編集入力 */}
            <div className="px-5 pb-4 pt-2 border-t" style={{ borderColor: colors.border, background: colors.cardBg }}>
              <EditRequestForm
                mode="edit"
                onSubmit={handleExecuteEdit}
                isProcessing={isProcessing}
                placeholder="コードの編集指示を入力してください..."
              />
            </div>
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
