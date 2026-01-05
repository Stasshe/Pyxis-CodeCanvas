'use client';

import { Clock, GitBranch, GitCommit, Minus, Plus, RefreshCw, RotateCcw, X } from 'lucide-react';
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';

import GitHistory from './GitHistory';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { LOCALSTORAGE_KEY } from '@/context/config';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { generateCommitMessage } from '@/engine/commitMsgAI';
import { useDiffTabHandlers } from '@/hooks/useDiffTabHandlers';
import type { GitCommit as GitCommitType, GitRepository, GitStatus } from '@/types/git';

interface GitPanelProps {
  currentProject?: string;
  currentProjectId?: string;
  onRefresh?: () => void;
  gitRefreshTrigger?: number;
  onGitStatusChange?: (changesCount: number) => void;
}

// ========================================
// パース関数をコンポーネント外に定義（メモ化不要・再生成されない）
// ========================================

// Git logをパースしてコミット配列に変換（ブランチ情報付き）
function parseGitLog(logOutput: string): GitCommitType[] {
  if (!logOutput.trim()) {
    return [];
  }

  const lines = logOutput.split('\n').filter(line => line.trim());
  const commits: GitCommitType[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split('|');

    // 7つのパーツがあることを確認（refs + tree情報を含む）
    if (parts.length === 7) {
      const hash = parts[0]?.trim();
      const message = parts[1]?.trim();
      const author = parts[2]?.trim();
      const date = parts[3]?.trim();
      const parentHashesStr = parts[4]?.trim();
      const refsStr = parts[5]?.trim();
      const treeSha = parts[6]?.trim();

      if (hash && hash.length >= 7 && message && author && date) {
        try {
          const timestamp = new Date(date).getTime();
          if (!Number.isNaN(timestamp)) {
            const parentHashes =
              parentHashesStr && parentHashesStr !== ''
                ? parentHashesStr.split(',').filter(h => h.trim() !== '')
                : [];

            const refs =
              refsStr && refsStr !== '' ? refsStr.split(',').filter(r => r.trim() !== '') : [];

            commits.push({
              hash,
              shortHash: hash.substring(0, 7),
              message: message.replace(/｜/g, '|'),
              author: author.replace(/｜/g, '|'),
              date,
              timestamp,
              isMerge: parentHashes.length > 1,
              parentHashes,
              refs,
              tree: treeSha || undefined,
            });
          }
        } catch {
          // Date parsing error, skip this commit
        }
      }
    } else if (parts.length === 6) {
      const hash = parts[0]?.trim();
      const message = parts[1]?.trim();
      const author = parts[2]?.trim();
      const date = parts[3]?.trim();
      const parentHashesStr = parts[4]?.trim();
      const refsStr = parts[5]?.trim();

      if (hash && hash.length >= 7 && message && author && date) {
        try {
          const timestamp = new Date(date).getTime();
          if (!Number.isNaN(timestamp)) {
            const parentHashes =
              parentHashesStr && parentHashesStr !== ''
                ? parentHashesStr.split(',').filter(h => h.trim() !== '')
                : [];

            const refs =
              refsStr && refsStr !== '' ? refsStr.split(',').filter(r => r.trim() !== '') : [];

            commits.push({
              hash,
              shortHash: hash.substring(0, 7),
              message: message.replace(/｜/g, '|'),
              author: author.replace(/｜/g, '|'),
              date,
              timestamp,
              isMerge: parentHashes.length > 1,
              parentHashes,
              refs,
              tree: undefined,
            });
          }
        } catch {
          // Date parsing error, skip this commit
        }
      }
    } else if (parts.length === 5) {
      const hash = parts[0]?.trim();
      const message = parts[1]?.trim();
      const author = parts[2]?.trim();
      const date = parts[3]?.trim();
      const parentHashesStr = parts[4]?.trim();

      if (hash && hash.length >= 7 && message && author && date) {
        try {
          const timestamp = new Date(date).getTime();
          if (!Number.isNaN(timestamp)) {
            const parentHashes =
              parentHashesStr && parentHashesStr !== ''
                ? parentHashesStr.split(',').filter(h => h.trim() !== '')
                : [];

            commits.push({
              hash,
              shortHash: hash.substring(0, 7),
              message: message.replace(/｜/g, '|'),
              author: author.replace(/｜/g, '|'),
              date,
              timestamp,
              isMerge: parentHashes.length > 1,
              parentHashes,
              refs: [],
            });
          }
        } catch {
          // Date parsing error, skip this commit
        }
      }
    }
  }

  return commits.sort((a, b) => b.timestamp - a.timestamp);
}

