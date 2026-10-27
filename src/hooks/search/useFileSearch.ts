import { useEffect, useMemo, useRef, useState } from 'react';
import { flattenFileItems } from '@/components/operation-window/itemRendering';
import { type GitIgnoreRule, parseGitignore } from '@/engine/core/fs/gitignore';
import { fsClient, resolvePath } from '@/engine/core/fs/index';
import { getRecentFilePaths } from '@/engine/core/metadata/recentFileHistoryAdapter';
import { createWorkerPool, type WorkerPool } from '@/engine/system/runtime/transpiler/WorkerPool';
import { useSettings } from '@/hooks/settings/useSettings';
import { useProjectSnapshot } from '@/stores/projectStore';
import type { FileItem } from '@/types/index';
import { DEFAULT_PYXIS_SETTINGS } from '@/types/settings';
import {
  isQuickOpenPathExcluded,
  normalizeWorkspacePath,
} from '../../engine/ide/search/fileSearch';
import type { OperationWorkerApi } from '../../engine/ide/search/operationWorker';

interface FileSearchResult {
  files: FileItem[];
  error: string | null;
}

interface RootValue<T> {
  rootPath: string | null;
  value: T;
}

const EMPTY_GITIGNORE_RULES: GitIgnoreRule[] = [];

export function useFileSearch(
  projectFiles: FileItem[],
  queryTokens: string[],
  enabled: boolean
): FileSearchResult {
  const { currentRootPath } = useProjectSnapshot();
  const rootPath = currentRootPath;
  const { settings } = useSettings(rootPath ?? undefined);
  const activeSettings = settings ?? DEFAULT_PYXIS_SETTINGS;
  const [files, setFiles] = useState<FileItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [gitignore, setGitignore] = useState<RootValue<GitIgnoreRule[]>>({
    rootPath: null,
    value: [],
  });
  const [recentPaths, setRecentPaths] = useState<RootValue<string[]>>({
    rootPath: null,
    value: [],
  });
  const workerPoolRef = useRef<WorkerPool<OperationWorkerApi> | null>(null);
  const indexUpdateRef = useRef<Promise<void>>(Promise.resolve());
  const requestId = useRef(0);
  const flattenedFiles = useMemo(() => flattenFileItems(projectFiles), [projectFiles]);

  useEffect(() => {
    if (!rootPath || !activeSettings.search.useIgnoreFiles) {
      setGitignore({ rootPath, value: [] });
      return;
    }

    let active = true;
    void (async () => {
      try {
        await fsClient.init();
        const content = await fsClient.readText(resolvePath(rootPath, '.gitignore'));
        if (active) setGitignore({ rootPath, value: parseGitignore(content) });
      } catch {
        if (active) setGitignore({ rootPath, value: [] });
      }
    })();
    return () => {
      active = false;
    };
  }, [rootPath, activeSettings.search.useIgnoreFiles]);

  useEffect(() => {
    if (!rootPath) {
      setRecentPaths({ rootPath, value: [] });
      return;
    }
    let active = true;
    void getRecentFilePaths(rootPath)
      .then(paths => {
        if (active) setRecentPaths({ rootPath, value: paths });
      })
      .catch(loadError => {
        console.error('[OperationWindow] Failed to load recent file history', loadError);
        if (active) setRecentPaths({ rootPath, value: [] });
      });
    return () => {
      active = false;
    };
  }, [rootPath]);

  const gitignoreRules = useMemo(() => {
    if (gitignore.rootPath === rootPath && activeSettings.search.useIgnoreFiles) {
      return gitignore.value;
    }
    return EMPTY_GITIGNORE_RULES;
  }, [activeSettings.search.useIgnoreFiles, gitignore.rootPath, gitignore.value, rootPath]);
  const searchableFiles = useMemo(() => {
    const excludedPatterns = [...activeSettings.search.exclude, ...activeSettings.files.exclude];
    return flattenedFiles.filter(file => {
      if (file.type !== 'file') return false;
      let relativePath = file.name;
      if (rootPath) relativePath = normalizeWorkspacePath(file.path, rootPath);
      return !isQuickOpenPathExcluded(relativePath, excludedPatterns, gitignoreRules);
    });
  }, [activeSettings, flattenedFiles, gitignoreRules, rootPath]);
  const filesRef = useRef(searchableFiles);
  filesRef.current = searchableFiles;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    try {
      workerPoolRef.current = createWorkerPool<OperationWorkerApi>({
        createWorker: () =>
          new Worker(new URL('../../engine/ide/search/operationWorker.ts', import.meta.url), {
            type: 'module',
          }),
        maxWorkers: 1,
        timeoutMs: 10000,
      });
    } catch (workerError) {
      console.error('[OperationWindow] Failed to create file search worker', workerError);
      let message = String(workerError);
      if (workerError instanceof Error) message = workerError.message;
      setError(message);
    }
    return () => {
      requestId.current += 1;
      workerPoolRef.current?.terminate();
      workerPoolRef.current = null;
      indexUpdateRef.current = Promise.resolve();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const pool = workerPoolRef.current;
    if (!pool) return;
    let active = true;
    const payload = searchableFiles.map(file => {
      let path = file.name;
      if (rootPath) path = normalizeWorkspacePath(file.path, rootPath);
      return { id: file.id, name: file.name, path, type: file.type };
    });
    const update = pool.call(worker => worker.updateFiles(payload, Date.now()));
    indexUpdateRef.current = update;
    void update.catch(workerError => {
      if (!active) return;
      console.error('[OperationWindow] Failed to update file search index', workerError);
      let message = String(workerError);
      if (workerError instanceof Error) message = workerError.message;
      setError(message);
    });
    return () => {
      active = false;
    };
  }, [enabled, rootPath, searchableFiles]);

  useEffect(() => {
    if (!enabled) {
      requestId.current += 1;
      return;
    }
    if (queryTokens.length === 0) {
      requestId.current += 1;
      setError(null);
      const byPath = new Map(searchableFiles.map(file => [file.path, file]));
      const actualRecents: FileItem[] = [];
      if (recentPaths.rootPath === rootPath) {
        for (const filePath of recentPaths.value) {
          const file = byPath.get(filePath);
          if (!file) continue;
          byPath.delete(filePath);
          actualRecents.push(file);
        }
      }
      const remainingFiles = [...byPath.values()].sort((a, b) => {
        let pathA = a.name;
        let pathB = b.name;
        if (rootPath) {
          pathA = normalizeWorkspacePath(a.path, rootPath);
          pathB = normalizeWorkspacePath(b.path, rootPath);
        }
        return pathA.localeCompare(pathB, undefined, { sensitivity: 'base', numeric: true });
      });
      setFiles([...actualRecents, ...remainingFiles]);
      return;
    }

    const pool = workerPoolRef.current;
    if (!pool) {
      setFiles([]);
      setError('File search worker is unavailable');
      return;
    }
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    setError(null);
    setFiles([]);
    void (async () => {
      await indexUpdateRef.current;
      if (currentRequest !== requestId.current) return;
      const results = await pool.call(worker => worker.search(queryTokens));
      if (currentRequest !== requestId.current) return;
      const byId = new Map(filesRef.current.map(file => [file.id, file]));
      setFiles(
        results.flatMap(result => {
          const file = byId.get(result.id);
          if (!file) return [];
          return [file];
        })
      );
    })().catch(workerError => {
      if (currentRequest !== requestId.current) return;
      console.error('[OperationWindow] File search failed', workerError);
      let message = String(workerError);
      if (workerError instanceof Error) message = workerError.message;
      setError(message);
      setFiles([]);
    });
    return () => {
      if (requestId.current === currentRequest) requestId.current += 1;
    };
  }, [enabled, queryTokens, recentPaths, rootPath, searchableFiles]);

  if (!enabled) return { files: [], error: null };
  return { files, error };
}
