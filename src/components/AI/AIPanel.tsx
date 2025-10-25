// 統合AIパネル - GitHub Copilot風

'use client';

import React, { useState, useEffect } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { useTranslation } from '@/context/I18nContext';
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
  const { t } = useTranslation();
  const [mode, setMode] = useState<'ask' | 'edit'>('ask');
  const [isFileSelectorOpen, setIsFileSelectorOpen] = useState(false);
  const [showSpaceList, setShowSpaceList] = useState(false);
  const [isChangedFilesMinimized, setIsChangedFilesMinimized] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const spaceButtonRef = React.useRef<HTMLButtonElement | null>(null);

  // Compute dropdown position relative to viewport (fixed) so it appears under the button
  const dropdownPosition = React.useMemo(() => {
    if (!anchorRect || typeof window === 'undefined') return null;
    const padding = 8;
    const desiredWidth = 320;
    const maxAvailableRight = window.innerWidth - padding - anchorRect.left;
    const width = Math.min(desiredWidth, Math.max(160, Math.min(360, maxAvailableRight)));

    // If the dropdown would overflow the right edge, shift it left
    let left = anchorRect.left;
    if (left + width + padding > window.innerWidth) {
      left = Math.max(padding, window.innerWidth - width - padding);
    }

    // place just below the button
    const top = anchorRect.bottom + 6;

    return { left, top, width };
  }, [anchorRect]);

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
      // 1) Save file first
      await saveFile(filePath, newContent);

      // 2) Close any open review tab for this file so editor state updates immediately
      closeAIReviewTab(filePath, setTabs, tabs);

      // Immediately update any open editor tabs that match this file path so the
      // editor reflects the applied changes without waiting for repository events.
      const normalizePath = (p?: string) => {
        if (!p) return '';
        const withoutKindPrefix = p.includes(':') ? p.replace(/^[^:]+:/, '') : p;
        const cleaned = withoutKindPrefix.replace(/(-preview|-diff|-ai)$/, '');
        return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
      };

      try {
        setTabs((prevTabs: any[]) =>
          prevTabs.map(t =>
            normalizePath(t.path) === normalizePath(filePath)
              ? { ...t, content: newContent, isDirty: false }
              : t
          )
        );
      } catch (e) {
        // non-fatal: if setTabs isn't available or fails, we still continue
        console.warn('[AIPanel] Failed to update tabs after applyChanges:', e);
      }

      // 成功メッセージを追加
      // Update chat to reflect that this file was applied. Recompute the
      // latest edit response at the time of handling to avoid stale closures.
      try {
        const prev = currentSpace?.messages
          .slice()
          .reverse()
          .find(msg => msg.mode === 'edit' && msg.type === 'assistant' && msg.editResponse)
          ?.editResponse;

        if (prev && prev.changedFiles && prev.changedFiles.length > 0) {
          const remaining = prev.changedFiles.filter(f => f.path !== filePath);
          if (remaining.length > 0) {
            await addSpaceMessage('', 'assistant', 'edit', [], {
              ...prev,
              changedFiles: remaining,
              message: `✅ ${filePath} を適用しました。残り ${remaining.length} 個の提案があります。`,
            });
          } else {
            // no remaining proposals: add a plain assistant note (no editResponse)
            await addSpaceMessage(`✅ ${filePath} の変更が適用されました。`, 'assistant', 'ask');
          }
        } else {
          // no previous edit response available: add a plain assistant note
          await addSpaceMessage(`✅ ${filePath} の変更が適用されました。`, 'assistant', 'ask');
        }
      } catch (e) {
        console.warn('[AIPanel] Failed to append updated edit message', e);
        await addSpaceMessage(`✅ ${filePath} の変更が適用されました。`, 'assistant', 'ask');
      }

      // Finally, clear AI review metadata for this file. Do this after updating
      // the chat so the edit response update remains the latest visible state.
      try {
        await clearAIReview(filePath);
      } catch (e) {
        console.warn('[AIPanel] clearAIReview failed after apply:', e);
      }
    } catch (error) {
      console.error('Failed to apply changes:', error);
      alert(`変更の適用に失敗しました: ${(error as Error).message}`);
    }
  };

  // 変更を破棄
  const handleDiscardChanges = async (filePath: string) => {
    try {
      // Close the review tab immediately so UI updates.
      closeAIReviewTab(filePath, setTabs, tabs);

      // Re-evaluate latest edit response at action time to avoid stale closures
      try {
        const prev = currentSpace?.messages
          .slice()
          .reverse()
          .find(msg => msg.mode === 'edit' && msg.type === 'assistant' && msg.editResponse)
          ?.editResponse;

        if (prev && prev.changedFiles && prev.changedFiles.length > 0) {
          const remaining = prev.changedFiles.filter(f => f.path !== filePath);
          if (remaining.length > 0) {
            await addSpaceMessage('', 'assistant', 'edit', [], {
              ...prev,
              changedFiles: remaining,
              message: `❌ ${filePath} を破棄しました。残り ${remaining.length} 個の提案があります。`,
            });
          } else {
            await addSpaceMessage(`❌ ${filePath} の変更が破棄されました。`, 'assistant', 'ask');
          }
        } else {
          await addSpaceMessage(`❌ ${filePath} の変更が破棄されました。`, 'assistant', 'ask');
        }
      } catch (e) {
        console.warn('[AIPanel] Failed to append updated edit message after discard', e);
        await addSpaceMessage(`❌ ${filePath} の変更が破棄されました。`, 'assistant', 'ask');
      }

      // Finally clear ai review metadata for this file
      try {
        await clearAIReview(filePath);
      } catch (e) {
        console.warn('[AIPanel] clearAIReview failed after discard:', e);
      }
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
        className="flex items-center justify-between px-4 py-3 border-b select-none"
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

      {/* Absolute-positioned dropdown for space list so it doesn't affect layout */}
      {showSpaceList && dropdownPosition && (
        <div
          className="z-50 select-none"
          style={{
            position: 'fixed',
            left: dropdownPosition.left,
            top: dropdownPosition.top,
            width: dropdownPosition.width,
            boxSizing: 'border-box',
          }}
          onMouseLeave={() => setShowSpaceList(false)}
        >
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
          mode === 'ask' ? t('AI.ask') : t('AI.edit')
        }
      />

      {/* 変更ファイル一覧（Editモードで変更がある場合のみ表示）
          ここではパネルを最小化できるようにし、最小化中は ChangedFilesPanel 本体を描画しないことで
          「採用」などのアクションボタン類を表示しないようにする */}
      {mode === 'edit' && latestEditResponse && latestEditResponse.changedFiles.length > 0 && (
        <div className="px-3 pt-2">
          <div
            className="flex items-center justify-between px-3 py-1 rounded-md"
            style={{
              background: colors.mutedBg,
              border: `1px solid ${colors.border}`,
              color: colors.foreground,
            }}
          >
            <div className="text-sm font-medium">変更ファイル</div>
            <div className="flex items-center gap-2">
              <div className="text-xs opacity-80">{latestEditResponse.changedFiles.length} 個</div>
              <button
                type="button"
                aria-label={isChangedFilesMinimized ? '展開する' : '最小化する'}
                title={isChangedFilesMinimized ? '展開する' : '最小化する'}
                className="p-1 rounded hover:opacity-80"
                onClick={() => setIsChangedFilesMinimized(prev => !prev)}
                style={{ color: colors.foreground }}
              >
                <ChevronDown size={14} style={{ transform: isChangedFilesMinimized ? 'rotate(-180deg)' : 'none' }} />
              </button>
            </div>
          </div>

          {/* パネル本体は最小化時は非表示にする（これにより採用ボタン等も表示されない） */}
          {!isChangedFilesMinimized && (
            <div className="mt-2">
              <ChangedFilesPanel
                changedFiles={latestEditResponse.changedFiles}
                onOpenReview={handleOpenReview}
                onApplyChanges={handleApplyChanges}
                onDiscardChanges={handleDiscardChanges}
                compact={false}
              />
            </div>
          )}
        </div>
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
