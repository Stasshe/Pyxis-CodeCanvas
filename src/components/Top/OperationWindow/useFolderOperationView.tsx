import { Clock3, Folder, FolderOpen, FolderPlus, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { basename, fsClient, getParentPath, HOME_DIR, normalizePath } from '@/engine/core/fs';
import { listRecentFolders, removeRecentFolder } from '@/engine/storage/recentFolderStorageAdapter';
import { getCurrentRootPath } from '@/stores/projectStore';
import type { Project, ProjectFile } from '@/types';
import {
  displayRecentFolderPath,
  folderSearchLocation,
  isWorkspaceNameValid,
  resolveFolderInput,
} from './folderPath';
import type { OperationListItem, OperationWindowView } from './types';

interface FolderOperationOptions {
  onOpenFolder: (project: Project) => Promise<void>;
  onCreateFolder: (name: string) => Promise<void>;
  onOpenRecent: () => void;
  onOpenFolderView: () => void;
  currentRootPath: string | null;
  initialError?: string | null;
}

function projectFromPath(rootPath: string): Project {
  const normalizedPath = normalizePath(rootPath);
  const name = basename(normalizedPath) || '/';
  return { rootPath: normalizedPath, name, updatedAt: new Date() };
}

function withTrailingSlash(path: string): string {
  if (path === '/') return path;
  return `${path}/`;
}

export function useFolderOperationView({
  onOpenFolder,
  onCreateFolder,
  onOpenRecent,
  onOpenFolderView,
  currentRootPath,
  initialError,
}: FolderOperationOptions): { folderView: OperationWindowView; recentView: OperationWindowView } {
  const initialPath = currentRootPath ?? HOME_DIR;
  const [path, setPath] = useState(initialPath);
  const [pathInput, setPathInput] = useState(withTrailingSlash(initialPath));
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [folders, setFolders] = useState<ProjectFile[]>([]);
  const [recentFolders, setRecentFolders] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const generation = useRef(0);
  const busy = useRef(false);

  const loadCandidates = useCallback(
    async (input: string, basePath = path) => {
      const request = ++generation.current;
      setLoading(true);
      try {
        const location = folderSearchLocation(input, basePath);
        const entries = await fsClient.readdir(location.directory);
        if (request !== generation.current) return;
        const prefix = location.prefix.toLocaleLowerCase();
        setFolders(
          entries.filter(entry => {
            if (entry.type !== 'folder') return false;
            return basename(entry.path).toLocaleLowerCase().startsWith(prefix);
          })
        );
        setError(null);
      } catch (loadError) {
        console.error(`[Folders] Failed to match directories for ${input}`, loadError);
        if (request === generation.current) {
          setFolders([]);
          setError(String(loadError));
        }
      } finally {
        if (request === generation.current) setLoading(false);
      }
    },
    [path]
  );

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
      setPathInput(withTrailingSlash(normalizedPath));
      setFolders(entries.filter(entry => entry.type === 'folder'));
    } catch (loadError) {
      console.error(`[Folders] Failed to browse ${directory}`, loadError);
      if (request === generation.current) {
        setFolders([]);
        setError(String(loadError));
      }
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);

  const loadRecentFolders = useCallback(async () => {
    try {
      setRecentFolders(await listRecentFolders());
      setError(null);
    } catch (loadError) {
      console.error('[Folders] Failed to load recent folders', loadError);
      setError(String(loadError));
    }
  }, []);

  const enterFolders = useCallback(async () => {
    const rootPath = getCurrentRootPath() ?? HOME_DIR;
    setPath(rootPath);
    setPathInput(withTrailingSlash(rootPath));
    await browse(rootPath);
    if (initialError) setError(initialError);
  }, [browse, initialError]);

  const enterRecent = useCallback(async () => {
    await loadRecentFolders();
  }, [loadRecentFolders]);

  const withBusy = useCallback(
    async (action: () => Promise<void>) => {
      if (busy.current || loading) return;
      busy.current = true;
      setIsBusy(true);
      setError(null);
      try {
        await action();
      } catch (actionError) {
        let message = String(actionError);
        if (actionError instanceof Error) message = actionError.message;
        setError(message);
        throw actionError;
      } finally {
        busy.current = false;
        setIsBusy(false);
      }
    },
    [loading]
  );

  const openFolder = useCallback(
    (rootPath: string) =>
      withBusy(async () => {
        try {
          const entry = await fsClient.stat(rootPath);
          if (entry.type !== 'folder') throw new Error(`${rootPath} is not a folder.`);
          await onOpenFolder(projectFromPath(rootPath));
        } catch (openError) {
          console.error(`[Folders] Failed to open ${rootPath}`, openError);
          throw openError;
        }
      }),
    [onOpenFolder, withBusy]
  );

  const openTypedFolder = useCallback(
    async (selectedItem?: OperationListItem) => {
      let destination = pathInput;
      try {
        if (selectedItem) destination = selectedItem.id.slice('directory:'.length);
        else destination = resolveFolderInput(pathInput, path);
        const entry = await fsClient.stat(destination);
        if (entry.type !== 'folder') throw new Error(`${destination} is not a folder.`);
        await browse(destination);
      } catch (pathError) {
        console.error(`[Folders] Invalid or unavailable path ${destination}`, pathError);
        setError(String(pathError));
        throw pathError;
      }
    },
    [browse, path, pathInput]
  );

  const confirmOpenFolder = useCallback(async () => {
    let destination = '';
    try {
      destination = resolveFolderInput(pathInput, path);
      await openFolder(destination);
    } catch (openError) {
      console.error(`[Folders] Failed to open ${destination || pathInput}`, openError);
      throw openError;
    }
  }, [openFolder, path, pathInput]);

  const forgetFolder = useCallback(
    (rootPath: string) =>
      withBusy(async () => {
        await removeRecentFolder(rootPath);
        await loadRecentFolders();
      }).catch(removeError => {
        console.error(`[Folders] Failed to remove recent folder ${rootPath}`, removeError);
      }),
    [loadRecentFolders, withBusy]
  );

  const createFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!isWorkspaceNameValid(name)) {
      setError('Enter a single folder name.');
      return;
    }
    await withBusy(async () => {
      await onCreateFolder(name);
      setNewFolderName('');
      setIsCreatingFolder(false);
    }).catch(createError => {
      console.error(`[Folders] Failed to create workspace ${name}`, createError);
    });
  }, [newFolderName, onCreateFolder, withBusy]);

  const directoryItems = useMemo(
    () =>
      folders.map(folder => ({
        id: `directory:${folder.path}`,
        label: basename(folder.path),
        icon: <Folder size={15} />,
        onClick: () => browse(folder.path),
      })),
    [browse, folders]
  );

  const recentItems = useMemo(
    () =>
      recentFolders.map(folder => ({
        id: `recent:${folder.rootPath}`,
        label: basename(folder.rootPath) || '/',
        description: displayRecentFolderPath(folder.rootPath),
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
      })),
    [forgetFolder, openFolder, recentFolders]
  );

  const folderFooter = useMemo(() => {
    if (!isCreatingFolder) return null;
    return (
      <form
        className="flex items-center gap-2 border-t border-border px-3 py-2"
        onSubmit={event => {
          event.preventDefault();
          void createFolder();
        }}
      >
        <input
          aria-label="New workspace name"
          value={newFolderName}
          onChange={event => setNewFolderName(event.target.value)}
          placeholder="New workspace name"
          className="min-w-0 flex-1 border border-border bg-background px-2 py-1 text-sm"
        />
        <button type="submit" disabled={!isWorkspaceNameValid(newFolderName) || loading || isBusy}>
          Create
        </button>
      </form>
    );
  }, [createFolder, isBusy, isCreatingFolder, loading, newFolderName]);

  const folderView = useMemo<OperationWindowView>(
    () => ({
      id: 'folders',
      title: 'Open Folder',
      showTitle: true,
      items: directoryItems,
      onActivate: item => browse(item.id.slice('directory:'.length)),
      onEnter: enterFolders,
      headerActions: [
        {
          id: 'open-recent',
          icon: <Clock3 size={15} />,
          label: 'Open Recent',
          onClick: onOpenRecent,
        },
        {
          id: 'parent',
          icon: <FolderOpen size={15} />,
          label: 'Parent folder',
          onClick: () => browse(getParentPath(path)),
        },
        {
          id: 'open-folder',
          icon: <FolderOpen size={15} />,
          label: 'Open Folder',
          onClick: () => confirmOpenFolder(),
        },
        {
          id: 'new-folder',
          icon: <FolderPlus size={15} />,
          label: 'New Workspace',
          onClick: () => setIsCreatingFolder(value => !value),
        },
      ],
      input: {
        value: pathInput,
        placeholder: 'Type a folder path',
        onChange: value => {
          setPathInput(value);
          void loadCandidates(value);
        },
        onConfirm: selectedItem => openTypedFolder(selectedItem),
      },
      footer: folderFooter,
      loading,
      actionBusy: isBusy,
      error,
      emptyMessage: 'No matching folders',
    }),
    [
      browse,
      confirmOpenFolder,
      directoryItems,
      enterFolders,
      error,
      folderFooter,
      isBusy,
      loadCandidates,
      onOpenRecent,
      openTypedFolder,
      path,
      pathInput,
      loading,
    ]
  );

  const recentView = useMemo<OperationWindowView>(
    () => ({
      id: 'recent',
      title: 'Open Recent',
      placeholder: 'Select a recently opened folder',
      showTitle: true,
      items: recentItems,
      onActivate: item => item.onClick?.(),
      onEnter: enterRecent,
      headerActions: [
        {
          id: 'open-folder',
          icon: <FolderOpen size={15} />,
          label: 'Open Folder',
          onClick: onOpenFolderView,
        },
      ],
      actionBusy: isBusy,
      error,
      emptyMessage: 'No recent folders',
    }),
    [enterRecent, error, isBusy, onOpenFolderView, recentItems]
  );

  return { folderView, recentView };
}
