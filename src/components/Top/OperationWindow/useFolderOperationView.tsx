import { Clock3, Folder, FolderOpen, FolderPlus, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { basename, fsClient, getParentPath, HOME_DIR, normalizePath } from '@/engine/core/fs';
import { listRecentFolders, removeRecentFolder } from '@/engine/storage/recentFolderStorageAdapter';
import type { Project, ProjectFile } from '@/types';
import { isWorkspaceNameValid, resolveFolderInput, workspaceDestination } from './folderPath';
import type { OperationListItem, OperationWindowView } from './types';

interface FolderOperationOptions {
  onOpenFolder: (project: Project) => Promise<void>;
  onCreateFolder: (name: string) => Promise<void>;
  initialError?: string | null;
}

function projectFromPath(rootPath: string): Project {
  const normalizedPath = normalizePath(rootPath);
  const name = basename(normalizedPath) || '/';
  return { rootPath: normalizedPath, name, updatedAt: new Date() };
}

export function useFolderOperationView({
  onOpenFolder,
  onCreateFolder,
  initialError,
}: FolderOperationOptions): OperationWindowView {
  const [path, setPath] = useState(HOME_DIR);
  const [pathInput, setPathInput] = useState(HOME_DIR);
  const [newFolderName, setNewFolderName] = useState('');
  const [folders, setFolders] = useState<ProjectFile[]>([]);
  const [recentFolders, setRecentFolders] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const generation = useRef(0);
  const busy = useRef(false);

  const loadRecentFolders = useCallback(async () => {
    try {
      setRecentFolders(await listRecentFolders());
    } catch (loadError) {
      console.error('[Folders] Failed to load recent folders', loadError);
      setError(String(loadError));
    }
  }, []);

  const browse = useCallback(async (directory: string) => {
    if (busy.current) return;
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const normalizedPath = normalizePath(directory);
      const entries = await fsClient.readdir(normalizedPath);
      if (request !== generation.current) return;
      setPath(normalizedPath);
      setPathInput(normalizedPath);
      setFolders(entries.filter(entry => entry.type === 'folder'));
    } catch (loadError) {
      console.error(`[Folders] Failed to browse ${directory}`, loadError);
      if (request === generation.current) setError(String(loadError));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);

  const enter = useCallback(async () => {
    await browse(HOME_DIR);
    await loadRecentFolders();
    if (initialError) setError(initialError);
  }, [browse, initialError, loadRecentFolders]);

  const openFolder = useCallback(
    async (rootPath: string) => {
      if (busy.current || loading) return;
      busy.current = true;
      setIsBusy(true);
      setError(null);
      try {
        await onOpenFolder(projectFromPath(rootPath));
      } catch (openError) {
        console.error(`[Folders] Failed to open ${rootPath}`, openError);
        throw openError;
      } finally {
        busy.current = false;
        setIsBusy(false);
      }
    },
    [loading, onOpenFolder]
  );

  const forgetFolder = useCallback(
    async (rootPath: string) => {
      if (busy.current || loading) return;
      busy.current = true;
      setIsBusy(true);
      setError(null);
      try {
        await removeRecentFolder(rootPath);
        await loadRecentFolders();
      } catch (removeError) {
        console.error(`[Folders] Failed to remove recent folder ${rootPath}`, removeError);
        setError(String(removeError));
      } finally {
        busy.current = false;
        setIsBusy(false);
      }
    },
    [loadRecentFolders, loading]
  );

  const submitPath = useCallback(async () => {
    try {
      await browse(resolveFolderInput(pathInput));
    } catch (pathError) {
      console.error(`[Folders] Invalid or unavailable path ${pathInput}`, pathError);
      setError(String(pathError));
    }
  }, [browse, pathInput]);

  const createFolder = useCallback(async () => {
    if (busy.current || loading) return;
    const name = newFolderName.trim();
    if (!isWorkspaceNameValid(name)) {
      setError('Enter a single folder name.');
      return;
    }
    setError(null);
    busy.current = true;
    setIsBusy(true);
    try {
      await onCreateFolder(name);
      setNewFolderName('');
    } catch (createError) {
      console.error(`[Folders] Failed to create workspace ${name}`, createError);
      setError(String(createError));
    } finally {
      busy.current = false;
      setIsBusy(false);
    }
  }, [loading, newFolderName, onCreateFolder]);

  const items = useMemo(() => {
    const directoryItems: OperationListItem[] = folders.map(folder => ({
      id: `directory:${folder.path}`,
      label: basename(folder.path),
      description: folder.path,
      icon: <Folder size={15} />,
      onClick: () => browse(folder.path),
    }));
    const recentItems: OperationListItem[] = recentFolders.map(folder => ({
      id: `recent:${folder.rootPath}`,
      label: folder.name,
      description: folder.rootPath,
      icon: <Clock3 size={15} />,
      onClick: () => openFolder(folder.rootPath),
      actions: [
        {
          id: 'forget',
          icon: <Trash2 size={14} />,
          label: `Remove ${folder.name} from recent folders`,
          danger: true,
          onClick: () => void forgetFolder(folder.rootPath),
        },
      ],
    }));
    return [...directoryItems, ...recentItems];
  }, [browse, folders, forgetFolder, openFolder, recentFolders]);

  return {
    id: 'folders',
    title: 'Folders',
    items,
    onActivate: (item: OperationListItem) => item.onClick?.(),
    onEnter: enter,
    headerActions: [
      {
        id: 'parent',
        icon: <FolderOpen size={15} />,
        label: 'Parent folder',
        onClick: () => browse(getParentPath(path)),
      },
      {
        id: 'open',
        icon: <FolderOpen size={15} />,
        label: 'Open current folder',
        onClick: () => openFolder(path),
      },
    ],
    breadcrumb: (
      <form
        className="flex items-center gap-2 border-b border-border px-3 py-2"
        onSubmit={event => {
          event.preventDefault();
          void submitPath();
        }}
      >
        <input
          aria-label="Folder path"
          value={pathInput}
          onChange={event => setPathInput(event.target.value)}
          className="min-w-0 flex-1 border border-border bg-background px-2 py-1 font-mono text-sm"
        />
        <button type="submit">Go</button>
      </form>
    ),
    footer: (
      <form
        className="flex items-center gap-2 border-t border-border px-3 py-2"
        onSubmit={event => {
          event.preventDefault();
          void createFolder();
        }}
      >
        <FolderPlus size={15} />
        <input
          aria-label="New workspace name"
          value={newFolderName}
          onChange={event => setNewFolderName(event.target.value)}
          placeholder={`New folder in ${HOME_DIR}`}
          className="min-w-0 flex-1 border border-border bg-background px-2 py-1 text-sm"
        />
        <span
          title={workspaceDestination(newFolderName)}
          className="max-w-40 min-w-0 truncate font-mono text-xs text-muted-foreground"
        >
          {workspaceDestination(newFolderName)}
        </span>
        <button
          type="submit"
          disabled={!isWorkspaceNameValid(newFolderName) || loading || isBusy}
          aria-label="Create folder"
        >
          Create
        </button>
      </form>
    ),
    loading: loading || isBusy,
    error,
    emptyMessage: 'No folders or recent folders',
  };
}
