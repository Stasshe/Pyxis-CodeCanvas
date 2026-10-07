import { useCallback, useEffect, useMemo, useState } from 'react';
import { basename, fsClient, getParentPath, isPathWithin, normalizePath } from '@/engine/core/fs';
import { listRecentFolders, saveRecentFolder } from '@/engine/storage/recentFolderStorageAdapter';
import { getCurrentProject, setCurrentProject } from '@/stores/projectStore';
import type { FileItem, Project, ProjectFile } from '@/types';

function toFileItems(files: ProjectFile[], rootPath: string | null): FileItem[] {
  const items = new Map<string, FileItem>();
  const roots: FileItem[] = [];

  for (const file of files) {
    let children: FileItem['children'];
    if (file.type === 'folder') children = [];
    items.set(file.path, {
      id: file.path,
      name: basename(file.path),
      type: file.type,
      path: file.path,
      children,
    });
  }

  for (const file of files) {
    const item = items.get(file.path);
    if (!item) continue;
    const parentPath = getParentPath(file.path);
    if (parentPath === rootPath) {
      roots.push(item);
      continue;
    }
    const parent = items.get(parentPath);
    if (parent?.children) parent.children.push(item);
  }

  const sort = (entries: FileItem[]): FileItem[] => {
    const sortedEntries = entries.sort((left, right) => {
      if (left.type !== right.type) {
        if (left.type === 'folder') return -1;
        return 1;
      }
      return left.name.localeCompare(right.name);
    });
    const result: FileItem[] = [];
    for (const entry of sortedEntries) {
      let children: FileItem['children'];
      if (entry.children) children = sort(entry.children);
      result.push({ ...entry, children });
    }
    return result;
  };

  return sort(roots);
}

function projectFromPath(rootPath: string): Project {
  const normalizedPath = normalizePath(rootPath);
  let name = basename(normalizedPath);
  if (!name) name = '/';
  return { rootPath: normalizedPath, name, updatedAt: new Date() };
}

let projectStartupError: string | null = null;

export async function prepareProjectStore(): Promise<void> {
  try {
    const recentFolders = await listRecentFolders();
    if (recentFolders.length === 0) return;
    const project = projectFromPath(recentFolders[0].rootPath);
    const rootEntry = await fsClient.stat(project.rootPath);
    if (rootEntry.type !== 'folder') throw new Error(`${project.rootPath} is not a folder.`);
    setCurrentProject(project);
    projectStartupError = null;
  } catch (error) {
    let message = String(error);
    if (error instanceof Error) message = error.message;
    console.error('[Project] Recent folder could not be opened:', error);
    setCurrentProject(null);
    projectStartupError = message;
  }
}

export function getProjectStartupError(): string | null {
  return projectStartupError;
}

export function useProject() {
  const [currentProject, setCurrentProjectState] = useState<Project | null>(getCurrentProject);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [startupError, setStartupError] = useState<string | null>(getProjectStartupError);
  const [isReady, setIsReady] = useState(false);
  const fileItems = useMemo(
    () => toFileItems(projectFiles, currentProject?.rootPath ?? null),
    [currentProject, projectFiles]
  );

  const refreshProjectFiles = useCallback(async () => {
    const rootPath = getCurrentProject()?.rootPath;
    if (!rootPath) return;
    const files = await fsClient.walk(rootPath);
    if (getCurrentProject()?.rootPath !== rootPath) return;
    setProjectFiles(files);
  }, []);

  const loadProject = useCallback(async (project: Project) => {
    const rootPath = normalizePath(project.rootPath);
    const rootEntry = await fsClient.stat(rootPath);
    if (rootEntry.type !== 'folder') throw new Error(`${rootPath} is not a folder.`);
    const openedProject = projectFromPath(rootPath);
    const files = await fsClient.walk(rootPath);
    await saveRecentFolder(openedProject);
    setCurrentProject(openedProject);
    setCurrentProjectState(openedProject);
    setProjectFiles(files);
    projectStartupError = null;
    setStartupError(null);
  }, []);

  const createProject = useCallback(
    async (name: string) => {
      const rootPath = await fsClient.createWorkspace(name);
      const project = projectFromPath(rootPath);
      await loadProject(project);
      return project;
    },
    [loadProject]
  );

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        await fsClient.init();
        const initialProject = getCurrentProject();
        if (initialProject) await loadProject(initialProject);
        if (active) setIsReady(true);
      } catch (error) {
        let message = String(error);
        if (error instanceof Error) message = error.message;
        console.error('[Project] Startup failed:', error);
        if (active) {
          setStartupError(message);
          setIsReady(true);
        }
      }
    };
    initialize();
    return () => {
      active = false;
    };
  }, [loadProject]);

  useEffect(() => {
    if (!currentProject) return;
    const subscribedRootPath = currentProject.rootPath;
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let walkInFlight = false;
    let refreshPending = false;

    const walkCurrentRoot = async () => {
      const rootPath = getCurrentProject()?.rootPath;
      if (!active || rootPath !== subscribedRootPath || walkInFlight) return;
      walkInFlight = true;
      try {
        const files = await fsClient.walk(rootPath);
        if (active && getCurrentProject()?.rootPath === subscribedRootPath) setProjectFiles(files);
      } catch (error) {
        console.error('[Project] Failed to refresh after filesystem change:', error);
      } finally {
        walkInFlight = false;
        if (active && refreshPending) {
          refreshPending = false;
          void walkCurrentRoot();
        }
      }
    };

    const scheduleRefresh = () => {
      if (timeout !== null) clearTimeout(timeout);
      timeout = setTimeout(() => {
        timeout = null;
        if (walkInFlight) {
          refreshPending = true;
          return;
        }
        void walkCurrentRoot();
      }, 100);
    };

    const unsubscribe = fsClient.addChangeListener(event => {
      if (event.type === 'update') return;
      if (!active || getCurrentProject()?.rootPath !== subscribedRootPath) return;
      const pathIsInside = isPathWithin(event.path, subscribedRootPath);
      let oldPathIsInside = false;
      if (event.oldPath) oldPathIsInside = isPathWithin(event.oldPath, subscribedRootPath);
      if (!pathIsInside && !oldPathIsInside) return;
      scheduleRefresh();
    });

    return () => {
      active = false;
      if (timeout !== null) clearTimeout(timeout);
      unsubscribe();
    };
  }, [currentProject]);

  return {
    currentProject,
    projectFiles: fileItems,
    loadProject,
    createProject,
    refreshProjectFiles,
    startupError,
    isReady,
  };
}
