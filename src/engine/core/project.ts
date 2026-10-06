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
    if (!currentProject) return;
    const files = await fsClient.walk(currentProject.rootPath);
    setProjectFiles(files);
  }, [currentProject]);

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
    return fsClient.addChangeListener(event => {
      let affectedPath = event.path;
      if (event.type === 'rename' && event.oldPath) affectedPath = event.oldPath;
      const pathIsInside = isPathWithin(event.path, currentProject.rootPath);
      const oldPathIsInside = isPathWithin(affectedPath, currentProject.rootPath);
      if (!pathIsInside && !oldPathIsInside) return;
      refreshProjectFiles().catch(error => {
        console.error('[Project] Failed to refresh after filesystem change:', error);
      });
    });
  }, [currentProject, refreshProjectFiles]);

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
