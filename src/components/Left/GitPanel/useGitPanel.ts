import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BranchFilterMode } from '@/engine/cmd/global/gitOperations/log';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import type { GitRepository } from '@/types/git';
import { parseGitBranches, parseGitLog, parseGitStatus } from './gitUtils';

export function useGitPanel({
  currentProject,
  rootPath,
  onGitStatusChange,
}: {
  currentProject?: string;
  rootPath?: string;
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

  interface RefreshRequest {
    sequence: number;
    project: string;
    rootPath: string;
    contextGeneration: number;
    commands: NonNullable<ReturnType<typeof terminalCommandRegistry.getGitCommands>>;
    depth: number;
    filterMode: BranchFilterMode;
    filterBranches: string[];
    onStatusChange?: (changesCount: number) => void;
  }

  const refreshQueue = useRef<{
    pending: RefreshRequest | null;
    promise: Promise<void> | null;
    sequence: number;
    latestSequence: number;
  }>({ pending: null, promise: null, sequence: 0, latestSequence: 0 });
  const contextRef = useRef({ currentProject, rootPath, generation: 0 });
  if (
    contextRef.current.currentProject !== currentProject ||
    contextRef.current.rootPath !== rootPath
  ) {
    contextRef.current = {
      currentProject,
      rootPath,
      generation: contextRef.current.generation + 1,
    };
  }
  const mountedRef = useRef(true);
  const filterRef = useRef({ branchFilterMode, selectedBranches });
  filterRef.current = { branchFilterMode, selectedBranches };
  const loadMoreSequence = useRef(0);

  const reportOperationError = useCallback((operation: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[useGitPanel] ${operation} failed:`, error);
    if (mountedRef.current) setError(`${operation}: ${message}`);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshQueue.current.pending = null;
      refreshQueue.current.latestSequence = refreshQueue.current.sequence + 1;
      refreshQueue.current.sequence = refreshQueue.current.latestSequence;
    };
  }, []);

  const gitCommands = useMemo(
    () => (currentProject && rootPath ? terminalCommandRegistry.getGitCommands(rootPath) : null),
    [currentProject, rootPath]
  );

  const getStoredCommitDepth = useCallback(() => {
    if (!rootPath) return 20;
    const key = `gitCommitDepth_${rootPath}`;
    const stored = sessionStorage.getItem(key);
    return stored ? Number.parseInt(stored, 10) : 20;
  }, [rootPath]);

  useEffect(() => {
    if (rootPath) {
      const stored = getStoredCommitDepth();
      setCommitDepth(stored);
    }
    loadMoreSequence.current += 1;
    setIsLoadingMore(false);
  }, [rootPath, getStoredCommitDepth]);

  const fetchGitStatus = useCallback(
    (depth?: number, filterMode?: BranchFilterMode, filterBranches?: string[]) => {
      if (!gitCommands || !currentProject || !rootPath) return Promise.resolve();
      const activeContext = contextRef.current;
      if (
        !mountedRef.current ||
        currentProject !== activeContext.currentProject ||
        rootPath !== activeContext.rootPath
      ) {
        return Promise.resolve();
      }

      const queue = refreshQueue.current;
      const sequence = queue.sequence + 1;
      queue.sequence = sequence;
      queue.latestSequence = sequence;
      queue.pending = {
        sequence,
        project: currentProject,
        rootPath,
        contextGeneration: contextRef.current.generation,
        commands: gitCommands,
        depth: depth ?? getStoredCommitDepth(),
        filterMode: filterMode ?? branchFilterMode,
        filterBranches: filterBranches ?? selectedBranches,
        onStatusChange: onGitStatusChange,
      };

      if (queue.promise) return queue.promise;

      const run = async () => {
        if (mountedRef.current) {
          setIsLoading(true);
          setError(null);
        }

        while (queue.pending) {
          const request = queue.pending;
          queue.pending = null;
          try {
            const [statusResult, branchResult, remotesResult, availableBranchesResult] =
              await Promise.all([
                request.commands.status(),
                request.commands.branch(),
                request.commands.listRemotes(),
                request.commands.getAvailableBranches(),
              ]);

            let branchFilter: { mode: 'all'; branches?: string[] } | { mode: 'auto' } = {
              mode: 'auto',
            };
            if (request.filterMode === 'all') {
              branchFilter = { mode: 'all' };
              if (request.filterBranches.length > 0) {
                branchFilter.branches = request.filterBranches;
              }
            }
            const logResult = await request.commands.getFormattedLog(request.depth, branchFilter);
            const activeProject = contextRef.current;
            if (
              request.sequence !== queue.latestSequence ||
              request.project !== activeProject.currentProject ||
              request.rootPath !== activeProject.rootPath ||
              request.contextGeneration !== activeProject.generation ||
              !mountedRef.current
            ) {
              continue;
            }

            const status = parseGitStatus(statusResult);
            setAvailableBranches(availableBranchesResult);
            setHasRemote(remotesResult.trim() !== '' && !remotesResult.startsWith('No remotes'));
            setCommitDepth(request.depth);
            setGitRepo({
              initialized: true,
              branches: parseGitBranches(branchResult),
              commits: parseGitLog(logResult),
              status,
              currentBranch: status.branch,
            });

            if (request.onStatusChange) {
              const changesCount =
                status.staged.length +
                status.unstaged.length +
                status.untracked.length +
                status.deleted.length;
              request.onStatusChange(changesCount);
            }
          } catch (err) {
            const activeProject = contextRef.current;
            if (
              request.sequence !== queue.latestSequence ||
              request.project !== activeProject.currentProject ||
              request.rootPath !== activeProject.rootPath ||
              request.contextGeneration !== activeProject.generation ||
              !mountedRef.current
            ) {
              continue;
            }
            console.error('[useGitPanel] Failed to fetch git status:', err);
            setError(err instanceof Error ? err.message : 'Failed to fetch git status');
            setGitRepo(null);
            request.onStatusChange?.(0);
          }
        }

        if (mountedRef.current) setIsLoading(false);
        queue.promise = null;
      };

      queue.promise = run();
      return queue.promise;
    },
    [
      gitCommands,
      currentProject,
      rootPath,
      getStoredCommitDepth,
      branchFilterMode,
      selectedBranches,
      onGitStatusChange,
    ]
  );

  const loadMoreCommits = useCallback(async () => {
    if (!gitCommands || !currentProject || isLoadingMore) return;

    const contextGeneration = contextRef.current.generation;
    const sequence = loadMoreSequence.current + 1;
    loadMoreSequence.current = sequence;
    const selectedBranchSnapshot = [...selectedBranches];
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
      const activeContext = contextRef.current;
      const activeFilter = filterRef.current;
      if (
        !mountedRef.current ||
        contextGeneration !== activeContext.generation ||
        sequence !== loadMoreSequence.current ||
        branchFilterMode !== activeFilter.branchFilterMode ||
        selectedBranchSnapshot.length !== activeFilter.selectedBranches.length ||
        selectedBranchSnapshot.some(
          (branch, index) => branch !== activeFilter.selectedBranches[index]
        )
      ) {
        return;
      }
      const commits = parseGitLog(logResult);

      setCommitDepth(newDepth);
      setGitRepo(prev => (prev ? { ...prev, commits } : null));
    } catch (err) {
      if (contextGeneration === contextRef.current.generation && mountedRef.current) {
        reportOperationError('Load more commits', err);
      }
    } finally {
      if (sequence === loadMoreSequence.current && mountedRef.current) setIsLoadingMore(false);
    }
  }, [
    gitCommands,
    currentProject,
    isLoadingMore,
    commitDepth,
    branchFilterMode,
    selectedBranches,
    reportOperationError,
  ]);

  // staging operations
  const stageFile = useCallback(
    async (file: string) => {
      if (!gitCommands) return;
      try {
        await gitCommands.add(file);
      } catch (err) {
        reportOperationError(`Stage ${file}`, err);
      }
    },
    [gitCommands, reportOperationError]
  );

  const unstageFile = useCallback(
    async (file: string) => {
      if (!gitCommands) return;
      try {
        await gitCommands.reset({ filepath: file });
      } catch (err) {
        reportOperationError(`Unstage ${file}`, err);
      }
    },
    [gitCommands, reportOperationError]
  );

  const stageAll = useCallback(async () => {
    if (!gitCommands) return;
    try {
      await gitCommands.add('.');
    } catch (err) {
      reportOperationError('Stage all changes', err);
    }
  }, [gitCommands, reportOperationError]);

  const unstageAll = useCallback(async () => {
    if (!gitCommands) return;
    const staged = gitRepo?.status.staged || [];
    try {
      await Promise.all(staged.map(f => gitCommands.reset({ filepath: f })));
    } catch (err) {
      reportOperationError('Unstage all changes', err);
    }
  }, [gitCommands, gitRepo?.status.staged, reportOperationError]);

  const discardChanges = useCallback(
    async (file: string) => {
      if (!gitCommands) return;
      try {
        await gitCommands.discardChanges(file);
      } catch (err) {
        reportOperationError(`Discard ${file}`, err);
      }
    },
    [gitCommands, reportOperationError]
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
    } catch (err) {
      reportOperationError('Discard all unstaged changes', err);
    }
  }, [gitCommands, gitRepo?.status, reportOperationError]);

  // discard all staged: first unstage, then try to discard changes
  const discardAllStaged = useCallback(async () => {
    if (!gitCommands) return;
    const staged = gitRepo?.status?.staged || [];
    if (staged.length === 0) return;
    try {
      const results = await Promise.allSettled(
        staged.map(async f => {
          await gitCommands.reset({ filepath: f });
          await gitCommands.discardChanges(f);
        })
      );
      const failures = results.flatMap((result, index) =>
        result.status === 'rejected' ? [`${staged[index]}: ${String(result.reason)}`] : []
      );
      if (failures.length > 0) {
        reportOperationError('Discard all staged changes', new Error(failures.join('; ')));
      }
    } catch (err) {
      reportOperationError('Discard all staged changes', err);
    }
  }, [gitCommands, gitRepo?.status, reportOperationError]);

  const commit = useCallback(
    async (message: string) => {
      if (!gitCommands || !message.trim()) return;
      await gitCommands.commit(message.trim());
    },
    [gitCommands]
  );

  const getDiff = useCallback(
    async ({ staged = false } = {}) => {
      if (!gitCommands) return '';
      const requestGeneration = contextRef.current.generation;
      try {
        const diff = await gitCommands.diff({ staged });
        if (
          !mountedRef.current ||
          requestGeneration !== contextRef.current.generation ||
          currentProject !== contextRef.current.currentProject ||
          rootPath !== contextRef.current.rootPath
        ) {
          return '';
        }
        return diff;
      } catch (err) {
        reportOperationError('Load diff', err);
        return '';
      }
    },
    [gitCommands, currentProject, rootPath, reportOperationError]
  );

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