// Git branchをパース
function parseGitBranches(branchOutput: string) {
  return branchOutput
    .split('\n')
    .filter(line => line.trim())
    .map(line => ({
      name: line.replace(/^\*\s*/, '').trim(),
      isCurrent: line.startsWith('*'),
      isRemote: line.includes('remotes/'),
      lastCommit: undefined,
    }));
}

// Git statusをパース
function parseGitStatus(statusOutput: string): GitStatus {
  const lines = statusOutput.split('\n');
  const status: GitStatus = {
    staged: [],
    unstaged: [],
    untracked: [],
    deleted: [],
    branch: 'main',
    ahead: 0,
    behind: 0,
  };

  let inChangesToBeCommitted = false;
  let inChangesNotStaged = false;
  let inUntrackedFiles = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.includes('On branch')) {
      status.branch = trimmed.replace('On branch ', '').trim();
    } else if (trimmed === 'Changes to be committed:') {
      inChangesToBeCommitted = true;
      inChangesNotStaged = false;
      inUntrackedFiles = false;
    } else if (trimmed === 'Changes not staged for commit:') {
      inChangesToBeCommitted = false;
      inChangesNotStaged = true;
      inUntrackedFiles = false;
    } else if (trimmed === 'Untracked files:') {
      inChangesToBeCommitted = false;
      inChangesNotStaged = false;
      inUntrackedFiles = true;
    } else if (
      trimmed.startsWith('modified:') ||
      trimmed.startsWith('new file:') ||
      trimmed.startsWith('deleted:')
    ) {
      const fileName = trimmed.split(':')[1]?.trim();
      if (fileName) {
        if (inChangesToBeCommitted) {
          status.staged.push(fileName);
        } else if (inChangesNotStaged) {
          if (trimmed.startsWith('deleted:')) {
            status.deleted.push(fileName);
          } else {
            status.unstaged.push(fileName);
          }
        }
      }
    } else if (
      inUntrackedFiles &&
      trimmed &&
      !trimmed.startsWith('(') &&
      !trimmed.includes('git add') &&
      !trimmed.includes('use "git add"') &&
      !trimmed.includes('to include')
    ) {
      if (!trimmed.endsWith('/')) {
        status.untracked.push(trimmed);
      }
    }
  }

  return status;
}

// ========================================
// メモ化されたファイルアイテムコンポーネント
// ========================================

interface FileItemProps {
  file: string;
  color: string;
  onPrimaryAction: (file: string) => void;
  onSecondaryAction?: (file: string) => void;
  onFileClick?: (file: string) => void;
  primaryIcon: React.ReactNode;
  secondaryIcon?: React.ReactNode;
  primaryTitle: string;
  secondaryTitle?: string;
  fileClickTitle?: string;
  colors: {
    mutedBg: string;
    primary: string;
    red: string;
  };
}

const FileItem = memo(function FileItem({
  file,
  color,
  onPrimaryAction,
  onSecondaryAction,
  onFileClick,
  primaryIcon,
  secondaryIcon,
  primaryTitle,
  secondaryTitle,
  fileClickTitle,
  colors,
}: FileItemProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '0.75rem',
        padding: '0.25rem 0',
      }}
    >
      <span
        style={{
          color,
          flex: 1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          cursor: onFileClick ? 'pointer' : 'default',
          textDecoration: onFileClick ? 'underline' : 'none',
        }}
        className="select-text"
        title={fileClickTitle}
        onClick={onFileClick ? () => onFileClick(file) : undefined}
      >
        {file}
      </span>
      <div style={{ display: 'flex', gap: '0.25rem' }}>
        <button
          onClick={() => onPrimaryAction(file)}
          style={{
            padding: '0.25rem',
            background: 'transparent',
            borderRadius: '0.375rem',
            border: 'none',
            cursor: 'pointer',
          }}
          title={primaryTitle}
          className="select-none"
          onMouseEnter={e => (e.currentTarget.style.background = colors.mutedBg)}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          {primaryIcon}
        </button>
        {onSecondaryAction && secondaryIcon && (
          <button
            onClick={() => onSecondaryAction(file)}
            style={{
              padding: '0.25rem',
              background: 'transparent',
              borderRadius: '0.375rem',
              border: 'none',
              cursor: 'pointer',
            }}
            title={secondaryTitle}
            className="select-none"
            onMouseEnter={e => (e.currentTarget.style.background = colors.mutedBg)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {secondaryIcon}
          </button>
        )}
      </div>
    </div>
  );
});

