import { useCallback, useEffect, useMemo, useState } from 'react';
import { basename, fsClient, getParentPath, normalizePath } from '@/engine/core/fs/index';
import { saveRecentFolder } from '@/engine/core/metadata/recentFolderStorageAdapter';
import {
  clearProjectStartupError,
  getProjectStartupError,
  projectFromPath,
} from '@/engine/core/workspace/project';
import { ProjectTree } from '@/engine/core/workspace/projectTree';
import { getCurrentProject, setCurrentProject } from '@/stores/projectStore';
import type { FileItem, Project, ProjectFile } from '@/types/index';

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

export function useProject() {
  const [currentProject, setCurrentProjectState] = useState<Project | null>(getCurrentProject);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [startupError, setStartupError] = useState<string | null>(getProjectStartupError);
  const [isReady, setIsReady] = useState(false);
  const tree = useMemo(() => new ProjectTree(fsClient), []);
  const fileItems = useMemo(
    () => toFileItems(projectFiles, currentProject?.rootPath ?? null),
    [currentProject, projectFiles]
  );

  const refreshProjectFiles = useCallback(async () => {
    const rootPath = getCurrentProject()?.rootPath;
    if (!rootPath) return;
    if (!(await tree.load(rootPath))) return;
    if (getCurrentProject()?.rootPath !== rootPath) return;
    setProjectFiles(tree.snapshot());
  }, [tree]);

  const loadProject = useCallback(
    async (project: Project, beforeCommit?: () => Promise<void>) => {
      const rootPath = normalizePath(project.rootPath);
      const rootEntry = await fsClient.stat(rootPath);
      if (rootEntry.type !== 'folder') throw new Error(`${rootPath} is not a folder.`);
      const openedProject = projectFromPath(rootPath);
      if (!(await tree.load(rootPath))) return;
      try {
        await saveRecentFolder(openedProject);
        if (tree.rootPath !== rootPath) return;
        if (beforeCommit) await beforeCommit();
      } catch (error) {
        const currentRootPath = getCurrentProject()?.rootPath;
        if (currentRootPath && currentRootPath !== rootPath) {
          try {
            await tree.load(currentRootPath);
          } catch (restoreError) {
            console.error('[Project] Failed to restore the current workspace tree:', restoreError);
          }
        }
        throw error;
      }
      if (tree.rootPath !== rootPath) return;
      setCurrentProject(openedProject);
      setCurrentProjectState(openedProject);
      setProjectFiles(tree.snapshot());
      clearProjectStartupError();
      setStartupError(null);
    },
    [tree]
  );

  const createProject = useCallback(
    async (name: string, beforeCommit?: () => Promise<void>) => {
      const rootPath = await fsClient.createWorkspace(name);
      const project = projectFromPath(rootPath);
      await loadProject(project, beforeCommit);
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
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const schedulePublish = () => {
      if (timeout !== null) clearTimeout(timeout);
      timeout = setTimeout(() => {
        timeout = null;
        if (active && tree.rootPath === getCurrentProject()?.rootPath) {
          setProjectFiles(tree.snapshot());
        }
      }, 100);
    };
    const unsubscribe = fsClient.addChangeListener(event => {
      void tree
        .change(event)
        .then(changed => {
          if (active && changed) schedulePublish();
        })
        .catch(error => {
          console.error('[Project] Failed to apply filesystem change:', error);
        });
    });
    return () => {
      active = false;
      if (timeout !== null) clearTimeout(timeout);
      unsubscribe();
      tree.close();
    };
  }, [tree]);

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
