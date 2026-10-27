import { useEffect, useRef } from 'react';
import { fsClient, isPathWithin } from '@/engine/core/fs/index';
import {
  loadAIFileContextSnapshot,
  loadAIFileContexts,
  reconcileAIFileContextsForPathChange,
  resolveAIFileSelection,
} from '@/engine/ide/ai/contextBuilder';
import { pushLogMessage } from '@/stores/loggerStore';
import type { AIFileContext, ChatSpace, FileItem } from '@/types/index';

interface UseAIFileContextsProps {
  rootPath: string | null;
  projectFiles: FileItem[];
  currentSpace: ChatSpace | null;
  fileContexts: AIFileContext[];
  updateFileContexts: (contexts: AIFileContext[], persistSelection?: boolean) => void;
  clearFileContexts: () => void;
  updateSelectedFiles: (paths: string[]) => Promise<void>;
  setError: (message: string | null) => void;
}

function textFiles(files: FileItem[]): FileItem[] {
  return files.flatMap(file => {
    if (file.type === 'file') return [file];
    return textFiles(file.children ?? []);
  });
}

function samePaths(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index]);
}

function desiredPaths(paths: string[], contexts: AIFileContext[]): string[] {
  const loaded = new Set(contexts.map(context => context.path));
  return Array.from(
    new Set([
      ...paths.filter(path => !loaded.has(path)),
      ...contexts.filter(context => context.selected).map(context => context.path),
    ])
  );
}

