'use client';

import {
  Check,
  ChevronDown,
  Clock,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import type React from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import GitHistory from './GitHistory';

import OperationWindow, { type OperationListItem } from '@/components/Top/OperationWindow';
import { LOCALSTORAGE_KEY } from '@/constants/config';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import type { BranchFilterMode } from '@/engine/cmd/global/gitOperations/log';

import { generateCommitMessage } from '@/engine/commitMsgAI';
import { useDiffTabHandlers } from '@/hooks/ui/useDiffTabHandlers';
import type { GitCommit, GitRepository, GitStatus } from '@/types/git';

interface GitPanelProps {
  currentProject?: string;
  currentProjectId?: string;
  onRefresh?: () => void;
  gitRefreshTrigger?: number;
  onGitStatusChange?: (changesCount: number) => void;
}

import { Confirmation } from '@/components/Confirmation';
import ChangesList from './GitPanel/ChangesList';
import CommitBox from './GitPanel/CommitBox';
import ErrorState from './GitPanel/ErrorState';
import LoadingState from './GitPanel/LoadingState';
import { useGitPanel } from './GitPanel/useGitPanel';

export default function GitPanel({
  currentProject,
  currentProjectId,
  onRefresh,
  gitRefreshTrigger,
  onGitStatusChange,
}: GitPanelProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);

  const [showBranchSelector, setShowBranchSelector] = useState(false);
  const branchButtonRef = useRef<HTMLButtonElement | null>(null);

  // use the extracted hook for git operations/state
  const {
    gitRepo,
    isLoading,
    error,
    isLoadingMore,
    hasRemote,
    availableBranches,
    branchFilterMode,
    setBranchFilterMode,
    selectedBranches,
    setSelectedBranches,
    commitDepth,
    setCommitDepth,
    fetchGitStatus,
    loadMoreCommits,
    stageFile,
    unstageFile,
    stageAll,
    unstageAll,
    discardChanges,
    // group discard helpers
    discardAllUnstaged,
    discardAllStaged,
    commit: commitOp,
    getDiff,
  } = useGitPanel({ currentProject, currentProjectId, onGitStatusChange });

  const handleDiscardAllUnstaged = useCallback(async () => {
    try {
      await discardAllUnstaged();
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Failed to discard all unstaged:', err);
      setUiError(err instanceof Error ? err.message : 'Failed to discard changes');
    }
  }, [discardAllUnstaged, onRefresh]);

  const handleDiscardAllStaged = useCallback(async () => {
    try {
      await discardAllStaged();
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Failed to discard all staged:', err);
      setUiError(err instanceof Error ? err.message : 'Failed to discard changes');
    }
  }, [discardAllStaged, onRefresh]);

  // Branch filter persistence restored from sessionStorage
  const getStoredBranchFilter = useCallback(() => {
    if (!currentProjectId) return { mode: 'auto' as BranchFilterMode, branches: [] as string[] };
    const modeKey = `gitBranchFilterMode_${currentProjectId}`;
    const branchesKey = `gitBranchFilterBranches_${currentProjectId}`;
    const storedMode = sessionStorage.getItem(modeKey) as BranchFilterMode | null;
    const storedBranches = sessionStorage.getItem(branchesKey);
    return {
      mode: storedMode || 'auto',
      branches: storedBranches ? JSON.parse(storedBranches) : [],
    };
  }, [currentProjectId]);

  // setters that persist
  const setBranchFilterModeAndPersist = useCallback(
    (mode: BranchFilterMode) => {
      setBranchFilterMode(mode);
      if (currentProjectId) sessionStorage.setItem(`gitBranchFilterMode_${currentProjectId}`, mode);
    },
    [currentProjectId, setBranchFilterMode]
  );

  const setSelectedBranchesAndPersist = useCallback(
    (branches: string[]) => {
      setSelectedBranches(branches);
      if (currentProjectId)
        sessionStorage.setItem(
          `gitBranchFilterBranches_${currentProjectId}`,
          JSON.stringify(branches)
        );
    },
    [currentProjectId, setSelectedBranches]
  );

  // プロジェクト変更時にsessionStorageから復元
  useEffect(() => {
    if (currentProjectId) {
      const { mode, branches } = getStoredBranchFilter();
      setBranchFilterMode(mode);
      setSelectedBranches(branches);
    }
  }, [currentProjectId, getStoredBranchFilter]);

  // プロジェクトごとのコミット深度をsessionStorageで永続化
  const getStoredCommitDepth = useCallback(() => {
    if (!currentProjectId) return 20;
    const key = `gitCommitDepth_${currentProjectId}`;
    const stored = sessionStorage.getItem(key);
    return stored ? Number.parseInt(stored, 10) : 20;
  }, [currentProjectId]);

  // commit depth, fetch and history logic moved to `useGitPanel` hook
  const { handleDiffFileClick } = useDiffTabHandlers({
    name: currentProject,
    id: currentProjectId,
  });

  // wire simple wrappers to the hook's actions (keeps component intent explicit)
  const handleStageFile = stageFile;
  const handleUnstageFile = unstageFile;
  const handleStageAll = stageAll;
  const handleUnstageAll = unstageAll;
  const handleDiscardChanges = useCallback(
    async (file: string) => {
      await discardChanges(file);
      if (onRefresh) onRefresh();
    },
    [discardChanges, onRefresh]
  );

  // confirmation dialog state for destructive actions
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState<string | undefined>(undefined);
  const [confirmMessage, setConfirmMessage] = useState<string | undefined>(undefined);
  const confirmActionRef = useRef<(() => Promise<void> | void) | null>(null);

  const openConfirm = (
    title: string | undefined,
    message: string | undefined,
    action: () => Promise<void> | void
  ) => {
    setConfirmTitle(title);
    setConfirmMessage(message);
    confirmActionRef.current = action;
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    setConfirmOpen(false);
    const action = confirmActionRef.current;
    confirmActionRef.current = null;
    if (action) {
      try {
        await action();
      } catch (err) {
        console.error('Confirmed action failed:', err);
        setUiError(err instanceof Error ? err.message : '操作に失敗しました');
      }
    }
  };

  const handleCancelConfirm = () => {
    confirmActionRef.current = null;
    setConfirmOpen(false);
  };

  // request wrappers that show confirmation before executing
  const handleRequestDiscardChanges = useCallback(
    async (file: string) => {
      const title = t('git.discardChangesTitle');
      const message = `${t('git.discardChangesMessage')} ${file}`;
      openConfirm(title, message, async () => handleDiscardChanges(file));
    },
    [handleDiscardChanges, t]
  );

  const handleRequestDiscardAllUnstaged = useCallback(async () => {
    const count =
      (gitRepo?.status?.unstaged?.length || 0) +
      (gitRepo?.status?.deleted?.length || 0) +
      (gitRepo?.status?.untracked?.length || 0);
    if (count === 0) return;
    const title = t('git.discardChangesTitle');
    const message = `${t('git.discardAllAndRevert')} (${count})`;
    openConfirm(title, message, async () => {
      await discardAllUnstaged();
      if (onRefresh) onRefresh();
    });
  }, [gitRepo?.status, discardAllUnstaged, onRefresh, t]);

  const handleRequestDiscardAllStaged = useCallback(async () => {
    const count = gitRepo?.status?.staged?.length || 0;
    if (count === 0) return;
    const title = t('git.discardChangesTitle');
    const message = `${t('git.discardAllAndRevert')} (${count})`;
    openConfirm(title, message, async () => {
      await discardAllStaged();
      if (onRefresh) onRefresh();
    });
  }, [gitRepo?.status, discardAllStaged, onRefresh, t]);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) return;
    setIsCommitting(true);
    setUiError(null);
    try {
      await commitOp(commitMessage);
      setCommitMessage('');
    } catch (err) {
      console.error('Failed to commit:', err);
      setUiError(err instanceof Error ? err.message : 'Commit failed');
    } finally {
      setIsCommitting(false);
    }
  }, [commitMessage, commitOp]);

  const handleGenerateCommitMessage = useCallback(async () => {
    if (!getDiff || !apiKey) return;
    setIsGenerating(true);
    setGenerateError(null);
    try {
      const diffText = await getDiff({ staged: false });
      if (!diffText || diffText.trim() === '') {
        throw new Error('変更内容がありません。ファイルを変更してからお試しください。');
      }
      const message = await generateCommitMessage(diffText, apiKey);
      setCommitMessage(message);
    } catch (err) {
      console.error('Failed to generate commit message:', err);
      setGenerateError(err instanceof Error ? err.message : 'Gemini APIエラー');
    } finally {
      setIsGenerating(false);
    }
  }, [getDiff, apiKey]);

  // APIキーをlocalStorageから初期化
  useEffect(() => {
    const savedKey = localStorage.getItem(LOCALSTORAGE_KEY.GEMINI_API_KEY) || '';
    setApiKey(savedKey);
  }, []);

  const hasApiKey = !!apiKey;

  // APIキー入力時にlocalStorageへ保存
  const handleApiKeyChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setApiKey(value);
    localStorage.setItem(LOCALSTORAGE_KEY.GEMINI_API_KEY, value);
  }, []);

  // 初期化とプロジェクト変更時の更新
  useEffect(() => {
    if (currentProject) {
      fetchGitStatus();
    }
  }, [currentProject, fetchGitStatus]);

  // Git更新トリガーが変更されたときの更新
  useEffect(() => {
    if (currentProject && gitRefreshTrigger !== undefined && gitRefreshTrigger > 0) {
      const timer = setTimeout(() => {
        fetchGitStatus(commitDepth);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [gitRefreshTrigger, currentProject, fetchGitStatus, commitDepth]);

  // Diffファイルクリックハンドラー（メモ化）
  const handleStagedFileClick = useCallback(
    async (file: string) => {
      if (handleDiffFileClick && gitRepo && gitRepo.commits.length > 0) {
        const latestCommit = gitRepo.commits[0];
        await handleDiffFileClick({
          commitId: latestCommit.hash,
          filePath: file,
          editable: false,
        });
      }
    },
    [handleDiffFileClick, gitRepo]
  );

  const handleUnstagedFileClick = useCallback(
    async (file: string) => {
      if (handleDiffFileClick && gitRepo && gitRepo.commits.length > 0) {
        const latestCommit = gitRepo.commits[0];
        await handleDiffFileClick({
          commitId: latestCommit.hash,
          filePath: file,
          editable: true,
        });
      }
    },
    [handleDiffFileClick, gitRepo]
  );

  // メモ化されたアイコンスタイル
  const iconColors = useMemo(
    () => ({
      mutedBg: colors.mutedBg,
      primary: colors.primary,
      red: colors.red,
    }),
    [colors.mutedBg, colors.primary, colors.red]
  );

  const plusIcon = useMemo(
    () => (
      <Plus
        style={{ width: '0.75rem', height: '0.75rem', color: colors.primary }}
        className="select-none"
      />
    ),
    [colors.primary]
  );

  const minusIcon = useMemo(
    () => (
      <Minus
        style={{ width: '0.75rem', height: '0.75rem', color: colors.primary }}
        className="select-none"
      />
    ),
    [colors.primary]
  );

  const discardIcon = useMemo(
    () => (
      <RotateCcw
        style={{ width: '0.75rem', height: '0.75rem', color: colors.red }}
        className="select-none"
      />
    ),
    [colors.red]
  );

  // hasChanges のメモ化
  const hasChanges = useMemo(() => {
    return (
      (gitRepo?.status?.staged?.length || 0) > 0 ||
      (gitRepo?.status?.unstaged?.length || 0) > 0 ||
      (gitRepo?.status?.untracked?.length || 0) > 0 ||
      (gitRepo?.status?.deleted?.length || 0) > 0
    );
  }, [gitRepo]);

  // hasMore のメモ化
  const hasMore = useMemo(() => {
    return hasRemote && (gitRepo?.commits?.length || 0) >= commitDepth;
  }, [hasRemote, gitRepo, commitDepth]);

  // ブランチフィルタのラベルをメモ化
  const branchFilterLabel = useMemo(() => {
    if (branchFilterMode === 'auto') {
      return t('git.branchFilter.auto') || 'Auto';
    }
    if (selectedBranches.length > 0) {
      return `${selectedBranches.length} ${t('git.branchFilter.selected') || 'selected'}`;
    }
    return t('git.branchFilter.all') || 'All';
  }, [branchFilterMode, selectedBranches, t]);

  // Keep layout stable: show banners inside the panel rather than returning early
  const showProjectMissing = !currentProject;
  const showLoading = isLoading;
  const showError = Boolean(error);
  const showNoRepo = !gitRepo && !showLoading && !showError && !!currentProject;

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: colors.cardBg,
      }}
    >
      {/* ヘッダー */}
      <div style={{ padding: '0.25rem', borderBottom: `1px solid ${colors.border}` }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '0.5rem',
          }}
        >
          <h3
            style={{
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '1rem',
              color: colors.foreground,
            }}
          >
            <GitBranch style={{ width: '1rem', height: '1rem', color: colors.primary }} />
            Git
            <div style={{ fontSize: '0.75rem', color: colors.mutedFg }}>
              <span style={{ fontWeight: 500 }}>{gitRepo?.currentBranch || '-'}</span>
              {(gitRepo?.commits?.length || 0) > 0 && (
                <span style={{ marginLeft: '0.5rem' }}>
                  • {gitRepo?.commits?.length} {t('git.commit')}
                </span>
              )}
            </div>
          </h3>
          <button
            onClick={() => fetchGitStatus(commitDepth)}
            style={{
              padding: '0.25rem',
              background: 'transparent',
              borderRadius: '0.375rem',
              border: 'none',
              cursor: 'pointer',
            }}
            className="select-none"
            title={t('action.refresh')}
            onMouseEnter={e => (e.currentTarget.style.background = colors.mutedBg)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <RefreshCw
              style={{ width: '1rem', height: '1rem', color: colors.mutedFg }}
              className="select-none"
            />
          </button>
        </div>
      </div>
      {/* 状態バナー */}
      {showProjectMissing ? (
        <div style={{ padding: '1rem', textAlign: 'center', color: colors.mutedFg }}>
          <GitBranch
            style={{
              width: '2rem',
              height: '2rem',
              display: 'block',
              margin: '0 auto 0.5rem',
              opacity: 0.5,
              color: colors.mutedFg,
            }}
          />
          <p style={{ fontSize: '0.875rem' }}>{t('git.projectSelect')}</p>
        </div>
      ) : null}

      {!showProjectMissing && showLoading ? (
        <LoadingState message={t('git.loadingStatus')} colors={colors} />
      ) : null}

      {!showProjectMissing && showError ? (
        <ErrorState message={error} onRetry={() => fetchGitStatus(commitDepth)} colors={colors} />
      ) : null}

      {!showProjectMissing && showNoRepo ? (
        <div style={{ padding: '1rem', textAlign: 'center', color: colors.mutedFg }}>
          <GitBranch
            style={{
              width: '2rem',
              height: '2rem',
              display: 'block',
              margin: '0 auto 0.5rem',
              opacity: 0.5,
              color: colors.mutedFg,
            }}
          />
          <p style={{ fontSize: '0.875rem' }}>{t('git.infoNotAvailable')}</p>
        </div>
      ) : null}

      {/* コミット */}
      {(gitRepo?.status?.staged?.length || 0) > 0 && (
        <CommitBox
          gitRepo={gitRepo}
          commitMessage={commitMessage}
          setCommitMessage={setCommitMessage}
          handleGenerateCommitMessage={handleGenerateCommitMessage}
          handleCommit={handleCommit}
          apiKey={apiKey}
          handleApiKeyChange={handleApiKeyChange}
          isGenerating={isGenerating}
          generateError={generateError}
          isCommitting={isCommitting}
          colors={colors}
          t={t}
          hasApiKey={hasApiKey}
          uiError={uiError}
        />
      )}

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <ChangesList
          gitRepo={gitRepo}
          hasChanges={hasChanges}
          iconColors={iconColors}
          plusIcon={plusIcon}
          minusIcon={minusIcon}
          discardIcon={discardIcon}
          handleStageAll={handleStageAll}
          handleUnstageAll={handleUnstageAll}
          handleStageFile={handleStageFile}
          handleUnstageFile={handleUnstageFile}
          // pass the request wrappers that show confirmation dialog
          handleDiscardChanges={handleRequestDiscardChanges}
          handleDiscardAllUnstaged={handleRequestDiscardAllUnstaged}
          handleDiscardAllStaged={handleRequestDiscardAllStaged}
          handleStagedFileClick={handleStagedFileClick}
          handleUnstagedFileClick={handleUnstagedFileClick}
          colors={colors}
        />

        <Confirmation
          open={confirmOpen}
          title={confirmTitle}
          message={confirmMessage}
          confirmText={t('git.discard')}
          cancelText={t('common.cancel')}
          onConfirm={handleConfirm}
          onCancel={handleCancelConfirm}
        />

        {/* コミット履歴 */}
        <div style={{ padding: '0.75rem', borderBottom: `1px solid ${colors.border}` }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <h4
              style={{
                fontSize: '0.875rem',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                color: colors.foreground,
              }}
            >
              <Clock style={{ width: '1rem', height: '1rem', color: colors.mutedFg }} />
              {t('git.history')} ({gitRepo?.commits?.length || 0})
            </h4>
            {/* ブランチフィルタセレクター */}
            <button
              ref={branchButtonRef}
              type="button"
              className="flex items-center gap-1 px-2 py-1 rounded-md hover:opacity-80 transition-all text-xs"
              style={{
                background: colors.mutedBg,
                color: colors.foreground,
                border: `1px solid ${colors.border}`,
                maxWidth: '140px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
              }}
              onClick={() => setShowBranchSelector(prev => !prev)}
              title={t('git.branchFilter.tooltip') || 'Branch filter'}
            >
              <GitBranch style={{ width: '0.75rem', height: '0.75rem', flexShrink: 0 }} />
              <span className="truncate" style={{ maxWidth: '100px', display: 'inline-block' }}>
                {branchFilterLabel}
              </span>
              <ChevronDown style={{ width: '0.75rem', height: '0.75rem', flexShrink: 0 }} />
            </button>
          </div>
        </div>

        {/* ブランチセレクタ OperationWindow */}
        {showBranchSelector && (
          <OperationWindow
            isVisible={showBranchSelector}
            onClose={() => setShowBranchSelector(false)}
            projectFiles={[]}
            items={(() => {
              const items: OperationListItem[] = [];

              // Auto mode option
              items.push({
                id: 'mode-auto',
                label: t('git.branchFilter.autoMode') || 'Auto (HEAD only)',
                description:
                  t('git.branchFilter.autoModeDesc') || 'Show commits from current branch only',
                icon: branchFilterMode === 'auto' ? <Check size={14} /> : undefined,
                isActive: branchFilterMode === 'auto',
                onClick: () => {
                  setBranchFilterModeAndPersist('auto');
                  setSelectedBranchesAndPersist([]);
                  fetchGitStatus(commitDepth, 'auto', []);
                  setShowBranchSelector(false);
                },
              });

              // All branches mode option
              items.push({
                id: 'mode-all',
                label: t('git.branchFilter.allMode') || 'All Branches',
                description: t('git.branchFilter.allModeDesc') || 'Show commits from all branches',
                icon:
                  branchFilterMode === 'all' && selectedBranches.length === 0 ? (
                    <Check size={14} />
                  ) : undefined,
                isActive: branchFilterMode === 'all' && selectedBranches.length === 0,
                onClick: () => {
                  setBranchFilterModeAndPersist('all');
                  setSelectedBranchesAndPersist([]);
                  fetchGitStatus(commitDepth, 'all', []);
                  setShowBranchSelector(false);
                },
              });

              // Separator-like item
              if (availableBranches.local.length > 0 || availableBranches.remote.length > 0) {
                items.push({
                  id: 'separator',
                  label: `── ${t('git.branchFilter.selectBranches') || 'Select Branches'} ──`,
                  description:
                    t('git.branchFilter.selectBranchesDesc') || 'Choose specific branches',
                });
              }

              // Local branches
              for (const branch of availableBranches.local) {
                const isSelected = selectedBranches.includes(branch);
                items.push({
                  id: `local-${branch}`,
                  label: branch,
                  description: t('git.branchFilter.localBranch') || 'Local branch',
                  icon: isSelected ? <Check size={14} /> : <GitBranch size={14} />,
                  isActive: isSelected,
                  onClick: () => {
                    const newSelected = isSelected
                      ? selectedBranches.filter(b => b !== branch)
                      : [...selectedBranches, branch];
                    setSelectedBranchesAndPersist(newSelected);
                    setBranchFilterModeAndPersist('all');
                    fetchGitStatus(commitDepth, 'all', newSelected);
                  },
                });
              }

              // Remote branches
              for (const branch of availableBranches.remote) {
                const isSelected = selectedBranches.includes(branch);
                items.push({
                  id: `remote-${branch}`,
                  label: branch,
                  description: t('git.branchFilter.remoteBranch') || 'Remote branch',
                  icon: isSelected ? <Check size={14} /> : <GitBranch size={14} />,
                  isActive: isSelected,
                  onClick: () => {
                    const newSelected = isSelected
                      ? selectedBranches.filter(b => b !== branch)
                      : [...selectedBranches, branch];
                    setSelectedBranchesAndPersist(newSelected);
                    setBranchFilterModeAndPersist('all');
                    fetchGitStatus(commitDepth, 'all', newSelected);
                  },
                });
              }

              return items;
            })()}
            listTitle={t('git.branchFilter.title') || 'Branch Filter'}
            initialView="list"
          />
        )}

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {(gitRepo?.commits?.length || 0) === 0 ? (
            <div style={{ padding: '0.75rem' }}>
              <p style={{ fontSize: '0.75rem', color: colors.mutedFg }}>{t('git.noHistory')}</p>
            </div>
          ) : (
            <GitHistory
              commits={gitRepo?.commits || []}
              currentProject={currentProject}
              currentProjectId={currentProjectId}
              currentBranch={gitRepo?.currentBranch || ''}
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              onLoadMore={loadMoreCommits}
            />
          )}
        </div>
      </div>
    </div>
  );
}
