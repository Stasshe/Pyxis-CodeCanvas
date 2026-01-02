// 統合AIパネル - GitHub Copilot風

'use client';

import { Bot, ChevronDown, Edit2, MessageSquare, Plus, Terminal, Trash2, X } from 'lucide-react';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

import FileSelector from './FileSelector';
import ChatContainer from './chat/ChatContainer';
import ChatInput from './chat/ChatInput';
import ModeSelector from './chat/ModeSelector';
import ChangedFilesPanel from './review/ChangedFilesPanel';

import { Confirmation } from '@/components/Confirmation';
import OperationWindow, { type OperationListItem } from '@/components/OperationWindow';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { LOCALSTORAGE_KEY } from '@/context/config';
import { buildAIFileContextList } from '@/engine/ai/contextBuilder';
import { fileRepository } from '@/engine/core/fileRepository';
import { editorMemoryManager } from '@/engine/editor';
import { useAI } from '@/hooks/ai/useAI';
import { useChatSpace } from '@/hooks/ai/useChatSpace';
import { useAIReview } from '@/hooks/useAIReview';
import { useTabStore } from '@/stores/tabStore';
import type { ChatSpaceMessage, FileItem, Project } from '@/types';

interface AIPanelProps {
  projectFiles: FileItem[];
  currentProject: Project | null;
  currentProjectId?: string;
}

