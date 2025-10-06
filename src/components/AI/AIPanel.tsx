// 統合AIパネル - GitHub Copilot風

'use client';

import React, { useState, useEffect } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { useChatSpace } from '@/hooks/ai/useChatSpace';
import { useAI } from '@/hooks/ai/useAI';
import { useAIReview } from '@/hooks/useAIReview';
import { buildAIFileContextList } from '@/engine/ai/contextBuilder';
import { LOCALSTORAGE_KEY } from '@/context/config';
import ChatContainer from './chat/ChatContainer';
import ChatInput from './chat/ChatInput';
import ModeSelector from './chat/ModeSelector';
import FileContextBar from './context/FileContextBar';
import ChangedFilesPanel from './review/ChangedFilesPanel';
import FileSelector from './FileSelector';
import ChatSpaceList from './ChatSpaceList';
import ChatSpaceDropdown from './ChatSpaceDropdown';
import { Bot, ChevronDown } from 'lucide-react';
import type { FileItem, Project, Tab } from '@/types';

interface AIPanelProps {
  projectFiles: FileItem[];
  currentProject: Project | null;
  currentProjectId?: string;
  tabs: Tab[];
  setTabs: (update: any) => void;
  setActiveTabId: (id: string) => void;
  saveFile: (filePath: string, content: string) => Promise<void>;
  clearAIReview: (filePath: string) => Promise<void>;
}

