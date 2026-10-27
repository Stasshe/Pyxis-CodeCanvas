// 統合AIパネル - GitHub Copilot風

import { Bot, ChevronDown, Edit2, MessageSquare, Plus, Terminal, Trash2, X } from 'lucide-react';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSnapshot } from 'valtio';
import { Confirmation } from '@/components/layout/Confirmation';
import OperationWindow, {
  type OperationListItem,
} from '@/components/operation-window/OperationWindow';
import { LOCALSTORAGE_KEY } from '@/constants/config';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { clearAIReviewEntry, getAIReviewEntry } from '@/engine/core/metadata/aiStorageAdapter';
import { applyChatEdit } from '@/engine/ide/ai/applyChatEdit';
import { loadAIFileContext } from '@/engine/ide/ai/contextBuilder';
import { revertChatEdits } from '@/engine/ide/ai/revertChatEdits';
import { useAI } from '@/hooks/ai/useAI';
import { useAIFileContexts } from '@/hooks/ai/useAIFileContexts';
import { useAIReview } from '@/hooks/ai/useAIReview';
import { useChatSpace } from '@/hooks/ai/useChatSpace';
import { getInputHistoryStorageKey } from '@/hooks/ai/useInputHistory';
import { pushLogMessage } from '@/stores/loggerStore';
import { getCurrentRootPath } from '@/stores/projectStore';
import { tabState } from '@/stores/tabState';
import { collectAllTabs } from '@/stores/tabState/paneTree';
import type { ChatSpaceMessage, FileItem, Project } from '@/types/index';
import ChatContainer from './chat/ChatContainer';
import ChatInput from './chat/ChatInput';
import ModeSelector from './chat/ModeSelector';
import FileSelector from './FileSelector';
import ChangedFilesPanel from './review/ChangedFilesPanel';

interface AIPanelProps {
  projectFiles: FileItem[];
  currentProject: Project | null;
  rootPath: string | null;
}