export default function AIPanel({ projectFiles, currentProject, currentProjectId }: AIPanelProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [mode, setMode] = useState<'ask' | 'edit'>('ask');
  const [isFileSelectorOpen, setIsFileSelectorOpen] = useState(false);
  const [showSpaceList, setShowSpaceList] = useState(false);
  const [isChangedFilesMinimized, setIsChangedFilesMinimized] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const spaceButtonRef = useRef<HTMLButtonElement | null>(null);

  // Track if we're on the client for portal rendering
  const [isClient, setIsClient] = useState(false);

  // Revert confirmation state
  const [revertConfirmation, setRevertConfirmation] = useState<{
    open: boolean;
    message: ChatSpaceMessage | null;
  }>({ open: false, message: null });

  // Editing state for spaces
  const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null);
  const [editingSpaceName, setEditingSpaceName] = useState('');

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Compute dropdown position relative to viewport (fixed) so it appears under the button
  const dropdownPosition = useMemo(() => {
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
    updateChatMessage,
    revertToMessage,
  } = useChatSpace(currentProject?.id || null);

  // AI機能
  const {
    messages,
    isProcessing,
    fileContexts,
    sendMessage,
    updateFileContexts,
    toggleFileSelection,
    generatePromptText,
  } = useAI({
    onAddMessage: async (content, type, mode, fileContext, editResponse) => {
      return await addSpaceMessage(content, type, mode, fileContext, editResponse);
    },
    selectedFiles: currentSpace?.selectedFiles,
    onUpdateSelectedFiles: updateSpaceSelectedFiles,
    messages: currentSpace?.messages,
    projectId: currentProject?.id,
  });

  // Prompt debug modal state
  const [showPromptDebug, setShowPromptDebug] = useState(false);
  const [promptDebugText, setPromptDebugText] = useState('');

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

  // 履歴キャッシュ: filePath -> history entries

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

  // 現在アクティブなタブのファイルを取得
  const globalActiveTabId = useTabStore(state => state.globalActiveTab);
  const activePaneId = useTabStore(state => state.activePane);

  const activeTab = useMemo(() => {
    if (!globalActiveTabId) return null;
    const allTabs = useTabStore.getState().getAllTabs();

    // 同一ファイルが複数ペインで開かれている場合、現在アクティブなペインに属するタブを優先して返す。
    const preferred = allTabs.find(t => t.id === globalActiveTabId && t.paneId === activePaneId);
    if (preferred) return preferred;

    // フォールバック: id のみでマッチする最初のタブを返す
    return allTabs.find(t => t.id === globalActiveTabId) || null;
  }, [globalActiveTabId, activePaneId]);

  // アクティブタブをコンテキストに追加/削除するユーティリティ
  const handleToggleActiveTabContext = () => {
    if (!activeTab || !activeTab.path) return;

    const already = fileContexts.find(ctx => ctx.path === activeTab.path);
    if (already) {
      // 既に存在するなら選択解除
      toggleFileSelection(activeTab.path);
      return;
    }

    // content は Tab のユニオン型によって存在しない場合があるため型ガード
    const isContentTab = activeTab.kind === 'editor' || activeTab.kind === 'preview';
    const content = isContentTab ? (activeTab as any).content || '' : '';

    // FileItem は必須で `id` を持つため、path を id として使う
    const newFile: FileItem = {
      id: activeTab.path,
      path: activeTab.path,
      name: activeTab.path.split('/').pop() || activeTab.path,
      type: 'file',
      content,
    };

    handleFileSelect(newFile);
  };

  // レビューを開く（ストレージから履歴を取得してタブに渡す）
  // NOTE: NEW-ARCHITECTURE.mdに従い、aiEntryにはprojectIdを必ず含める
  const handleOpenReview = async (
    filePath: string,
    originalContent: string,
    suggestedContent: string
  ) => {
    const projectId = currentProject?.id;

    try {
      if (projectId) {
        const { getAIReviewEntry } = await import('@/engine/storage/aiStorageAdapter');
        const entry = await getAIReviewEntry(projectId, filePath);

        // 既存エントリがない場合でも、projectIdを含む最小限のaiEntryを作成
        const aiEntry = entry || { projectId, filePath };
        openAIReviewTab(filePath, originalContent, suggestedContent, aiEntry);
        return;
      }
    } catch (e) {
      console.warn('[AIPanel] Failed to load AI review entry:', e);
    }

    // currentProjectがない場合はprojectIdなしで開く（fallback）
    openAIReviewTab(filePath, originalContent, suggestedContent);
  };

  // 変更を適用（suggestedContent -> contentへコピー）
  // NOTE: NEW-ARCHITECTURE.mdに従い、fileRepositoryを直接使用
  // EditorMemoryManagerを使用して他のタブにも変更を同期
  const handleApplyChanges = async (filePath: string, newContent: string) => {
    const projectId = currentProject?.id;

    if (!projectId) {
      console.error('[AIPanel] No projectId available, cannot apply changes');
      alert('プロジェクトが選択されていません');
      return;
    }

    try {
      console.log('[AIPanel] Applying changes to:', filePath);

      // fileRepositoryを直接使用してファイルを保存（NEW-ARCHITECTURE.mdに従う）
      await fileRepository.saveFileByPath(projectId, filePath, newContent);

      // EditorMemoryManagerを通じて他のタブに変更を通知
      // 外部更新として扱い、同一ファイルを開いている全タブ（エディタ、AI Review等）に即時反映
      editorMemoryManager.updateFromExternal(filePath, newContent);

      // Clear AI review metadata for this file (non-blocking)
      try {
        await fileRepository.clearAIReview(projectId, filePath);
      } catch (e) {
        console.warn('[AIPanel] clearAIReview failed (non-critical):', e);
      }

      // Mark this file as applied in the assistant editResponse (keep original content for revert)
      try {
        if (currentSpace && updateChatMessage) {
          const editMsg = currentSpace.messages
            .slice()
            .reverse()
            .find(m => m.type === 'assistant' && m.mode === 'edit' && m.editResponse);

          if (editMsg && editMsg.editResponse) {
            const newChangedFiles = editMsg.editResponse.changedFiles.map(f =>
              f.path === filePath ? { ...f, applied: true } : f
            );
            const newEditResponse = { ...editMsg.editResponse, changedFiles: newChangedFiles };

            await updateChatMessage(currentSpace.id, editMsg.id, {
              editResponse: newEditResponse,
              content: editMsg.content,
            });
          }
        }
      } catch (e) {
        console.warn('[AIPanel] Failed to update chat message after apply:', e);
      }
    } catch (error) {
      console.error('[AIPanel] Failed to apply changes:', error);
      alert(`変更の適用に失敗しました: ${(error as Error).message}`);
    }
  };

  // 変更を破棄
  const handleDiscardChanges = async (filePath: string) => {
    const projectId = currentProject?.id;

    try {
      // Close the review tab immediately so UI updates.
      closeAIReviewTab(filePath);
      // Finally clear ai review metadata for this file
      if (projectId) {
        try {
          await fileRepository.init();
          await fileRepository.clearAIReview(projectId, filePath);
        } catch (e) {
          console.warn('[AIPanel] clearAIReview failed after discard:', e);
        }
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

  // Convert chatSpaces to OperationListItem[]
  const spaceItems: OperationListItem[] = useMemo(() => {
    return chatSpaces.map(space => {
      const isEditing = editingSpaceId === space.id;

      return {
        id: space.id,
        label: space.name,
        description: new Date(space.updatedAt).toLocaleDateString(),
        icon: <MessageSquare size={14} />,
        isActive: currentSpace?.id === space.id,
        isEditing,
        editValue: isEditing ? editingSpaceName : undefined,
        onClick: () => {
          selectSpace(space);
          setShowSpaceList(false);
        },
        onEditChange: val => setEditingSpaceName(val),
        onEditConfirm: () => {
          if (editingSpaceName.trim()) {
            updateSpaceName(space.id, editingSpaceName.trim());
          }
          setEditingSpaceId(null);
        },
        onEditCancel: () => {
          setEditingSpaceId(null);
        },
        actions: [
          {
            id: 'rename',
            icon: <Edit2 size={12} />,
            label: t('chatSpaceList.rename') || 'Rename',
            onClick: () => {
              setEditingSpaceId(space.id);
              setEditingSpaceName(space.name);
            },
          },
          {
            id: 'delete',
            icon: <Trash2 size={12} />,
            label: t('chatSpaceList.delete') || 'Delete',
            danger: true,
            onClick: () => {
              if (confirm(t('chatSpaceList.confirmDelete') || 'Delete this space?')) {
                deleteSpace(space.id);
              }
            },
          },
        ],
      };
    });
  }, [
    chatSpaces,
    currentSpace,
    editingSpaceId,
    editingSpaceName,
    t,
    selectSpace,
    updateSpaceName,
    deleteSpace,
  ]);

  return (
    <div
      className="flex flex-col h-full w-full"
      style={{
        background: colors.background,
        border: `1px solid ${colors.border}`,
        overflowX: 'hidden', // prevent any horizontal scrolling caused by long content
        boxSizing: 'border-box',
        minWidth: 0,
        fontSize: '12px',
        lineHeight: 1.25,
      }}
    >
      {/* ヘッダー */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b select-none"
        style={{
          borderColor: colors.border,
          background: colors.cardBg,
          overflowX: 'hidden', // ensure header doesn't force horizontal scroll
          minWidth: 0,
        }}
      >
        <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
          <Bot size={16} style={{ color: colors.accent }} />
          <span
            className="text-sm font-semibold select-none overflow-hidden text-ellipsis whitespace-nowrap"
            style={{ color: colors.foreground }}
          >
            AI Assistant
          </span>

          {/* スペース切り替え */}
          <div className="relative" style={{ minWidth: 0 }}>
            <button
              className="flex items-center gap-2 px-2 py-1 rounded-md hover:opacity-80 transition-all text-xs"
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
              <ChevronDown size={12} />
            </button>
          </div>
        </div>

        {/* Debug button to show internal prompt */}
        <button
          className="p-1 rounded hover:opacity-80 transition-all"
          style={{
            color: colors.mutedFg,
            background: 'transparent',
          }}
          onClick={() => {
            const promptText = generatePromptText(
              t('ai.promptDebug.sampleInput') || '(Sample input)',
              mode
            );
            setPromptDebugText(promptText);
            setShowPromptDebug(true);
          }}
          title={t('ai.showPrompt') || 'Show internal prompt'}
        >
          <Terminal size={14} />
        </button>
      </div>

      {/* OperationWindow-driven spaces list (opened when showSpaceList) */}
      {showSpaceList && (
        <OperationWindow
          isVisible={showSpaceList}
          onClose={() => setShowSpaceList(false)}
          projectFiles={projectFiles}
          items={spaceItems}
          listTitle={t('chatSpaceList.title') || 'Chat Spaces'}
          initialView="list"
          headerActions={[
            {
              icon: <Plus size={12} />,
              label: t('chatSpaceList.create') || 'New Space',
              onClick: async () => {
                await createNewSpace();
              },
            },
          ]}
        />
      )}

      {/* 上部の FileContextBar を廃止し、代わりに入力部のタグに削除ボタンを表示します */}

      {/* メッセージコンテナ */}
      <ChatContainer
        messages={messages}
        isProcessing={isProcessing}
        emptyMessage={mode === 'ask' ? t('AI.ask') : t('AI.edit')}
        onRevert={async (message: ChatSpaceMessage) => {
          // Show confirmation dialog instead of executing immediately
          setRevertConfirmation({ open: true, message });
        }}
      />

      {/* 変更ファイル一覧（Editモードで変更がある場合のみ表示）
          ここではパネルを最小化できるようにし、最小化中は ChangedFilesPanel 本体を描画しないことで
          「採用」などのアクションボタン類を表示しないようにする */}
      {mode === 'edit' &&
        latestEditResponse &&
        latestEditResponse.changedFiles.filter(f => !f.applied).length > 0 && (
          <div className="px-2 pt-2">
            <div
              className="flex items-center justify-between px-2 py-1 rounded-md"
              style={{
                background: colors.mutedBg,
                border: `1px solid ${colors.border}`,
                color: colors.foreground,
              }}
            >
              <div className="text-xs font-medium">変更ファイル</div>
              <div className="flex items-center gap-2">
                <div className="text-xs opacity-80">
                  {latestEditResponse.changedFiles.filter(f => !f.applied).length} 個
                </div>
                <button
                  type="button"
                  aria-label={isChangedFilesMinimized ? '展開する' : '最小化する'}
                  title={isChangedFilesMinimized ? '展開する' : '最小化する'}
                  className="p-1 rounded hover:opacity-80"
                  onClick={() => setIsChangedFilesMinimized(prev => !prev)}
                  style={{ color: colors.foreground }}
                >
                  <ChevronDown
                    size={12}
                    style={{ transform: isChangedFilesMinimized ? 'rotate(-180deg)' : 'none' }}
                  />
                </button>
              </div>
            </div>

            {/* パネル本体は最小化時は非表示にする（これにより採用ボタン等も表示されない） */}
            {!isChangedFilesMinimized && (
              <div className="mt-2">
                <ChangedFilesPanel
                  changedFiles={latestEditResponse.changedFiles.filter(f => !f.applied)}
                  onOpenReview={handleOpenReview}
                  onApplyChanges={handleApplyChanges}
                  onDiscardChanges={handleDiscardChanges}
                />
              </div>
            )}
          </div>
        )}

      {/* AI 提案履歴は表示しない（ユーザー要望により削除） */}

      {/* モードセレクター（下部に移動・小型化） */}
      {/* アクティブタブピルは ChatInput の選択ファイル列へ渡す（ここでは表示を行わない） */}

      <div className="px-2 pb-2 flex justify-end">
        <ModeSelector mode={mode} onChange={setMode} disabled={isProcessing} />
      </div>

      {/* 入力エリア */}
      <ChatInput
        mode={mode}
        onSubmit={handleSendMessage}
        isProcessing={isProcessing}
        selectedFiles={fileContexts.filter(ctx => ctx.selected).map(ctx => ctx.path)}
        onOpenFileSelector={() => setIsFileSelectorOpen(true)}
        onRemoveSelectedFile={toggleFileSelection}
        disabled={!currentProject && mode === 'edit'}
        // pass active tab info so ChatInput can render it inline with selected files
        activeTabPath={activeTab?.path}
        onToggleActiveTabContext={handleToggleActiveTabContext}
        isActiveTabSelected={
          !!activeTab && !!fileContexts.find(ctx => ctx.path === activeTab.path && ctx.selected)
        }
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

      {/* プロンプトデバッグモーダル - Portal rendering to avoid z-index issues */}
      {showPromptDebug &&
        isClient &&
        createPortal(
          <div
            className="fixed inset-0 flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
            onClick={() => setShowPromptDebug(false)}
          >
            <div
              className="rounded-lg shadow-xl max-w-4xl max-h-[80vh] overflow-hidden flex flex-col"
              style={{
                background: colors.cardBg,
                color: colors.foreground,
                border: `1px solid ${colors.border}`,
                width: '90vw',
              }}
              onClick={e => e.stopPropagation()}
            >
              <div
                className="flex items-center justify-between px-4 py-3 border-b"
                style={{ borderColor: colors.border }}
              >
                <h2 className="text-sm font-semibold">
                  {t('ai.promptDebug.title') || '内部プロンプト'} ({mode === 'ask' ? 'Ask' : 'Edit'}
                  )
                </h2>
                <button
                  className="p-1 rounded hover:opacity-80"
                  style={{ color: colors.mutedFg }}
                  onClick={() => setShowPromptDebug(false)}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4" style={{ background: colors.editorBg }}>
                <pre
                  className="text-xs font-mono whitespace-pre-wrap"
                  style={{ color: colors.editorFg }}
                >
                  {promptDebugText}
                </pre>
              </div>
              <div
                className="flex justify-end gap-2 px-4 py-3 border-t"
                style={{ borderColor: colors.border }}
              >
                <button
                  className="px-3 py-1.5 text-xs rounded"
                  style={{
                    background: colors.mutedBg,
                    color: colors.foreground,
                    border: `1px solid ${colors.border}`,
                  }}
                  onClick={() => {
                    navigator.clipboard.writeText(promptDebugText);
                  }}
                >
                  {t('ai.promptDebug.copy') || 'コピー'}
                </button>
                <button
                  className="px-3 py-1.5 text-xs rounded"
                  style={{
                    background: colors.accent,
                    color: colors.accentFg,
                  }}
                  onClick={() => setShowPromptDebug(false)}
                >
                  {t('ai.promptDebug.close') || '閉じる'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* リバート確認ダイアログ */}
      <Confirmation
        open={revertConfirmation.open}
        title={t('ai.revert.confirmTitle') || 'リバート確認'}
        message={
          t('ai.revert.confirmMessage') ||
          'この操作は、選択したメッセージ以降の全ての変更をファイルから元に戻します。この操作は取り消せません。続行しますか？'
        }
        confirmText={t('ai.revert.confirm') || 'リバートする'}
        cancelText={t('ai.revert.cancel') || 'キャンセル'}
        onCancel={() => setRevertConfirmation({ open: false, message: null })}
        onConfirm={async () => {
          const message = revertConfirmation.message;
          setRevertConfirmation({ open: false, message: null });

          if (!message) return;

          const projectId = currentProject?.id;
          try {
            if (!projectId) return;
            if (message.type !== 'assistant' || message.mode !== 'edit' || !message.editResponse)
              return;

            const { clearAIReviewEntry } = await import('@/engine/storage/aiStorageAdapter');

            // 1. このメッセージ以降の全メッセージを削除（このメッセージ含む）
            const deletedMessages = await revertToMessage(message.id);

            // 2. 削除されたメッセージの中から、editResponseを持つものを全て処理
            //    editResponse内のoriginalContentを使ってファイルを復元
            //    逆順で処理することで、最新の変更から順に元に戻す
            const reversedMessages = [...deletedMessages].reverse();

            for (const deletedMsg of reversedMessages) {
              if (
                deletedMsg.type === 'assistant' &&
                deletedMsg.mode === 'edit' &&
                deletedMsg.editResponse
              ) {
                const files = deletedMsg.editResponse.changedFiles || [];
                // Only revert files that were applied (default to false if undefined)
                const appliedFiles = files.filter(f => f.applied === true);

                for (const f of appliedFiles) {
                  try {
                    if (f.isNewFile) {
                      // This was a new file created by AI - delete it on revert
                      const fileToDelete = await fileRepository.getFileByPath(projectId, f.path);
                      if (fileToDelete) {
                        await fileRepository.deleteFile(fileToDelete.id);
                        console.log('[AIPanel] Deleted new file on revert:', f.path);
                      }
                    } else {
                      // Existing file - restore originalContent
                      await fileRepository.saveFileByPath(projectId, f.path, f.originalContent);
                      console.log('[AIPanel] Reverted file:', f.path);
                    }

                    // Clear AI review entry
                    try {
                      await clearAIReviewEntry(projectId, f.path);
                    } catch (e) {
                      console.warn('[AIPanel] clearAIReviewEntry failed', e);
                    }
                  } catch (e) {
                    console.warn('[AIPanel] revert file failed for', f.path, e);
                  }
                }
              }
            }

            console.log(
              '[AIPanel] Reverted to before message:',
              message.id,
              'deleted messages:',
              deletedMessages.length
            );
          } catch (e) {
            console.error('[AIPanel] handleRevertMessage failed', e);
          }
        }}
      />
    </div>
  );
}