export function useAIFileContexts(props: UseAIFileContextsProps): (path: string) => string {
  const latest = useRef(props);
  latest.current = props;
  const contextsRef = useRef(props.fileContexts);
  contextsRef.current = props.fileContexts;
  const revisions = useRef(new Map<string, number>());
  const initialPaths = useRef<string[]>([]);
  const pendingReads = useRef(new Set<string>());
  const loadGeneration = useRef(0);
  const loadedRoot = useRef<string | null>(null);
  const desiredSelection = useRef<{
    rootPath: string | null;
    spaceId: string | null;
    paths: string[];
  }>({ rootPath: props.rootPath, spaceId: props.currentSpace?.id ?? null, paths: [] });
  const pendingSelection = useRef<string[] | null>(null);
  const spaceId = props.currentSpace?.id ?? null;
  const persisted =
    props.currentSpace?.rootPath === props.rootPath ? props.currentSpace.selectedFiles : [];
  if (
    desiredSelection.current.rootPath !== props.rootPath ||
    desiredSelection.current.spaceId !== spaceId
  ) {
    desiredSelection.current = { rootPath: props.rootPath, spaceId, paths: persisted };
    pendingSelection.current = null;
  }
  const selectedPathsForRender = resolveAIFileSelection(persisted, pendingSelection.current);
  if (selectedPathsForRender === persisted) pendingSelection.current = null;
  desiredSelection.current.paths = selectedPathsForRender;

  const hasFiles = Boolean(
    props.rootPath &&
      props.projectFiles.some(file => isPathWithin(file.path, props.rootPath || '/'))
  );
  useEffect(() => {
    const rootPath = props.rootPath;
    if (!rootPath) return;
    let active = true;
    const isCurrent = () =>
      active &&
      latest.current.rootPath === rootPath &&
      (latest.current.currentSpace?.id ?? null) === spaceId;
    const commit = (contexts: AIFileContext[]) => {
      contextsRef.current = contexts;
      latest.current.updateFileContexts(contexts, false);
    };
    const report = (error: Error | string) => {
      if (!isCurrent()) return;
      const message = `Failed to update AI file context: ${String(error)}`;
      console.error('[useAIFileContexts]', error);
      latest.current.setError(message);
      pushLogMessage(message, 'error', 'AI');
    };
    const selectedPaths = () => desiredPaths(desiredSelection.current.paths, contextsRef.current);
    const refresh = (path: string) => {
      const revision = revisions.current.get(path) ?? 0;
      pendingReads.current.add(path);
      const file: FileItem = { id: path, path, name: path.split('/').pop() || path, type: 'file' };
      void loadAIFileContexts([file], new Map())
        .then(contexts => {
          if (!isCurrent() || (revisions.current.get(path) ?? 0) !== revision) return;
          pendingReads.current.delete(path);
          const selected = new Set(selectedPaths());
          commit([
            ...contextsRef.current.filter(context => context.path !== path),
            ...contexts.map(context => ({ ...context, selected: selected.has(path) })),
          ]);
        })
        .catch(error => {
          if (!isCurrent() || (revisions.current.get(path) ?? 0) !== revision) return;
          pendingReads.current.delete(path);
          report(String(error));
        });
    };
    const unsubscribe = fsClient.addChangeListener(event => {
      if (
        !isCurrent() ||
        (!isPathWithin(event.path, rootPath) &&
          !(event.oldPath && isPathWithin(event.oldPath, rootPath)))
      )
        return;
      if (event.type !== 'update' && event.type !== 'rename' && event.type !== 'delete') return;
      const affected = (path: string) => {
        if (event.type === 'update') return path === event.path;
        if (event.type === 'delete') return isPathWithin(path, event.path);
        return (
          isPathWithin(path, event.path) ||
          Boolean(event.oldPath && isPathWithin(path, event.oldPath))
        );
      };
      for (const path of new Set([
        event.path,
        ...initialPaths.current,
        ...revisions.current.keys(),
        ...pendingReads.current,
        ...contextsRef.current.map(context => context.path),
      ])) {
        if (!affected(path)) continue;
        revisions.current.set(path, (revisions.current.get(path) ?? 0) + 1);
        pendingReads.current.delete(path);
      }
      const selection = selectedPaths();
      if (event.type === 'update') {
        pendingSelection.current = selection;
        commit(contextsRef.current.filter(context => context.path !== event.path));
        desiredSelection.current.paths = selection;
        if (selection.includes(event.path)) refresh(event.path);
        return;
      }
      const reconciled = reconcileAIFileContextsForPathChange(
        contextsRef.current,
        selection,
        event,
        rootPath
      );
      commit(reconciled.contexts);
      desiredSelection.current.paths = reconciled.selectedPaths;
      if (!samePaths(selection, reconciled.selectedPaths) && spaceId) {
        pendingSelection.current = reconciled.selectedPaths;
        void latest.current
          .updateSelectedFiles(reconciled.selectedPaths)
          .catch(error => report(String(error)));
      }
      if (event.type === 'rename') {
        for (const path of reconciled.selectedPaths) {
          if (!contextsRef.current.some(context => context.path === path)) refresh(path);
        }
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [props.rootPath, spaceId]);

  useEffect(() => {
    const rootPath = props.rootPath;
    if (loadedRoot.current !== rootPath) {
      loadedRoot.current = null;
      revisions.current.clear();
      pendingReads.current.clear();
      contextsRef.current = [];
      latest.current.clearFileContexts();
    }
    if (!rootPath || !hasFiles || loadedRoot.current === rootPath) return;
    loadedRoot.current = rootPath;
    const generation = ++loadGeneration.current;
    const files = textFiles(latest.current.projectFiles).filter(file =>
      isPathWithin(file.path, rootPath)
    );
    initialPaths.current = files.map(file => file.path);
    void loadAIFileContextSnapshot(files, path => revisions.current.get(path) ?? 0)
      .then(results => {
        if (generation !== loadGeneration.current || latest.current.rootPath !== rootPath) return;
        const merged = new Map(results.map(context => [context.path, context]));
        for (const context of contextsRef.current) merged.set(context.path, context);
        const selected = new Set(desiredPaths(desiredSelection.current.paths, contextsRef.current));
        const contexts = Array.from(merged.values()).map(context => ({
          ...context,
          selected: selected.has(context.path),
        }));
        contextsRef.current = contexts;
        latest.current.updateFileContexts(contexts, false);
      })
      .catch(error => {
        if (generation !== loadGeneration.current || latest.current.rootPath !== rootPath) return;
        const message = `Failed to load AI file contexts: ${String(error)}`;
        latest.current.setError(message);
        console.error('[useAIFileContexts]', error);
        pushLogMessage(message, 'error', 'AI');
      });
    return () => {
      loadGeneration.current += 1;
    };
  }, [props.rootPath, hasFiles]);
  return (path: string) => {
    if (!revisions.current.has(path)) revisions.current.set(path, 0);
    return `${loadGeneration.current}:${revisions.current.get(path)}`;
  };
}
