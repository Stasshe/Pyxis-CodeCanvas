'use client';

import type { BranchFilterMode } from '@/engine/cmd/global/gitOperations/log';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import type { GitRepository } from '@/types/git';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseGitBranches, parseGitLog, parseGitStatus } from './gitUtils';

export function useGitPanel({
  currentProject,
  currentProjectId,
  onGitStatusChange,
}: {
  currentProject?: string;
  currentProjectId?: string;
  onGitStatusChange?: (changesCount: number) => void;
}) {
  const [gitRepo, setGitRepo] = useState<GitRepository | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasRemote, setHasRemote] = useState(false);

  // ブランチフィルタ関連
  const [branchFilterMode, setBranchFilterMode] = useState<BranchFilterMode>('auto');
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const [availableBranches, setAvailableBranches] = useState<{ local: string[]; remote: string[] }>(
    { local: [], remote: [] }
  );

  // commit history depth
  const [commitDepth, setCommitDepth] = useState(() => 20);

  const gitCommands = useMemo(
    () =>
      currentProject && currentProjectId
        ? terminalCommandRegistry.getGitCommands(currentProject, currentProjectId)
        : null,
    [currentProject, currentProjectId]
  );

  const getStoredCommitDepth = useCallback(() => {
    if (!currentProjectId) return 20;
    const key = `gitCommitDepth_${currentProjectId}`;
    const stored = sessionStorage.getItem(key);
    return stored ? Number.parseInt(stored, 10) : 20;
  }, [currentProjectId]);

  useEffect(() => {
    if (currentProjectId) {
      const stored = getStoredCommitDepth();
      setCommitDepth(stored);
    }
  }, [currentProjectId, getStoredCommitDepth]);

  const fetchGitStatus = useCallback(
    async (depth?: number, filterMode?: BranchFilterMode, filterBranches?: string[]) => {
      if (!gitCommands || !currentProject) return;

      const actualDepth = depth ?? getStoredCommitDepth();
      const actualFilterMode = filterMode ?? branchFilterMode;
      const actualFilterBranches = filterBranches ?? selectedBranches;

      try {
        setIsLoading(true);
        setError(null);

        const [statusResult, branchResult, remotesResult, availableBranchesResult] =
          await Promise.all([
            gitCommands.status(),
            gitCommands.branch(),
            gitCommands.listRemotes(),
            gitCommands.getAvailableBranches(),
          ]);

        setAvailableBranches(availableBranchesResult);

        const branchFilter =
          actualFilterMode === 'all'
            ? {
                mode: 'all' as const,
                branches: actualFilterBranches.length > 0 ? actualFilterBranches : undefined,
              }
            : { mode: 'auto' as const };

        const logResult = await gitCommands.getFormattedLog(actualDepth, branchFilter);

        const commits = parseGitLog(logResult);
        const branches = parseGitBranches(branchResult);
        const status = parseGitStatus(statusResult);

        const hasRemoteRepo =
          remotesResult.trim() !== '' && !remotesResult.startsWith('No remotes');
        setHasRemote(hasRemoteRepo);
        setCommitDepth(actualDepth);

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
        setError(err instanceof Error ? err.message : 'Failed to fetch git status');
        setGitRepo(null);
        if (onGitStatusChange) onGitStatusChange(0);
      } finally {
        setIsLoading(false);
      }
    },
    [
      gitCommands,
      currentProject,
      onGitStatusChange,
      getStoredCommitDepth,
      branchFilterMode,
      selectedBranches,
    ]
  );

  const loadMoreCommits = useCallback(async () => {
    if (!gitCommands || !currentProject || isLoadingMore) return;

    try {
      setIsLoadingMore(true);
      const newDepth = commitDepth + 20;

      const branchFilter =
        branchFilterMode === 'all'
          ? {
              mode: 'all' as const,
              branches: selectedBranches.length > 0 ? selectedBranches : undefined,
            }
          : { mode: 'auto' as const };

      const logResult = await gitCommands.getFormattedLog(newDepth, branchFilter);
      const commits = parseGitLog(logResult);

      setCommitDepth(newDepth);
      setGitRepo(prev => (prev ? { ...prev, commits } : null));
    } catch (err) {
      console.error('Failed to load more commits:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [gitCommands, currentProject, isLoadingMore, commitDepth, branchFilterMode, selectedBranches]);

  // staging operations
  const stageFile = useCallback(
    async (file: string) => {
      if (!gitCommands) return;
      try {
        await gitCommands.add(file);
        await fetchGitStatus(commitDepth);
      } catch (err) {
        console.error(err);
      }
    },
    [gitCommands, fetchGitStatus, commitDepth]
  );

  const unstageFile = useCallback(
    async (file: string) => {
      if (!gitCommands) return;
      try {
        await gitCommands.reset({ filepath: file });
        await fetchGitStatus(commitDepth);
      } catch (err) {
        console.error(err);
      }
    },
    [gitCommands, fetchGitStatus, commitDepth]
  );

  const stageAll = useCallback(async () => {
    if (!gitCommands) return;
    try {
      await gitCommands.add('.');
      await fetchGitStatus(commitDepth);
    } catch (err) {
      console.error(err);
    }
  }, [gitCommands, fetchGitStatus, commitDepth]);

  const unstageAll = useCallback(async () => {
    if (!gitCommands) return;
    const staged = gitRepo?.status.staged || [];
    try {
      await Promise.all(staged.map(f => gitCommands.reset({ filepath: f })));
      await fetchGitStatus(commitDepth);
    } catch (err) {
      console.error(err);
    }
  }, [gitCommands, gitRepo?.status.staged, fetchGitStatus, commitDepth]);

  const discardChanges = useCallback(
    async (file: string) => {
      if (!gitCommands) return;
      try {
        await gitCommands.discardChanges(file);
        await fetchGitStatus(commitDepth);
      } catch (err) {
        console.error(err);
      }
    },
    [gitCommands, fetchGitStatus, commitDepth]
  );

  // discard all unstaged (includes unstaged, deleted and untracked)
  const discardAllUnstaged = useCallback(async () => {
    if (!gitCommands) return;
    const unstaged = [
      ...(gitRepo?.status?.unstaged || []),
      ...(gitRepo?.status?.deleted || []),
      ...(gitRepo?.status?.untracked || []),
    ];
    if (unstaged.length === 0) return;
    try {
      await Promise.all(unstaged.map(f => gitCommands.discardChanges(f)));
      await fetchGitStatus(commitDepth);
    } catch (err) {
      console.error(err);
    }
  }, [gitCommands, gitRepo?.status, fetchGitStatus, commitDepth]);

  // discard all staged: first unstage, then try to discard changes
  const discardAllStaged = useCallback(async () => {
    if (!gitCommands) return;
    const staged = gitRepo?.status?.staged || [];
    if (staged.length === 0) return;
    try {
      await Promise.all(
        staged.map(async f => {
          await gitCommands.reset({ filepath: f });
          try {
            await gitCommands.discardChanges(f);
          } catch (e) {
            // ignore individual discard errors
          }
        })
      );
      await fetchGitStatus(commitDepth);
    } catch (err) {
      console.error(err);
    }
  }, [gitCommands, gitRepo?.status, fetchGitStatus, commitDepth]);

  const commit = useCallback(
    async (message: string) => {
      if (!gitCommands || !message.trim()) return;
      const commitPromise = gitCommands.commit(message.trim());
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Commit timeout after 30 seconds')), 30000)
      );
      await Promise.race([commitPromise, timeoutPromise]);
      await fetchGitStatus(commitDepth);
    },
    [gitCommands, fetchGitStatus, commitDepth]
  );

  const getDiff = useCallback(
    async ({ staged = false } = {}) => {
      if (!gitCommands) return '';
      try {
        return await gitCommands.diff({ staged });
      } catch (err) {
        console.error('Failed to get diff:', err);
        return '';
      }
    },
    [gitCommands]
  );

  // initial load
  useEffect(() => {
    if (currentProject) fetchGitStatus();
  }, [currentProject, fetchGitStatus]);

  return {
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
    // group operations
    discardAllUnstaged,
    discardAllStaged,
    commit,
    getDiff,
  } as const;
}