// ========================================
// メインコンポーネント
// ========================================

export default function GitPanel({
  currentProject,
  currentProjectId,
  onRefresh,
  gitRefreshTrigger,
  onGitStatusChange,
}: GitPanelProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [gitRepo, setGitRepo] = useState<GitRepository | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [commitDepth, setCommitDepth] = useState(20);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasRemote, setHasRemote] = useState(false);

  const { handleDiffFileClick } = useDiffTabHandlers({
    name: currentProject,
    id: currentProjectId,
  });

  const gitCommands = useMemo(
    () =>
      currentProject && currentProjectId
        ? terminalCommandRegistry.getGitCommands(currentProject, currentProjectId)
        : null,
    [currentProject, currentProjectId]
  );

  // Git状態を取得
  const fetchGitStatus = useCallback(
    async (depth = 20) => {
      if (!gitCommands || !currentProject) return;

      try {
        setIsLoading(true);
        setError(null);

        const [statusResult, logResult, branchResult, remotesResult] = await Promise.all([
          gitCommands.status(),
          gitCommands.getFormattedLog(depth),
          gitCommands.branch(),
          gitCommands.listRemotes(),
        ]);

        const commits = parseGitLog(logResult);
        const branches = parseGitBranches(branchResult);
        const status = parseGitStatus(statusResult);

        const hasRemoteRepo = remotesResult.trim() !== '' && !remotesResult.includes('No remotes');
        setHasRemote(hasRemoteRepo);
        setCommitDepth(depth);

        setGitRepo({
          initialized: true,
          branches,
          commits,
          status,
          currentBranch: status.branch,
        });

        if (onGitStatusChange) {
          const changesCount =
            status.staged.length +
            status.unstaged.length +
            status.untracked.length +
            status.deleted.length;
          onGitStatusChange(changesCount);
        }
      } catch (err) {
        console.error('Failed to fetch git status:', err);
        setError(err instanceof Error ? err.message : t('git.operationError'));
        setGitRepo(null);
        if (onGitStatusChange) {
          onGitStatusChange(0);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [gitCommands, currentProject, onGitStatusChange, t]
  );

  // 履歴をさらに読み込む
  const loadMoreCommits = useCallback(async () => {
    if (!gitCommands || !currentProject || isLoadingMore) return;

    try {
      setIsLoadingMore(true);
      const newDepth = commitDepth + 20;
      const logResult = await gitCommands.getFormattedLog(newDepth);
      const commits = parseGitLog(logResult);

      setCommitDepth(newDepth);
      setGitRepo(prev =>
        prev
          ? {
              ...prev,
              commits,
            }
          : null
      );
    } catch (err) {
      console.error('Failed to load more commits:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [gitCommands, currentProject, isLoadingMore, commitDepth]);

  // ファイルをステージング
  const handleStageFile = useCallback(
    async (file: string) => {
      if (!gitCommands) return;

      try {
        await gitCommands.add(file);
        await fetchGitStatus(commitDepth);
      } catch (err) {
        console.error('Failed to stage file:', err);
      }
    },
    [gitCommands, fetchGitStatus, commitDepth]
  );

  // ファイルをアンステージング
  const handleUnstageFile = useCallback(
    async (file: string) => {
      if (!gitCommands) return;

      try {
        await gitCommands.reset({ filepath: file });
        await fetchGitStatus(commitDepth);
      } catch (err) {
        console.error('Failed to unstage file:', err);
      }
    },
    [gitCommands, fetchGitStatus, commitDepth]
  );

  // 全ファイルをステージング
  const handleStageAll = useCallback(async () => {
    if (!gitCommands) return;

    try {
      await gitCommands.add('.');
      await fetchGitStatus(commitDepth);
    } catch (err) {
      console.error('Failed to stage all files:', err);
    }
  }, [gitCommands, fetchGitStatus, commitDepth]);

  // 全ファイルをアンステージング
  const handleUnstageAll = useCallback(async () => {
    if (!gitCommands) return;
    const stagedFiles = gitRepo?.status.staged || [];

    try {
      await Promise.all(stagedFiles.map(file => gitCommands.reset({ filepath: file })));
      await fetchGitStatus(commitDepth);
    } catch (err) {
      console.error('Failed to unstage all files:', err);
    }
  }, [gitCommands, gitRepo?.status.staged, fetchGitStatus, commitDepth]);

  // ファイルの変更を破棄
  const handleDiscardChanges = useCallback(
    async (file: string) => {
      if (!gitCommands) return;

      try {
        await gitCommands.discardChanges(file);
        await fetchGitStatus(commitDepth);

        if (onRefresh) {
          onRefresh();
        }
      } catch (err) {
        console.error('Failed to discard changes:', err);
      }
    },
    [gitCommands, fetchGitStatus, commitDepth, onRefresh]
  );

  // コミット実行
  const handleCommit = useCallback(async () => {
    if (!gitCommands || !commitMessage.trim()) return;

    try {
      setIsCommitting(true);
      setError(null);

      const commitPromise = gitCommands.commit(commitMessage.trim());
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Commit timeout after 30 seconds')), 30000)
      );

      await Promise.race([commitPromise, timeoutPromise]);

      setCommitMessage('');
      await fetchGitStatus(commitDepth);
    } catch (err) {
      console.error('Failed to commit:', err);
      setError(err instanceof Error ? err.message : 'コミットに失敗しました');
    } finally {
      setIsCommitting(false);
    }
  }, [gitCommands, commitMessage, fetchGitStatus, commitDepth]);

  // コミットメッセージ自動生成
  const handleGenerateCommitMessage = useCallback(async () => {
    if (!gitCommands || !apiKey) return;
    setIsGenerating(true);
    setGenerateError(null);
    try {
      const diffText = await gitCommands.diff({ staged: false });

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
  }, [gitCommands, apiKey]);

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
      <Plus style={{ width: '0.75rem', height: '0.75rem', color: colors.primary }} className="select-none" />
    ),
    [colors.primary]
  );

  const minusIcon = useMemo(
    () => (
      <Minus style={{ width: '0.75rem', height: '0.75rem', color: colors.primary }} className="select-none" />
    ),
    [colors.primary]
  );

  const discardIcon = useMemo(
    () => (
      <RotateCcw style={{ width: '0.75rem', height: '0.75rem', color: colors.red }} className="select-none" />
    ),
    [colors.red]
  );

  // hasChanges のメモ化
  const hasChanges = useMemo(() => {
    if (!gitRepo) return false;
    return (
      gitRepo.status.staged.length > 0 ||
      gitRepo.status.unstaged.length > 0 ||
      gitRepo.status.untracked.length > 0 ||
      gitRepo.status.deleted.length > 0
    );
  }, [gitRepo]);

  // hasMore のメモ化
  const hasMore = useMemo(() => {
    if (!gitRepo) return false;
    return hasRemote && gitRepo.commits.length >= commitDepth;
  }, [hasRemote, gitRepo, commitDepth]);

  if (!currentProject) {
    return (
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
    );
  }

  if (isLoading) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center', color: colors.mutedFg }}>
        <RefreshCw
          style={{
            width: '1.5rem',
            height: '1.5rem',
            display: 'block',
            margin: '0 auto 0.5rem',
            animation: 'spin 1s linear infinite',
            color: colors.mutedFg,
          }}
        />
        <p style={{ fontSize: '0.875rem' }}>{t('git.loadingStatus')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center', color: colors.red }}>
        <X
          style={{
            width: '2rem',
            height: '2rem',
            display: 'block',
            margin: '0 auto 0.5rem',
            color: colors.red,
          }}
        />
        <p style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>{t('git.errorOccurred')}</p>
        <p style={{ fontSize: '0.75rem', color: colors.mutedFg }}>{error}</p>
        <button
          onClick={() => fetchGitStatus(commitDepth)}
          style={{
            marginTop: '0.5rem',
            padding: '0.5rem 1rem',
            fontSize: '0.75rem',
            background: colors.mutedBg,
            color: colors.foreground,
            borderRadius: '0.375rem',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {t('action.retry')}
        </button>
        <p style={{ fontSize: '0.75rem', marginTop: '0.75rem', color: colors.mutedFg }}>
          This error is might be due to the Github pages error, so use following page instead of
          here.{' '}
          <a
            href="https://pyxis-codecanvas.onrender.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: colors.primary, textDecoration: 'underline' }}
          >
            Pyxis CodeCanvas (render ver)
          </a>
        </p>
      </div>
    );
  }

  if (!gitRepo) {
    return (
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
    );
  }

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
              <span style={{ fontWeight: 500 }}>{gitRepo.currentBranch}</span>
              {gitRepo.commits.length > 0 && (
                <span style={{ marginLeft: '0.5rem' }}>
                  • {gitRepo.commits.length} {t('git.commit')}
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
      {/* コミット */}
      {gitRepo.status.staged.length > 0 && (
        <div style={{ padding: '0.3rem', borderBottom: `1px solid ${colors.border}` }}>
          {!hasApiKey && (
            <input
              type="text"
              value={apiKey}
              onChange={handleApiKeyChange}
              placeholder={t('git.apiKeyPlaceholder')}
              style={{
                width: '100%',
                marginBottom: '0.5rem',
                fontSize: '0.75rem',
                border: `1px solid ${colors.border}`,
                borderRadius: '0.375rem',
                padding: '0.25rem 0.5rem',
                background: colors.background,
                color: colors.foreground,
              }}
            />
          )}
          <textarea
            value={commitMessage}
            onChange={e => setCommitMessage(e.target.value)}
            placeholder={t('git.commitMessagePlaceholder')}
            style={{
              width: '100%',
              height: '4rem',
              fontSize: '0.75rem',
              border: `1px solid ${colors.border}`,
              borderRadius: '0.375rem',
              padding: '0.25rem 0.5rem',
              resize: 'none',
              background: colors.background,
              color: colors.foreground,
            }}
            className="select-text"
          />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button
              onClick={handleGenerateCommitMessage}
              disabled={!apiKey || isGenerating}
              style={{
                flex: 1,
                background: '#22c55e',
                color: 'white',
                borderRadius: '0.375rem',
                padding: '0.5rem 1rem',
                fontSize: '0.75rem',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                border: 'none',
                cursor: isGenerating || !apiKey ? 'not-allowed' : 'pointer',
                opacity: isGenerating || !apiKey ? 0.5 : 1,
              }}
              className="select-none"
            >
              {isGenerating ? (
                <RefreshCw
                  style={{
                    width: '0.75rem',
                    height: '0.75rem',
                    animation: 'spin 1s linear infinite',
                  }}
                  className="select-none"
                />
              ) : (
                <Plus style={{ width: '0.75rem', height: '0.75rem' }} className="select-none" />
              )}
              {isGenerating ? t('git.generating') : t('git.generateCommitMessage')}
            </button>
            <button
              onClick={handleCommit}
              disabled={!commitMessage.trim() || isCommitting}
              style={{
                flex: 1,
                background: colors.primary,
                color: colors.background,
                borderRadius: '0.375rem',
                padding: '0.5rem 1rem',
                fontSize: '0.75rem',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                border: 'none',
                cursor: isCommitting || !commitMessage.trim() ? 'not-allowed' : 'pointer',
                opacity: isCommitting || !commitMessage.trim() ? 0.5 : 1,
              }}
              className="select-none"
            >
              {isCommitting ? (
                <RefreshCw
                  style={{
                    width: '0.75rem',
                    height: '0.75rem',
                    animation: 'spin 1s linear infinite',
                  }}
                  className="select-none"
                />
              ) : (
                <GitCommit
                  style={{ width: '0.75rem', height: '0.75rem' }}
                  className="select-none"
                />
              )}
              {isCommitting ? t('git.committing') : t('git.commit')}
            </button>
          </div>
          {generateError && (
            <div
              style={{
                marginTop: '0.5rem',
                padding: '0.5rem',
                background: `${colors.red}20`,
                border: `1px solid ${colors.red}`,
                borderRadius: '0.375rem',
                fontSize: '0.75rem',
                color: colors.red,
              }}
            >
              {generateError}
            </div>
          )}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* 変更ファイル */}
        <div
          style={{
            padding: '0.75rem',
            borderBottom: `1px solid ${colors.border}`,
            maxHeight: '45%',
            overflowY: 'auto',
            minHeight: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '0.5rem',
            }}
          >
            <h4 style={{ fontSize: '0.875rem', fontWeight: 500, color: colors.foreground }}>
              {t('git.changes')}
            </h4>
            {hasChanges && (
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                <button
                  onClick={handleStageAll}
                  style={{
                    padding: '0.25rem',
                    background: 'transparent',
                    borderRadius: '0.375rem',
                    border: 'none',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                  title={t('git.stageAll')}
                  className="select-none"
                  onMouseEnter={e => (e.currentTarget.style.background = colors.mutedBg)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {plusIcon}
                </button>
                <button
                  onClick={handleUnstageAll}
                  style={{
                    padding: '0.25rem',
                    background: 'transparent',
                    borderRadius: '0.375rem',
                    border: 'none',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                  title={t('git.unstageAll')}
                  className="select-none"
                  onMouseEnter={e => (e.currentTarget.style.background = colors.mutedBg)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {minusIcon}
                </button>
              </div>
            )}
          </div>

          {!hasChanges ? (
            <p style={{ fontSize: '0.75rem', color: colors.mutedFg }}>{t('git.noChanges')}</p>
          ) : (
            <div>
              {/* ステージされたファイル */}
              {gitRepo.status.staged.length > 0 && (
                <div>
                  <p style={{ fontSize: '0.75rem', color: '#22c55e', marginBottom: '0.25rem' }}>
                    {t('git.staged')} ({gitRepo.status.staged.length})
                  </p>
                  {gitRepo.status.staged.map(file => (
                    <FileItem
                      key={`staged-${file}`}
                      file={file}
                      color="#22c55e"
                      onPrimaryAction={handleUnstageFile}
                      onFileClick={handleStagedFileClick}
                      primaryIcon={minusIcon}
                      primaryTitle={t('git.unstage')}
                      fileClickTitle={t('git.viewDiffReadonly')}
                      colors={iconColors}
                    />
                  ))}
                </div>
              )}

              {/* 変更されたファイル */}
              {gitRepo.status.unstaged.length > 0 && (
                <div>
                  <p style={{ fontSize: '0.75rem', color: '#f59e42', marginBottom: '0.25rem' }}>
                    {t('git.unstaged')} ({gitRepo.status.unstaged.length})
                  </p>
                  {gitRepo.status.unstaged.map(file => (
                    <FileItem
                      key={`unstaged-${file}`}
                      file={file}
                      color="#f59e42"
                      onPrimaryAction={handleStageFile}
                      onSecondaryAction={handleDiscardChanges}
                      onFileClick={handleUnstagedFileClick}
                      primaryIcon={plusIcon}
                      secondaryIcon={discardIcon}
                      primaryTitle={t('git.stage')}
                      secondaryTitle={t('git.discard')}
                      fileClickTitle={t('git.viewDiffEditable')}
                      colors={iconColors}
                    />
                  ))}
                </div>
              )}

              {/* 削除されたファイル */}
              {gitRepo.status.deleted.length > 0 && (
                <div>
                  <p style={{ fontSize: '0.75rem', color: colors.red, marginBottom: '0.25rem' }}>
                    {t('git.deleted')} ({gitRepo.status.deleted.length})
                  </p>
                  {gitRepo.status.deleted.map(file => (
                    <FileItem
                      key={`deleted-${file}`}
                      file={file}
                      color={colors.red}
                      onPrimaryAction={handleStageFile}
                      onSecondaryAction={handleDiscardChanges}
                      onFileClick={handleUnstagedFileClick}
                      primaryIcon={plusIcon}
                      secondaryIcon={discardIcon}
                      primaryTitle={t('git.stageDelete')}
                      secondaryTitle={t('git.restore')}
                      fileClickTitle={t('git.viewDiffEditable')}
                      colors={iconColors}
                    />
                  ))}
                </div>
              )}

              {/* 未追跡ファイル */}
              {gitRepo.status.untracked.length > 0 && (
                <div>
                  <p
                    style={{ fontSize: '0.75rem', color: colors.primary, marginBottom: '0.25rem' }}
                  >
                    {t('git.untracked')} ({gitRepo.status.untracked.length})
                  </p>
                  {gitRepo.status.untracked.map(file => (
                    <FileItem
                      key={`untracked-${file}`}
                      file={file}
                      color={colors.primary}
                      onPrimaryAction={handleStageFile}
                      onSecondaryAction={handleDiscardChanges}
                      primaryIcon={plusIcon}
                      secondaryIcon={discardIcon}
                      primaryTitle={t('git.stage')}
                      secondaryTitle={t('git.deleteUntracked')}
                      colors={iconColors}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* コミット履歴 */}
        <div style={{ padding: '0.75rem', borderBottom: `1px solid ${colors.border}` }}>
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
            {t('git.history')} ({gitRepo.commits.length})
          </h4>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {gitRepo.commits.length === 0 ? (
            <div style={{ padding: '0.75rem' }}>
              <p style={{ fontSize: '0.75rem', color: colors.mutedFg }}>{t('git.noHistory')}</p>
            </div>
          ) : (
            <GitHistory
              commits={gitRepo.commits}
              currentProject={currentProject}
              currentProjectId={currentProjectId}
              currentBranch={gitRepo.currentBranch}
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