function AIPanel({ projectFiles, currentProject, rootPath }: AIPanelProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [mode, setMode] = useState<'ask' | 'edit'>('ask');
  const [isFileSelectorOpen, setIsFileSelectorOpen] = useState(false);
  const [showSpaceList, setShowSpaceList] = useState(false);
  const [isChangedFilesMinimized, setIsChangedFilesMinimized] = useState(false);
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

  // チャットスペース管理
  const {
    chatSpaces,
    currentSpace,
    error: chatSpaceError,
    createNewSpace,
    selectSpace,
    deleteSpace,
    addMessage: addSpaceMessage,
    updateSelectedFiles: updateSpaceSelectedFiles,
    updateSpaceName,
    updateChatMessage,
    revertToMessage,
  } = useChatSpace(rootPath);

  const currentSpaceRef = useRef(currentSpace);
  currentSpaceRef.current = currentSpace;
  const [fileContextError, setFileContextError] = useState<string | null>(null);
  // AI機能
  const {
    messages,
    isProcessing,
    fileContexts,
    sendMessage,
    updateFileContexts,
    clearFileContexts,
    toggleFileSelection,
    generatePromptText,
  } = useAI({
    onAddMessage: async (content, type, mode, fileContext, editResponse, targetSpaceId) => {
      return await addSpaceMessage(content, type, mode, fileContext, editResponse, {
        rootPath: rootPath ?? undefined,
        spaceId: targetSpaceId ?? currentSpace?.id,
      });
    },
    selectedFiles: currentSpace?.selectedFiles,
    onUpdateSelectedFiles: updateSpaceSelectedFiles,
    onSelectionError: setFileContextError,
    messages: currentSpace?.messages,
    rootPath,
    spaceId: currentSpace?.id,
  });
  const fileContextsRef = useRef(fileContexts);
  fileContextsRef.current = fileContexts;
  const loadingFilePathsRef = useRef(new Set<string>());

  // Prompt debug modal state
  const [showPromptDebug, setShowPromptDebug] = useState(false);
  const [promptDebugText, setPromptDebugText] = useState('');

  // レビュー機能
  const { openAIReviewTab, closeAIReviewTab } = useAIReview();

  const findSourceEditMessage = (filePath: string, space = currentSpace) =>
    space?.messages
      .slice()
      .reverse()
      .find(
        message =>
          message.mode === 'edit' &&
          message.type === 'assistant' &&
          message.editResponse?.changedFiles.some(file => file.path === filePath)
      );

  const latestEditMessage = currentSpace?.messages
    .slice()
    .reverse()
    .find(msg => msg.mode === 'edit' && msg.type === 'assistant' && msg.editResponse);
  const latestEditResponse = latestEditMessage?.editResponse;

  const getFileContextRevision = useAIFileContexts({
    rootPath,
    projectFiles,
    currentSpace,
    fileContexts,
    updateFileContexts,
    clearFileContexts,
    updateSelectedFiles: updateSpaceSelectedFiles,
    setError: setFileContextError,
  });

  // 履歴キャッシュ: filePath -> history entries

  // API キーのチェック
  const isApiKeySet = () => {
    return !!localStorage.getItem(LOCALSTORAGE_KEY.GEMINI_API_KEY);
  };

  // メッセージ送信ハンドラー
  const handleSendMessage = async (content: string): Promise<boolean> => {
    if (!isApiKeySet()) {
      alert('Gemini APIキーが設定されていません。設定画面で設定してください。');
      return false;
    }

    if (!currentProject && mode === 'edit') {
      alert('プロジェクトが選択されていません。');
      return false;
    }

    try {
      const targetSpace = currentSpace ?? (await createNewSpace());
      if (!targetSpace) return false;
      await sendMessage(content, mode, targetSpace.id);
      return true;
    } catch (error) {
      console.error('Failed to send message:', error);
      const message = error instanceof Error ? error.message : String(error);
      pushLogMessage(message, 'error', 'AI');
      alert(`エラーが発生しました: ${message}`);
      return false;
    }
  };

  // ファイル選択
  const handleFileSelect = async (file: FileItem) => {
    const existingContext = fileContexts.find(ctx => ctx.path === file.path);
    if (existingContext) {
      toggleFileSelection(file.path);
      return;
    }
    if (file.type !== 'file' || loadingFilePathsRef.current.has(file.path)) return;

    const selectedSpaceId = currentSpace?.id;
    const selectedRootPath = rootPath;
    const revision = getFileContextRevision(file.path);
    loadingFilePathsRef.current.add(file.path);
    try {
      const newContext = await loadAIFileContext(file.path);
      const activeSpace = currentSpaceRef.current;
      if (
        getFileContextRevision(file.path) !== revision ||
        getCurrentRootPath() !== selectedRootPath ||
        (selectedSpaceId !== undefined &&
          (activeSpace?.id !== selectedSpaceId || activeSpace.rootPath !== selectedRootPath))
      ) {
        return;
      }
      const latestContexts = fileContextsRef.current;
      const existing = latestContexts.find(context => context.path === file.path);
      let nextContexts = [...latestContexts, newContext];
      if (existing) {
        nextContexts = latestContexts.map(context => ({
          ...context,
          selected: context.selected || context.path === file.path,
        }));
      }
      fileContextsRef.current = nextContexts;
      updateFileContexts(nextContexts);
    } catch (error) {
      if (
        getFileContextRevision(file.path) !== revision ||
        getCurrentRootPath() !== selectedRootPath ||
        currentSpaceRef.current?.id !== selectedSpaceId
      )
        return;
      const message = `Failed to load AI file context: ${error instanceof Error ? error.message : String(error)}`;
      console.error('[AIPanel] Failed to load selected file context:', error);
      setFileContextError(message);
      pushLogMessage(message, 'error', 'AI');
    } finally {
      loadingFilePathsRef.current.delete(file.path);
    }
  };

  // 現在アクティブなタブのファイルを取得
  const {
    globalActiveTab: globalActiveTabId,
    activePane: activePaneId,
    panes: tabPanes,
  } = useSnapshot(tabState);

  const activeTab = useMemo(() => {
    if (!globalActiveTabId) return null;
    const allTabs = collectAllTabs(tabPanes);

    // 同一ファイルが複数ペインで開かれている場合、現在アクティブなペインに属するタブを優先して返す。
    const preferred = allTabs.find(t => t.id === globalActiveTabId && t.paneId === activePaneId);
    if (preferred) return preferred;

    // フォールバック: id のみでマッチする最初のタブを返す
    return allTabs.find(t => t.id === globalActiveTabId) || null;
  }, [globalActiveTabId, activePaneId, tabPanes]);

  // アクティブタブをコンテキストに追加/削除するユーティリティ
  const handleToggleActiveTabContext = async () => {
    if (!activeTab || !activeTab.path) return;

    const already = fileContexts.find(ctx => ctx.path === activeTab.path);
    if (already) {
      // 既に存在するなら選択解除
      toggleFileSelection(activeTab.path);
      return;
    }

    if (activeTab.kind !== 'editor' && activeTab.kind !== 'preview') {
      const error = new Error(`Cannot add non-text tab content to AI context: ${activeTab.path}`);
      console.error('[AIPanel] Failed to add file context:', error);
      setFileContextError(error.message);
      pushLogMessage(error.message, 'error', 'AI');
      return;
    }

    await handleFileSelect({
      id: activeTab.path,
      path: activeTab.path,
      name: activeTab.path.split('/').pop() || activeTab.path,
      type: 'file',
    });
  };

  // レビューを開く（ストレージから履歴を取得してタブに渡す）
  // Load persisted review history by workspace and absolute file path.
  const handleOpenReview = async (
    filePath: string,
    originalContent: string,
    suggestedContent: string
  ) => {
    try {
      const sourceMessage = findSourceEditMessage(filePath);
      const sourceSpaceId = currentSpace?.id;
      if (!rootPath || !sourceMessage) {
        throw new Error('The source AI edit message is no longer available.');
      }

      const entry = await getAIReviewEntry(rootPath, filePath);
      if (!entry || entry.parentMessageId !== sourceMessage.id) {
        throw new Error('The AI review metadata is missing or belongs to another edit.');
      }

      const liveSpace = currentSpaceRef.current;
      const liveSourceMessage = findSourceEditMessage(filePath, liveSpace);
      if (
        getCurrentRootPath() !== rootPath ||
        liveSpace?.id !== sourceSpaceId ||
        liveSourceMessage?.id !== sourceMessage.id
      ) {
        throw new Error('The workspace or source edit changed while loading the AI review.');
      }

      await openAIReviewTab(filePath, originalContent, suggestedContent, entry);
    } catch (e) {
      const message = `Failed to open AI review: ${e instanceof Error ? e.message : String(e)}`;
      console.error('[AIPanel] Failed to open AI review:', e);
      pushLogMessage(message, 'error', 'AI');
      alert(message);
    }
  };

  // 変更を適用（suggestedContent -> contentへコピー）
  // 同一ファイルを開いている他タブに変更を同期
  const handleApplyChanges = async (filePath: string, newContent: string): Promise<boolean> => {
    if (!rootPath) {
      console.error('[AIPanel] No workspace root path available, cannot apply changes');
      alert('プロジェクトが選択されていません');
      return false;
    }

    if (!updateChatMessage) return false;
    return applyChatEdit(rootPath, currentSpace, filePath, newContent, updateChatMessage);
  };

  // 変更を破棄
  const handleDiscardChanges = async (filePath: string) => {
    try {
      const sourceMessage = findSourceEditMessage(filePath);
      const sourceSpaceId = currentSpace?.id;
      if (
        !rootPath ||
        !sourceMessage ||
        getCurrentRootPath() !== rootPath ||
        currentSpaceRef.current?.id !== sourceSpaceId
      ) {
        throw new Error('The source AI edit message is no longer available.');
      }

      await clearAIReviewEntry(rootPath, filePath, sourceMessage.id);
      const liveSpace = currentSpaceRef.current;
      if (
        getCurrentRootPath() === rootPath &&
        liveSpace?.id === sourceSpaceId &&
        findSourceEditMessage(filePath, liveSpace)?.id === sourceMessage.id
      ) {
        closeAIReviewTab(rootPath, filePath, sourceMessage.id);
      }
    } catch (error) {
      const message = `Failed to discard AI review: ${error instanceof Error ? error.message : String(error)}`;
      console.error('[AIPanel] Failed to discard AI review:', error);
      pushLogMessage(message, 'error', 'AI');
      alert(message);
    }
  };

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
        onEditConfirm: async () => {
          const name = editingSpaceName.trim();
          if (!name || (await updateSpaceName(space.id, name))) setEditingSpaceId(null);
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
        className="flex min-w-0 items-center justify-between gap-1 px-3 py-2 border-b select-none"
        style={{
          borderColor: colors.border,
          background: colors.cardBg,
          overflowX: 'hidden', // ensure header doesn't force horizontal scroll
          minWidth: 0,
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Bot size={16} className="shrink-0" style={{ color: colors.accent }} />
          <span
            className="min-w-0 shrink text-sm font-semibold select-none truncate"
            style={{ color: colors.foreground, maxWidth: '8rem' }}
          >
            AI Assistant
          </span>

          {/* スペース切り替え */}
          <div className="relative min-w-0 flex-1">
            <button
              type="button"
              className="flex min-w-0 max-w-full items-center gap-2 px-2 py-1 rounded-md hover:opacity-80 transition-all text-xs"
              style={{
                background: colors.mutedBg,
                color: colors.foreground,
                border: `1px solid ${colors.border}`,
                width: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                overflowWrap: 'anywhere',
              }}
              ref={spaceButtonRef}
              onClick={() => {
                setShowSpaceList(prev => !prev);
              }}
            >
              <span className="min-w-0 flex-1 truncate" style={{ overflowWrap: 'anywhere' }}>
                {currentSpace?.name || t('chatSpaceList.title')}
              </span>
              <ChevronDown size={12} className="shrink-0" />
            </button>
          </div>
        </div>

        {/* Debug button to show internal prompt */}
        <button
          type="button"
          className="shrink-0 p-1 rounded hover:opacity-80 transition-all"
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
                try {
                  await createNewSpace();
                } catch (error) {
                  const message = `Failed to create chat space: ${error instanceof Error ? error.message : String(error)}`;
                  pushLogMessage(message, 'error', 'AI');
                  alert(message);
                }
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
        emptyMessage={mode === 'ask' ? t('ai.mode.ask') : t('ai.mode.edit')}
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
              <div className="text-xs font-medium">{t('ai.changedFilesList.title')}</div>
              <div className="flex items-center gap-2">
                <div className="text-xs opacity-80">
                  {t('ai.changedFilesList.count', {
                    params: {
                      count: latestEditResponse.changedFiles.filter(f => !f.applied).length,
                    },
                  })}
                </div>
                <button
                  type="button"
                  aria-label={
                    isChangedFilesMinimized
                      ? t('ai.changedFilesList.expand')
                      : t('ai.changedFilesList.minimize')
                  }
                  title={
                    isChangedFilesMinimized
                      ? t('ai.changedFilesList.expand')
                      : t('ai.changedFilesList.minimize')
                  }
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

      {fileContextError && (
        <div role="alert" className="px-2 pb-1 text-xs text-red-500">
          {fileContextError}
        </div>
      )}
      {chatSpaceError && (
        <div role="alert" className="px-2 pb-1 text-xs text-red-500">
          {chatSpaceError}
        </div>
      )}

      {/* 入力エリア */}
      <ChatInput
        key={rootPath ?? 'no-workspace'}
        mode={mode}
        rootPath={rootPath ?? 'no-workspace'}
        historyStorageKey={getInputHistoryStorageKey(rootPath ?? 'no-workspace', mode)}
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
            tabIndex={0}
            role="button"
            onKeyDown={e => {
              if (e.key === 'Escape') setShowPromptDebug(false);
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setShowPromptDebug(false);
              }
            }}
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
              onKeyDown={e => e.stopPropagation()}
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
                  type="button"
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
                  type="button"
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
                  type="button"
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

          if (!message || !rootPath || !updateChatMessage) return;
          if (message.type !== 'assistant' || message.mode !== 'edit' || !message.editResponse)
            return;
          await revertChatEdits({
            rootPath,
            space: currentSpace,
            messageId: message.id,
            updateChatMessage,
            revertToMessage,
          });
        }}
      />
    </div>
  );
}

export default memo(AIPanel);
