import { useEffect, useMemo, useRef, useState } from 'react';
import { flattenFileItems } from '@/components/Top/OperationWindow/OperationUtils';
import { type GitIgnoreRule, isPathIgnored, parseGitignore } from '@/engine/core/gitignore';
import { createWorkerPool, type WorkerPool } from '@/engine/workers/WorkerPool';
import { useSettings } from '@/hooks/state/useSettings';
import type { FileItem } from '@/types';
import type { OperationWorkerApi } from './operationWorker';

interface FileSearchResult {
  files: FileItem[];
  error: string | null;
}

export function useFileSearch(
  projectFiles: FileItem[],
  queryTokens: string[],
  enabled: boolean
): FileSearchResult {
  const { isExcluded } = useSettings();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const workerPoolRef = useRef<WorkerPool<OperationWorkerApi> | null>(null);
  const requestId = useRef(0);
  const flattenedFiles = useMemo(() => flattenFileItems(projectFiles), [projectFiles]);
  const gitignoreRules = useMemo((): GitIgnoreRule[] => {
    const gitignore = flattenedFiles.find(
      file => file.name === '.gitignore' || file.path === '.gitignore'
    );
    if (!gitignore?.content) return [];
    return parseGitignore(gitignore.content);
  }, [flattenedFiles]);
  const searchableFiles = useMemo(
    () =>
      flattenedFiles.filter(file => {
        if (file.type !== 'file' || isExcluded(file.path)) return false;
        if (gitignoreRules.length === 0) return true;
        return !isPathIgnored(gitignoreRules, file.path, false);
      }),
    [flattenedFiles, gitignoreRules, isExcluded]
  );
  const filesRef = useRef(searchableFiles);
  filesRef.current = searchableFiles;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    try {
      workerPoolRef.current = createWorkerPool<OperationWorkerApi>({
        createWorker: () =>
          new Worker(new URL('./operationWorker.ts', import.meta.url), { type: 'module' }),
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
      workerPoolRef.current?.terminate();
      workerPoolRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const pool = workerPoolRef.current;
    if (!pool) return;
    const payload = searchableFiles.map(file => ({
      id: file.id,
      name: file.name,
      path: file.path,
      type: file.type,
    }));
    void pool
      .call(worker => worker.updateFiles(payload, Date.now()))
      .catch(workerError => {
        console.error('[OperationWindow] Failed to update file search index', workerError);
        let message = String(workerError);
        if (workerError instanceof Error) message = workerError.message;
        setError(message);
      });
  }, [enabled, searchableFiles]);

  useEffect(() => {
    if (!enabled) {
      requestId.current += 1;
      setFiles([]);
      return;
    }
    if (queryTokens.length === 0) {
      requestId.current += 1;
      setError(null);
      setFiles(searchableFiles);
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
    void pool
      .call(worker => worker.search(queryTokens))
      .then(results => {
        if (currentRequest !== requestId.current) return;
        const byId = new Map(filesRef.current.map(file => [file.id, file]));
        setFiles(
          results.flatMap(result => {
            const file = byId.get(result.id);
            if (!file) return [];
            return [file];
          })
        );
      })
      .catch(workerError => {
        console.error('[OperationWindow] File search failed', workerError);
        if (currentRequest !== requestId.current) return;
        let message = String(workerError);
        if (workerError instanceof Error) message = workerError.message;
        setError(message);
        setFiles([]);
      });
    return () => {
      if (requestId.current === currentRequest) requestId.current += 1;
    };
  }, [enabled, queryTokens, searchableFiles]);

  if (!enabled) return { files: [], error: null };
  return { files, error };
}
