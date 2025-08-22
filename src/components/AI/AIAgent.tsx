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
import { useProject } from '@/utils/core/project';
import { LOCALSTORAGE_KEY } from '@/context/config';

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

  //手動更新ハンドラ
  const handleRefreshFileContexts = async () => {
    if (currentProject) {
      console.log('[AIAgent] Manual refresh requested');
      try {
        // プロジェクトファイルを強制的に再取得
        const { refreshProjectFiles } = useProject();
        await refreshProjectFiles();
        // console.log('[AIAgent] Project files refreshed');
      } catch (error) {
        console.error('[AIAgent] Failed to refresh files:', error);
      }
    }
  };

  // 編集実行ハンドラー
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
      // console.log('[AIAgent] Updating file contexts due to projectFiles change');
      // console.log('[AIAgent] Current projectFiles:', projectFiles.map(f => ({
      //   path: f.path,
      //   hasContent: !!f.content,
      //   contentLength: f.content?.length || 0,
      //   type: f.type
      // })));
      const contexts = buildAIFileContextList(projectFiles);
      updateFileContexts(contexts);
    }
  }, [projectFiles]); // projectFiles全体に依存し、内容変更も検知

  // API キーのチェック
  const isApiKeySet = () => {
    return !!localStorage.getItem(LOCALSTORAGE_KEY.GEMINI_API_KEY);
  };


  // ファイル選択クリア関数
  const clearFileSelections = () => {
    const cleared = fileContexts.map(ctx => ({ ...ctx, selected: false }));
    updateFileContexts(cleared);
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
      clearFileSelections();
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
      
      // チャットスペースのメッセージからも該当ファイルを削除
      if (currentSpace) {
        const updatedMessages = currentSpace.messages.map(message => {
          if (message.editResponse && message.editResponse.changedFiles.some(f => f.path === filePath)) {
            return {
              ...message,
              editResponse: {
                ...message.editResponse,
                changedFiles: message.editResponse.changedFiles.filter(f => f.path !== filePath)
              }
            };
          }
          return message;
        });
        
        // 現在のスペースを更新
        const updatedSpace = { ...currentSpace, messages: updatedMessages };
        await addSpaceMessage('', 'assistant', 'edit', [], {
          changedFiles: [],
          message: `${filePath} の変更が適用されました。`
        });
      }

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
      
      // チャットスペースのメッセージからも該当ファイルを削除
      if (currentSpace) {
        await addSpaceMessage('', 'assistant', 'edit', [], {
          changedFiles: [],
          message: `${filePath} の変更が破棄されました。`
        });
      }
      
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
        border: `1px solid ${colors.border}`,
        overflow: 'hidden',
      }}
    >
      {/* コンパクトヘッダー */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{
          borderColor: colors.border,
          background: colors.cardBg,
          minHeight: '32px',
        }}
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: colors.accent }}
            ></div>
            <span
              className="text-sm font-medium"
              style={{ color: colors.foreground }}
            >
              AI Agent
            </span>
          </div>
          {/* スペース切り替えドロップダウン */}
          <div className="relative">
            <button
              className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-opacity-80 transition"
              style={{
                background: colors.mutedBg,
                color: colors.mutedFg,
                border: `1px solid ${colors.border}`,
              }}
              onClick={() => setShowSpaceList(!showSpaceList)}
            >
              <span className="max-w-24 truncate">
                {currentSpace?.name || 'スペース'}
              </span>
              <svg 
                className="w-3 h-3" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {/* スペースドロップダウン */}
            {showSpaceList && (
              <div 
                className="absolute top-full left-0 mt-1 w-64 rounded border shadow-lg z-10"
                style={{
                  background: colors.cardBg,
                  borderColor: colors.border,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                }}
              >
                <div className="p-2">
                  <ChatSpaceList
                    chatSpaces={chatSpaces}
                    currentSpace={currentSpace}
                    onSelectSpace={(space) => {
                      selectSpace(space);
                      setShowSpaceList(false);
                      clearFileSelections(); // スペース切り替え時にファイルセレクトをクリア
                    }}
                    onCreateSpace={async (name) => {
                      if (chatSpaces.length >= 10) {
                        alert('スペースは最大10個までです。不要なスペースを削除してください。');
                        return;
                      }
                      await createNewSpace(name);
                      setShowSpaceList(false);
                      clearFileSelections(); // 新規スペース作成時もクリア
                    }}
                    onDeleteSpace={deleteSpace}
                    onUpdateSpaceName={async (spaceId, newName) => {
                      await updateSpaceName(spaceId, newName);
                      // UI側stateも即座に反映
                      const updatedSpaces = chatSpaces.map(s => s.id === spaceId ? { ...s, name: newName, updatedAt: new Date() } : s);
                      // selectSpaceで再選択してUI更新
                      const updated = updatedSpaces.find(s => s.id === spaceId);
                      if (updated) selectSpace(updated);
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* メインコンテンツ */}
      <div className="flex-1 flex flex-col min-h-0" style={{ background: colors.background }}>
        {currentMode === 'chat' ? (
          <>
            {/* チャットメッセージ */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2" style={{ background: colors.background }}>
              {messages.length === 0 ? (
                <div
                  className="flex flex-col items-center justify-center h-full text-center select-none"
                  style={{ color: colors.mutedFg }}
                >
                  <svg className="w-8 h-8 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <div className="text-sm">AIとチャットを開始</div>
                  <div className="text-xs opacity-70 mt-1">質問やコード相談をしてください</div>
                </div>
              ) : (
                messages.map(message => (
                  <ChatMessage 
                    key={message.id} 
                    message={message}
                    compact={true}
                  />
                ))
              )}
              {isProcessing && (
                <div className="flex items-center gap-2 text-xs py-2" style={{ color: colors.mutedFg }}>
                  <div className="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full"></div>
                  回答生成中...
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* 編集結果 */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2" style={{ background: colors.background }}>
              {isProcessing && currentMode === 'edit' ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="relative mb-4">
                    <div
                      className="w-8 h-8 border-3 border-current border-t-transparent rounded-full animate-spin"
                      style={{ borderColor: `${colors.accent} transparent ${colors.accent} ${colors.accent}` }}
                    ></div>
                    <div
                      className="absolute inset-0 w-8 h-8 border-3 border-current border-b-transparent rounded-full animate-spin"
                      style={{ 
                        borderColor: `transparent transparent ${colors.accent} transparent`,
                        animationDirection: 'reverse',
                        animationDuration: '1.5s'
                      }}
                    ></div>
                  </div>
                  <div style={{ color: colors.foreground }} className="text-sm font-medium mb-1">
                    🤖 AI編集実行中...
                  </div>
                  <div style={{ color: colors.mutedFg }} className="text-xs">
                    ファイルを解析して編集提案を生成しています
                  </div>
                </div>
              ) : messages.length === 0 ? (
                <div
                  className="flex flex-col items-center justify-center h-full text-center select-none"
                  style={{ color: colors.mutedFg }}
                >
                  <svg className="w-8 h-8 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  <div className="text-sm">コード編集モード</div>
                  <div className="text-xs opacity-70 mt-1">ファイルを選択して編集指示を入力</div>
                </div>
              ) : (
                <>
                  {/* チャットメッセージを表示 */}
                  {messages.map(message => (
                    <ChatMessage 
                      key={message.id} 
                      message={message}
                      onOpenReview={handleOpenReview}
                      onApplyChanges={handleApplyChanges}
                      onDiscardChanges={handleDiscardChanges}
                      showEditActions={true}
                      compact={false}
                    />
                  ))}
                  
                  {/* 最新の編集結果がある場合、追加でChangedFilesListを表示 */}
                  {lastEditResponse && lastEditResponse.changedFiles.length > 0 && (
                    <div 
                      className="p-3 rounded border"
                      style={{ 
                        borderColor: colors.border, 
                        background: colors.mutedBg 
                      }}
                    >
                      <div 
                        className="text-sm font-medium mb-2 flex items-center gap-2"
                        style={{ color: colors.foreground }}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        最新の編集提案
                      </div>
                      <ChangedFilesList
                        changedFiles={lastEditResponse.changedFiles}
                        onOpenReview={handleOpenReview}
                        onApplyChanges={handleApplyChanges}
                        onDiscardChanges={handleDiscardChanges}
                        compact={false}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}


        {/* ファイルコンテキスト表示（入力エリアの直上） */}
        {fileContexts.filter(ctx => ctx.selected).length > 0 && (
          <div
            className="px-3 py-1 border-t"
            style={{
              borderColor: colors.border,
              background: colors.mutedBg,
            }}
          >
            <ContextFileList
              contexts={fileContexts}
              onToggleSelection={toggleFileSelection}
              compact={true}
            />
          </div>
        )}

        {/* ファイル選択ボタン（edit/askタブの上に移動） */}
        <div className="px-3 py-1 flex justify-end">
          <button
            className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-opacity-80 transition"
            style={{
              background: colors.mutedBg,
              color: colors.mutedFg,
              border: `1px solid ${colors.border}`,
            }}
            onClick={() => setIsFileSelectorOpen(true)}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>ファイル</span>
          </button>
        </div>

        {/* 入力エリア */}
        <div 
          className="border-t px-3 py-1.5"
          style={{ 
            borderColor: colors.border, 
            background: colors.cardBg 
          }}
        >
          {/* モード切り替えタブ */}
          <div className="flex mb-1.5 relative">
            <button
              className={`flex-1 text-xs py-0.5 px-2 rounded-l border-r-0 transition relative ${currentMode === 'chat' ? 'font-bold shadow' : ''}`}
              style={{
                background: currentMode === 'chat' ? colors.accent : colors.mutedBg,
                border: currentMode === 'chat' ? `3px solid ${colors.border}` : 'none',
                color: currentMode === 'chat' ? colors.accentFg : colors.mutedFg,
                position: 'relative',
                zIndex: currentMode === 'chat' ? 2 : 1,
                boxShadow: currentMode === 'chat' ? `0 2px 0 0 ${colors.accent}` : 'none',
                outline: currentMode === 'chat' ? `2px solid ${colors.accent}` : 'none',
                outlineOffset: currentMode === 'chat' ? '-2px' : '0',
              }}
              onClick={() => setCurrentMode('chat')}
              >
              <span className="inline-flex items-center gap-1">
                <span style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: currentMode === 'chat' ? colors.accentFg : 'transparent',
                  marginRight: 4,
                  transition: 'background 0.2s',
                }}></span>
                💬 Ask
              </span>
              {currentMode === 'chat' && (
                <span
                className="absolute left-1/2 -translate-x-1/2 bottom-0 w-3/4 h-0.5 rounded"
                  style={{
                    background: colors.accentFg,
                    boxShadow: `0 2px 8px 0 ${colors.accent}33`,
                  }}
                ></span>
              )}
            </button>
            <button
              className={`flex-1 text-xs py-0.5 px-2 rounded-r transition relative ${currentMode === 'edit' ? 'font-bold shadow' : ''}`}
              style={{
                background: currentMode === 'edit' ? colors.accent : colors.mutedBg,
                color: currentMode === 'edit' ? colors.accentFg : colors.mutedFg,
                border: currentMode == 'edit' ? `3px solid ${colors.border}` : 'none',
                position: 'relative',
                zIndex: currentMode === 'edit' ? 2 : 1,
                boxShadow: currentMode === 'edit' ? `0 2px 0 0 ${colors.accent}` : 'none',
                outline: currentMode === 'edit' ? `2px solid ${colors.accent}` : 'none',
                outlineOffset: currentMode === 'edit' ? '-2px' : '0',
              }}
              onClick={() => setCurrentMode('edit')}
              >
              <span className="inline-flex items-center gap-1">
                <span style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: currentMode === 'edit' ? colors.accentFg : 'transparent',
                  marginRight: 4,
                  transition: 'background 0.2s',
                }}></span>
                ✏️ Edit
              </span>
              {currentMode === 'edit' && (
                <span
                className="absolute left-1/2 -translate-x-1/2 bottom-0 w-3/4 h-0.5 rounded"
                style={{
                  background: colors.accentFg,
                    boxShadow: `0 2px 8px 0 ${colors.accent}33`,
                  }}
                ></span>
              )}
            </button>
          </div>

          {/* 入力フォーム */}
          <EditRequestForm
            mode={currentMode}
            onSubmit={currentMode === 'chat' ? handleSendMessage : handleExecuteEdit}
            isProcessing={isProcessing}
            placeholder={currentMode === 'chat' 
              ? "AIに質問やコード相談..." 
              : "コードの編集指示..."
            }
            selectedFiles={fileContexts.filter(ctx => ctx.selected).map(ctx => ctx.path)}
            onFileSelect={(files) => {
              // ファイル選択を更新
              const updatedContexts = fileContexts.map(ctx => ({
                ...ctx,
                selected: files.includes(ctx.path)
              }));
              updateFileContexts(updatedContexts);
            }}
            availableFiles={fileContexts.map(ctx => ctx.path)}
          />
        </div>
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