export default function AIPanel({
  projectFiles,
  currentProject,
  tabs,
  setTabs,
  setActiveTabId,
  saveFile,
  clearAIReview,
}: AIPanelProps) {
  const { colors } = useTheme();
  const [mode, setMode] = useState<'ask' | 'edit'>('ask');
  const [isFileSelectorOpen, setIsFileSelectorOpen] = useState(false);
  const [showSpaceList, setShowSpaceList] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const spaceButtonRef = React.useRef<HTMLButtonElement | null>(null);

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
    updateSpaceName,
  } = useChatSpace(currentProject?.id || null);

  // AI機能
  const {
    messages,
    isProcessing,
    fileContexts,
    sendMessage,
    updateFileContexts,
    toggleFileSelection,
  } = useAI({
    onAddMessage: async (content, type, mode, fileContext, editResponse) => {
      await addSpaceMessage(content, type, mode, fileContext, editResponse);
    },
    selectedFiles: currentSpace?.selectedFiles,
    onUpdateSelectedFiles: updateSpaceSelectedFiles,
    messages: currentSpace?.messages,
  });

  // レビュー機能
  const { openAIReviewTab, closeAIReviewTab } = useAIReview();

  // プロジェクトファイルが変更されたときにコンテキストを更新
  useEffect(() => {
    if (projectFiles.length > 0) {
      const selectedMap = new Map(fileContexts.map(ctx => [ctx.path, ctx.selected]));
      const contexts = buildAIFileContextList(projectFiles).map(ctx => ({
        ...ctx,
        selected: selectedMap.get(ctx.path) ?? false,
      }));
      updateFileContexts(contexts);
    }
  }, [projectFiles]);

  // API キーのチェック
  const isApiKeySet = () => {
    return !!localStorage.getItem(LOCALSTORAGE_KEY.GEMINI_API_KEY);
  };

  // メッセージ送信ハンドラー
  const handleSendMessage = async (content: string) => {
    if (!isApiKeySet()) {
      alert('Gemini APIキーが設定されていません。設定画面で設定してください。');
      return;
    }

    if (!currentProject && mode === 'edit') {
      alert('プロジェクトが選択されていません。');
      return;
    }

    try {
      await sendMessage(content, mode);
    } catch (error) {
      console.error('Failed to send message:', error);
      alert(`エラーが発生しました: ${(error as Error).message}`);
    }
  };

  // ファイル選択
  const handleFileSelect = (file: FileItem) => {
    const existingContext = fileContexts.find(ctx => ctx.path === file.path);
    if (!existingContext && file.type === 'file' && file.content) {
      const newContext = {
        path: file.path,
        name: file.name,
        content: file.content,
        selected: true,
      };
      const newContexts = [...fileContexts, newContext];
      updateFileContexts(newContexts);
    } else if (existingContext) {
      toggleFileSelection(file.path);
    }
  };

  // レビューを開く
  const handleOpenReview = (
    filePath: string,
    originalContent: string,
    suggestedContent: string
  ) => {
    openAIReviewTab(filePath, originalContent, suggestedContent, setTabs, setActiveTabId, tabs);
  };

  // 変更を適用（suggestedContent -> contentへコピー）
  const handleApplyChanges = async (filePath: string, newContent: string) => {
    if (!currentProject) return;

    try {
      await saveFile(filePath, newContent);
      await clearAIReview(filePath);
      closeAIReviewTab(filePath, setTabs, tabs);

      // 成功メッセージを追加
      await addSpaceMessage('', 'assistant', 'edit', [], {
        changedFiles: [],
        message: `✅ ${filePath} の変更が適用されました。`,
      });
    } catch (error) {
      console.error('Failed to apply changes:', error);
      alert(`変更の適用に失敗しました: ${(error as Error).message}`);
    }
  };

  // 変更を破棄
  const handleDiscardChanges = async (filePath: string) => {
    try {
      await clearAIReview(filePath);
      closeAIReviewTab(filePath, setTabs, tabs);

      await addSpaceMessage('', 'assistant', 'edit', [], {
        changedFiles: [],
        message: `❌ ${filePath} の変更が破棄されました。`,
      });
    } catch (error) {
      console.error('Failed to discard changes:', error);
      alert(`変更の破棄に失敗しました: ${(error as Error).message}`);
    }
  };

  // 最新の編集レスポンスを取得
  const latestEditResponse = currentSpace?.messages
    .slice()
    .reverse()
    .find(msg => msg.mode === 'edit' && msg.type === 'assistant' && msg.editResponse)?.editResponse;

  return (
    <div
      className="flex flex-col h-full w-full"
      style={{
        background: colors.background,
        border: `1px solid ${colors.border}`,
        overflowX: 'hidden', // prevent any horizontal scrolling caused by long content
        boxSizing: 'border-box',
        minWidth: 0,
      }}
    >
      {/* ヘッダー */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{
          borderColor: colors.border,
          background: colors.cardBg,
          overflowX: 'hidden', // ensure header doesn't force horizontal scroll
          minWidth: 0,
        }}
      >
        <div
          className="flex items-center gap-3"
          style={{ minWidth: 0 }}
        >
          <Bot
            size={20}
            style={{ color: colors.accent }}
          />
          <span
            className="text-base font-semibold select-none overflow-hidden text-ellipsis whitespace-nowrap"
            style={{ color: colors.foreground }}
          >
            AI Assistant
          </span>

          {/* スペース切り替え */}
          <div
            className="relative"
            style={{ minWidth: 0 }}
          >
            <button
              className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:opacity-80 transition-all text-sm"
              style={{
                background: colors.mutedBg,
                color: colors.foreground,
                border: `1px solid ${colors.border}`,
                maxWidth: '220px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                overflowWrap: 'anywhere',
                display: 'inline-flex',
                alignItems: 'center',
              }}
              ref={spaceButtonRef}
              onClick={() => {
                if (spaceButtonRef.current) {
                  setAnchorRect(spaceButtonRef.current.getBoundingClientRect());
                }
                setShowSpaceList(prev => !prev);
              }}
            >
              <span
                className="truncate"
                style={{ maxWidth: '160px', display: 'inline-block', overflowWrap: 'anywhere' }}
              >
                {currentSpace?.name || 'スペース'}
              </span>
              <ChevronDown size={14} />
            </button>

            {/* showSpaceList is rendered inline below the header to avoid being clipped/hidden */}
          </div>
        </div>
      </div>

      {/* Inline space list (renders in normal flow so it won't be hidden) */}
      {showSpaceList && (
        <div className="px-4 pb-2" onMouseLeave={() => setShowSpaceList(false)}>
          <ChatSpaceList
            chatSpaces={chatSpaces}
            currentSpace={currentSpace}
            onSelectSpace={space => {
              selectSpace(space);
              setShowSpaceList(false);
            }}
            onCreateSpace={async name => {
              await createNewSpace(name);
            }}
            onDeleteSpace={deleteSpace}
            onUpdateSpaceName={updateSpaceName}
          />
        </div>
      )}

      {/* ファイルコンテキストバー */}
      {fileContexts.filter(ctx => ctx.selected).length > 0 && (
        <FileContextBar
          contexts={fileContexts}
          onToggleSelection={toggleFileSelection}
          onOpenSelector={() => setIsFileSelectorOpen(true)}
        />
      )}

      {/* メッセージコンテナ */}
      <ChatContainer
        messages={messages}
        isProcessing={isProcessing}
        compact={false}
        emptyMessage={
          mode === 'ask' ? '質問やコード相談をしてください' : 'コードの編集指示を入力してください'
        }
      />

      {/* 変更ファイル一覧（Editモードで変更がある場合のみ表示） */}
      {mode === 'edit' && latestEditResponse && latestEditResponse.changedFiles.length > 0 && (
        <ChangedFilesPanel
          changedFiles={latestEditResponse.changedFiles}
          onOpenReview={handleOpenReview}
          onApplyChanges={handleApplyChanges}
          onDiscardChanges={handleDiscardChanges}
          compact={false}
        />
      )}

      {/* モードセレクター（下部に移動・小型化） */}
      <div className="px-2 pb-2 flex justify-end">
        <ModeSelector
          mode={mode}
          onChange={setMode}
          disabled={isProcessing}
          small
        />
      </div>

      {/* 入力エリア */}
      <ChatInput
        mode={mode}
        onSubmit={handleSendMessage}
        isProcessing={isProcessing}
        selectedFiles={fileContexts.filter(ctx => ctx.selected).map(ctx => ctx.path)}
        onOpenFileSelector={() => setIsFileSelectorOpen(true)}
        disabled={!currentProject && mode === 'edit'}
      />

      {/* ファイルセレクター */}
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
